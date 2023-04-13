import { PulumiAI } from "../src/index";
import { expect } from "chai";
import axios from "axios";
import { OutputMap } from "@pulumi/pulumi/automation";

const mockProgram = `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Create an AWS S3 bucket for website hosting
const myBucket = new aws.s3.Bucket("myBucket", {
  website: {
    indexDocument: "index.html",
    errorDocument: "error.html",
  },
});

// Export the bucket name
export const bucketName = myBucket.id;`;

function randomHex(): string {
    return Math.floor(Math.random() * 0xffffffff).toString(16);
}

describe("pulumiai", (): void => {
    it("generates a title for a program", async () => {
        const p = new PulumiAI({
            openaiApiKey: process.env.OPENAI_API_KEY!,
            stackName: `test-stack-${randomHex()}`
        });

        const title = await p.generateTitleForProgram(mockProgram);
        expect(title).to.equal("S3 Website Hosting Setup");
    });

    it("construct PulumiAI stack", async () => {
        const p = new PulumiAI({
            openaiApiKey: process.env.OPENAI_API_KEY!,
            stackName: `test-stack-${randomHex()}`
        });
        const stack = await p.stack;
        const summary = await stack.workspace.stack();
        expect(summary!.name).to.equal("dev");
    }).timeout(100000);

    it("builds a simple vpc", async () => {
        const commands = [
            `An AWS VPC`,
            `add three private subnets`,
            `remove one of the subnets`,
        ];
        await runTest(commands, {}, async (p, outputs) => {
            let subnets = 0;
            let vpcs = 0;
            for (const [k, v] of Object.entries(outputs)) {
                if (typeof v.value == "string" && v.value.startsWith("subnet-")) {
                    subnets++;
                } else if (typeof v.value == "string" && v.value.startsWith("vpc-")) {
                    vpcs++;
                }
            }
            expect(subnets).to.be.equal(2);
            expect(vpcs).to.be.equal(1);
        });
    }).timeout(1000000);


    it("builds a static website deploy", async () => {
        const commands = [
            `give me an s3 bucket`,
            `add an index.html file that says "Hello, world!" in three languages`,
            `give me the url for the index.html file`,
            `That gave me "AccessDenied", can you fix it?`,
        ];
        await runTest(commands, {}, async (p, outputs) => {
            let checked = 0;
            for (const [k, v] of Object.entries(outputs)) {
                if (typeof v.value == "string" && v.value.indexOf("amazonaws.com") != -1) {
                    const resp = await axios.get(v.value);
                    expect(resp.data).to.contain("Hello");
                    checked++;
                }
            }
            expect(checked).to.be.equal(1);
        });
    }).timeout(1000000);

    it("builds a static website no-deploy", async () => {
        const commands = [
            `give me an s3 bucket`,
            `add an index.html file that says "Hello, world!" in three languages`,
            `give me the url for the index.html file`,
            `That gave me "AccessDenied", can you fix it?`,
        ];
        await runTest(commands, { autoDeploy: false }, async (p) => {
            expect(p.program).to.contain("Hello");
            expect(p.program).to.contain("websiteEndpoint");
        },);
    }).timeout(1000000);

});

interface Options {
    autoDeploy?: boolean;
}

async function runTest(commands: string[], opts: Options, validate: (p: PulumiAI, outputs: OutputMap) => Promise<void>) {
    const p = new PulumiAI({
        openaiApiKey: process.env.OPENAI_API_KEY!,
        openaiTemperature: 0.01, // For test stability
        stackName: `test-stack-${randomHex()}`,
        ...opts,
    });
    let i = 0;
    for (const command of commands) {
        console.log(`step ${++i}/${commands.length}: '${command}'`);
        await p.interact(command);
        while (p.errors.length != 0) {
            await p.interact("Fix the errors");
        }
    }
    console.log(`Program:\n${p.program}`);
    if (p.autoDeploy) {
        const stack = await p.stack;
        const outputs = await stack.outputs();
        console.log(`Validating outputs:\n${JSON.stringify(outputs, null, 2)}`);
        await validate(p, outputs);
    } else {
        await validate(p, {});
    }
}
