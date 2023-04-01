#!/usr/bin/env node
import { PulumiGPT } from ".";
import * as readline from "readline";

async function handleCommand(request: string, pulumigpt: PulumiGPT) {
    const parts = request.split(" ");
    switch (parts[0]) {
        case "!quit":
            process.exit(0);
        case "!program":
            console.log(pulumigpt.program);
            break;
        case "!stack":
            const stack = await pulumigpt.stack;
            const s = await stack.exportStack();
            console.log(s.deployment.resources);
            break;
        case "!verbose":
            if (parts[1] == "off") {
                pulumigpt.verbose = false;
                console.warn("Verbose mode off.")
            } else {
                pulumigpt.verbose = true;
                console.warn("Verbose mode on.")
            }
            break;
        case "!open":
            if (parts.length <= 1) {
                console.warn("Usage: !open <output>")
                break;
            }
            let url: string;
            if (parts[1].startsWith("http")) {
                url = parts[1];
            } else {
                const outputs = await stack.outputs();
                url = outputs[parts[1]].value;
            }
            await open(url);
            break;
        default:
            console.log("Unknown command: " + request);
            break;
    }
}

async function run() {
    const pulumigpt = new PulumiGPT({
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: process.env.OPENAI_MODEL ?? "gpt-4",
        openaiTemperature: +process.env.OPENAI_TEMPERATURE ?? 0,
        autoDeploy: true,
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    console.log("Welcome to Pulumi GPT.");
    console.log();
    const stack = await pulumigpt.stack;
    const summary = await stack.workspace.stack();
    console.log(`Your stack: ${summary.url}/resources`);
    console.log();
    console.log("What cloud infrastructure do you want to build today?")

    while (true) {
        const request = await new Promise<string>(resolve => {
            rl.question("\n> ", resolve);
        });
        if (request.length > 0 && request[0] == "!") {
            await handleCommand(request, pulumigpt);
            continue;
        }
        pulumigpt.interact(request);
        pulumigpt.errors.forEach(e => console.warn(e));
    }
}

run().catch(err => console.log(err));