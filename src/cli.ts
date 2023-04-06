#!/usr/bin/env node
import { PulumiAI } from ".";
import * as readline from "readline";
import * as chalk from "chalk";

async function handleCommand(request: string, ai: PulumiAI) {
    const stack = await ai.stack;
    const parts = request.split(" ");
    switch (parts[0]) {
        case "!quit":
            console.log("destroying stack...");
            await stack.destroy();
            console.log("done. Goodbye!");
            process.exit(0);
        case "!program":
            console.log(ai.program);
            break;
        case "!stack":
            const s = await stack.exportStack();
            console.log(s.deployment.resources);
            break;
        case "!verbose":
            if (parts[1] == "off") {
                ai.verbose = false;
                console.warn("Verbose mode off.")
            } else {
                ai.verbose = true;
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
    const ai = new PulumiAI({
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: process.env.OPENAI_MODEL ?? "gpt-4",
        openaiTemperature: +process.env.OPENAI_TEMPERATURE ?? 0,
        autoDeploy: true,
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    console.log(chalk.magenta.bold("Welcome to Pulumi AI."));
    console.log();
    const stack = await ai.stack;
    const summary = await stack.workspace.stack();
    const url = `${summary.url}/resources`;
    console.log(`Your stack: ${chalk.blue.underline(url)}`);
    console.log();
    console.log(chalk.italic("What cloud infrastructure do you want to build today?"));

    while (true) {
        const request = await new Promise<string>(resolve => {
            rl.question(`\n> ${chalk.reset()}`, resolve);
        });
        if (request.length > 0 && request[0] == "!") {
            await handleCommand(request, ai);
            continue;
        }
        
        let text = "";
        let i = 0;
        const resp = await ai.interact(request, (chunk) => {
            chunk = chunk.replace(/[\n\t\r]/g, " ");
            text = (text + chunk).slice(-60);
            const progress = [".  ", ".. ", "...", "   "][Math.floor((i++)/3) % 4];
            process.stdout.write(`\rThinking${progress}  ${chalk.dim(text)}`);
        }, () => {
            readline.clearLine(process.stdout, -1)
            process.stdout.write(`\r`);
        });
        process.stdout.write("\r");
        if (resp.failed == true) {
            ai.errors.forEach(e => console.warn(`error: ${JSON.stringify(e)}`));
        } else if (resp.program) {
            const outputs = resp.outputs || {};
            if (Object.keys(outputs).length > 0) {
                console.log("Stack Outputs:");
            }
            for (const [k, v] of Object.entries(outputs)) {
                console.log(`  ${k}: ${v.value}`);
            }
        } else {
            // We could find a program.
            console.warn(`error: ${resp.text}`);
        }
    }
}

run().catch(err => {
    console.error(`unhandled error: ${err}`);
    process.exit(1);
});