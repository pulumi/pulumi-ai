import { LocalWorkspace, Stack, EngineEvent } from "@pulumi/pulumi/automation";
import * as readline from "readline";
import * as process from "process";
import * as openai from "openai";

function requireFromString(src: string): Record<string, any> {
    var exports = {};
    eval(src);
    return exports;
}

async function initializeStack(): Promise<Stack> {
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

const messages: openai.ChatCompletionRequestMessage[] = [
    { role: "system", content: "You are a bot that generates Pulumi JavaScript programs.  You output a single codeblock surrounded by ``` code fences in each response." },
];

async function getProgramFor(request: string): Promise<string> {
    const configuration = new openai.Configuration({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const api = new openai.OpenAIApi(configuration);
    messages.push({ role: "user", content: request });
    const resp = await api.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: messages,
    });
    const content = resp.data.choices[0].message.content;
    const start = content.indexOf("\n```javascript") + 14;
    const end = content.indexOf("```", start);
    const code = content.substring(start, end);
    console.error("----: " + content);
    messages.push(resp.data.choices[0].message);
    return code;
}

function onEvent(event: EngineEvent) {
    try {
        if (event.diagnosticEvent || event.preludeEvent || event.summaryEvent || event.cancelEvent) {
            return;
        }
        if (event.resourcePreEvent) {
            if (event.resourcePreEvent.metadata.op != "same") {
                const name = event.resourcePreEvent.metadata.urn.split("::")[3];
                console.log(`${event.resourcePreEvent.metadata.op} ${event.resourcePreEvent.metadata.type} ${name} ...`);
            }
            return;
        }
        if (event.resOutputsEvent) {
            if (event.resOutputsEvent.metadata.op != "same") {
                const name = event.resOutputsEvent.metadata.urn.split("::")[3];
                console.log(`${event.resOutputsEvent.metadata.op}d ${name}`);
            }
            return;
        }
        console.log(JSON.stringify(event));
    } catch (err) {
        console.warn(err);
    }
}

async function deploy(stack: Stack, program: string) {
    stack.workspace.program = async () => requireFromString(program);
    try {
        const res = await stack.up({ onEvent });
        for (const [k, v] of Object.entries(res.outputs)) {
            console.log(`${k}: ${v.value}`)
        }
    } catch (err) {
        console.log(err);
        process.exit(1);
        // TODO: Send the error message back and see if GPT can fix it.
    }
}

async function run() {
    const stack = await initializeStack();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    console.log("Welcome to Pulumi GPT.");
    console.log();
    const summary = await stack.workspace.stack();
    console.log(`Your stack: ${summary.url}/resources`);
    console.log();
    console.log("What cloud infrastructure do you want to build today?")

    await getProgramFor("Generate a single Pulumi JavaScript program in response to each of my requests. You are creating infrastructure in the AWS us-west-2 region. Always modify the program returned in the prior response. Always include stack exports in the program.");

    while (true) {
        const answer = await new Promise<string>(resolve => {
            rl.question("> ", resolve);
        });
        const program = await getProgramFor(answer);
        await deploy(stack, program);
    }
}

run().catch(err => console.log(err));