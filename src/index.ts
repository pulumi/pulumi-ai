import { LocalWorkspace, Stack, EngineEvent, OutputMap, DiagnosticEvent } from "@pulumi/pulumi/automation";
import * as process from "process";
import * as openai from "openai";

interface PromptArgs {
    lang: string;
    langcode: string;
    cloud: string;
    region: string;
    program: string;
    errors: string[];
    outputs: Record<string, string>;
    instructions: string;
}

const prompt = (args: PromptArgs) => `You are PulumiGPT, an AI agent that builds and deploys Cloud Infrastructure written in Pulumi ${args.lang}.  
Generate a description of the Pulumi program you will define, followed by a single Pulumi ${args.lang} program in response to each of my Instructions.  
I will then deploy that program for you and let you know if there were errors.  
You should modify the current program based on my instructions.  
You should not start from scratch unless asked. 
You are creating infrastructure in the ${args.cloud} \`${args.region}}\` region. 
Always include stack exports in the program. 
Do not use the local filesystem.  Do not use Pulumi config.
If you can:
* Use "@pulumi/awsx" for VPCs, ECS, and Fargate and API Gateway
* Use "@pulumi/eks" for EKS. 
* Use aws.lambda.CallbackFunction for lambdas and serverless functions.

Current Program:
\`\`\`${args.langcode}
${args.program}
\`\`\`

Errors:
${args.errors.join("\n")}

Stack Outputs:
${Object.entries(args.outputs).map(([k, v]) => `${k}: ${v}`).join("\n")}

Instructions:
${args.instructions}
`;

function requireFromString(src: string): Record<string, any> {
    var exports = {};
    eval(src);
    return exports;
}

async function deploy(stack: Stack, program: string): Promise<OutputMap> {
    stack.workspace.program = async () => requireFromString(program);

    const errors: DiagnosticEvent[] = [];
    const onEvent = (event: EngineEvent) => {
        try {
            if (event.diagnosticEvent && (event.diagnosticEvent.severity == "error" || event.diagnosticEvent.severity == "info#err")) {
                errors.push(event.diagnosticEvent);
            } else if (event.resourcePreEvent) {
                if (event.resourcePreEvent.metadata.op != "same") {
                    const name = event.resourcePreEvent.metadata.urn.split("::")[3];
                    console.log(`${event.resourcePreEvent.metadata.op} ${event.resourcePreEvent.metadata.type} ${name} ...`);
                }
            } else if (event.resOutputsEvent) {
                if (event.resOutputsEvent.metadata.op != "same") {
                    const name = event.resOutputsEvent.metadata.urn.split("::")[3];
                    console.log(`${event.resOutputsEvent.metadata.op}d ${name}`);
                }
            } else if (event.diagnosticEvent || event.preludeEvent || event.summaryEvent || event.cancelEvent) {
                // Ignore thse events
            } else {
                console.warn("unhandled event: " + JSON.stringify(event, null, 4));
            }
        } catch (err) {
            console.warn(err);
        }
    }

    try {
        const res = await stack.up({ onEvent });
        return res.outputs
    } catch (err) {
        // Add the errors and rethrow
        err.errors = errors;
        throw err;
    }
}


export interface Options {
    /**
     * The OpenAI API key to use.
     */
    openaiApiKey: string;
    /**
     * The OpenAI model to use. Defaults to "gpt-4".
     */
    openaiModel?: string;
    /**
     * The OpenAI temperature to use. Defaults to 0.
     */
    openaiTemperature?: number;
    /**
     * Whether to automatically deploy the stack. Defaults to true.
     */
    autoDeploy?: boolean;
}


export class PulumiGPT {
    public program: string;
    public errors: DiagnosticEvent[];
    public stack: Promise<Stack>;
    public verbose: boolean;

    private openaiApi: openai.OpenAIApi;

    constructor(options: Options) {
        const configuration = new openai.Configuration({
            apiKey: options.openaiApiKey,
        });
        this.openaiApi = new openai.OpenAIApi(configuration);
        this.program = "const pulumi = require('@pulumi/pulumi');"
        this.errors = [];
        this.stack = this.initializeStack();
        this.verbose = false;
    }

    public async interact(input: string): Promise<void> {
        const stack = await this.stack;
        this.program = await this.getProgramFor(input);
        try {
            const outputs = await deploy(stack, this.program);
            for (const [k, v] of Object.entries(outputs)) {
                console.log(`${k}: ${v.value}`)
            }
            this.errors = [];
        } catch (err) {
            this.errors = err.errors;
            this.errors.forEach(e => console.warn(e));
        }
    }

    private async initializeStack(): Promise<Stack> {
        const stack = await LocalWorkspace.createOrSelectStack({
            stackName: "dev",
            projectName: "inlineNode",
            program: async () => requireFromString(""),
        });
        await stack.workspace.installPlugin("aws", "v4.0.0");
        await stack.setConfig("aws:region", { value: "us-west-2" });
        const res = await stack.up();
        return stack;
    }

    private async getProgramFor(request: string): Promise<string> {
        const configuration = new openai.Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        const api = new openai.OpenAIApi(configuration);
        const content = prompt({
            lang: "JavaScript",
            langcode: "javascript",
            cloud: "AWS",
            region: "us-west-2",
            program: this.program,
            errors: this.errors.map(e => JSON.stringify(e)),
            // TODO: Pass outputs from previous deployment
            outputs: {},
            instructions: request,
        })
        this.log("prompt: " + content);
        const resp = await api.createChatCompletion({
            model: process.env.OPENAI_MODEL ?? "gpt-4",
            messages: [{ role: "user", content },],
            temperature: +process.env.OPENAI_TEMPERATURE ?? 0,
        });
        const message = resp.data.choices[0].message;
        this.log("response: " + message.content);

        const codestart = message.content.indexOf("```");
        this.log(codestart.toString());
        if (codestart == -1) {
            return "";
        }
        const start = message.content.indexOf("\n", codestart) + 1;
        const end = message.content.indexOf("```", start);
        const code = message.content.substring(start, end);
        return code;
    }

    private log(msg: string) {
        if (this.verbose) {
            console.error(msg);
        }
    }

}