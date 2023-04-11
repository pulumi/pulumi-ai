import { LocalWorkspace, Stack, EngineEvent, OutputMap, DiagnosticEvent } from "@pulumi/pulumi/automation";
import { IncomingMessage } from "http";
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

const titlePrompt = (program: string, wordLimit: number) => `You are PulumiAI, an AI agent that builds and deploys Cloud Infrastructure.
In response to the Program I provide, please respond with a title for the program.
Your response should be at most ${wordLimit} words.

Program:
\`\`\`
${program}
\`\`\`
`;

const basePrompt = (lang: string) => `You are PulumiAI, an AI agent that builds and deploys Cloud Infrastructure written in Pulumi ${lang}.
Generate a description of the Pulumi program you will define, followed by a single Pulumi ${lang} program in response to each of my Instructions.
I will then deploy that program for you and let you know if there were errors.
You should modify the current program based on my instructions.
You should not start from scratch unless asked.`;

const textPrompt = (args: Pick<PromptArgs, "lang" | "langcode" | "program" | "instructions">) => `${basePrompt(args.lang)}
Please output in markdown syntax.

Current Program:
\`\`\`${args.langcode}
${args.program}
\`\`\`

Instructions:
${args.instructions}
`;

const prompt = (args: PromptArgs) => `${basePrompt(args.lang)}
You are creating infrastructure in the ${args.cloud} \`${args.region}}\` region.
Always include stack exports in the program.
Do not use the local filesystem.  Do not use Pulumi config.
If you can:
* Use "@pulumi/awsx" for ECS, and Fargate and API Gateway
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
    /**
     * The name of the project to create. Defaults to "pulumi-ai".
     */
    projectName?: string;
    /**
     * The name of the stack to create. Defaults to "dev".
     */
    stackName?: string;
}

class ProgramResponse {
    program: string;
    text: string;
}

export class InteractResponse {
    text: string;
    outputs?: OutputMap;
    program?: string;
    failed?: boolean;
}

export class PulumiAI {
    public program: string;
    public errors: DiagnosticEvent[];
    public stack: Promise<Stack>;
    public verbose: boolean;
    public autoDeploy: boolean;

    private openaiApi: openai.OpenAIApi;
    private model: string;
    private temperature: number;

    constructor(options: Options) {
        const configuration = new openai.Configuration({
            apiKey: options.openaiApiKey,
        });
        this.openaiApi = new openai.OpenAIApi(configuration);
        this.program = "const pulumi = require('@pulumi/pulumi');"
        this.errors = [];
        this.verbose = false;
        this.autoDeploy = options.autoDeploy ?? true;
        this.model = options.openaiModel ?? "gpt-4";
        this.temperature = options.openaiTemperature ?? 0;
        if (this.autoDeploy) {
            this.stack = this.initializeStack(options.stackName ?? "dev", options.projectName ?? "pulumi-ai");
        }
    }

    public async generateTitleForProgram(program: string, wordLimit = 4): Promise<string> {
        const resp = await this.openaiApi.createChatCompletion({
            model: this.model,
            messages: [{role: "user", content: titlePrompt(program, wordLimit)}],
            temperature: this.temperature,
        });

        const completion = resp.data.choices[0];
        if (!completion) {
            throw new Error("no title found");
        }

        return completion.message.content;
    }

    public async generateProgramFromPrompt(language: string, instructions: string, program: string, onEvent?: (chunk: string) => void) {
        const markdownLangMap: Record<string, string> = {
            "TypeScript": "typescript",
            "Go": "go",
            "Python": "python",
            "C#": "csharp",
        };

        const content = textPrompt({
            lang: language,
            langcode: markdownLangMap[language] ?? "typescript",
            program,
            instructions,
        })

        return await this.generateProgramFor(content, onEvent);
    }

    public async interact(input: string, onEvent?: (chunk: string) => void, predeploy?: (resp: InteractResponse) => void): Promise<InteractResponse> {
        const resp = await this.getProgramFor(input, onEvent);
        this.program = resp.program;
        const response = {
            text: resp.text,
            program: resp.program,
            outputs: undefined,
            failed: undefined,
        };
        if (this.autoDeploy) {
            if (predeploy) { predeploy(response); }
            try {
                response.outputs = await this.deploy();
                this.errors = [];
            } catch (err) {
                this.errors = err.errors;
                response.failed = true;
            }
        }
        return response;
    }

    private async initializeStack(stackName: string, projectName: string): Promise<Stack> {
        const stack = await LocalWorkspace.createOrSelectStack({
            stackName: stackName,
            projectName: projectName,
            program: async () => requireFromString(""),
        });
        await stack.setConfig("aws:region", { value: "us-west-2" });
        // Cancel and ignore any errors to ensure we clean up after previous failed deployments
        try { await stack.cancel(); } catch (err) { }
        const res = await stack.up();
        return stack;
    }

    private async getProgramFor(request: string, onEvent?: (chunk: string) => void): Promise<ProgramResponse> {
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

        return this.generateProgramFor(content, onEvent);
    }

    private async generateProgramFor(content: string, onEvent?: (chunk: string) => void): Promise<ProgramResponse> {
        this.log("prompt: " + content);
        const resp = await this.openaiApi.createChatCompletion({
            model: this.model,
            messages: [{ role: "user", content }],
            temperature: this.temperature,
            stream: true,
        }, { responseType: "stream" });

        const stream = resp.data as unknown as IncomingMessage;

        const allData = new Promise<string>((resolve, reject) => {
            const textParts: string[] = [];
            stream.on("data", async (chunk: Buffer) => {
                try {
                    const payloads = chunk.toString().split("\n\n");
                    for (const payload of payloads) {
                        if (payload.includes('[DONE]')) {
                            resolve(textParts.join(""));
                        } else if (payload.startsWith("data:")) {
                            const data = payload.replace(/(\n)?^data:\s*/g, '');
                            const parsed = JSON.parse(data.trim());
                            const content = parsed.choices[0].delta.content;
                            if (content) {
                                if (onEvent) {
                                    onEvent(content);
                                }
                                textParts.push(content);
                            }
                        } else if (payload == "") {
                            // Ignore empty payloads
                        } else {
                            this.log("unknown openai payload: " + payload)
                        }
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        // Wait until we've gotten all the updates from the stream.
        // This might throw, and if it does, we bubble that up into our caller.
        const text = await allData;
        this.log("response: " + text);
        const response = {
            text: text,
            program: "",
        };

        const codestart = text.indexOf("```");
        if (codestart == -1) {
            return response;
        }
        const start = text.indexOf("\n", codestart) + 1;
        const end = text.indexOf("```", start);
        response.program = text.substring(start, end);
        return response;
    }

    private log(msg: string) {
        if (this.verbose) {
            console.warn(msg);
        }
    }

    private async deploy(): Promise<OutputMap> {
        const stack = await this.stack;
        stack.workspace.program = async () => requireFromString(this.program);

        const errors: DiagnosticEvent[] = [];
        const onEvent = (event: EngineEvent) => {
            try {
                if (event.diagnosticEvent && (event.diagnosticEvent.severity == "error" || event.diagnosticEvent.severity == "info#err")) {
                    if (!event.diagnosticEvent.message.startsWith("One or more errors occurred")) {
                        errors.push(event.diagnosticEvent);
                    }
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
                    this.log("unhandled event: " + JSON.stringify(event, null, 4));
                }
            } catch (err) {
                this.log(`couldn't handle event ${event}: ${err}`);
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

}
