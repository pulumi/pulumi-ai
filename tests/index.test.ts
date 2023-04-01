import { PulumiGPT } from "../src/index";
import { expect } from "chai";

describe("pulumigpt", (): void => {
    it("construct PulumiGPT stack", async () => {
        const p = new PulumiGPT({
            openaiApiKey: process.env.OPENAI_API_KEY!,
        });
        const stack = await p.stack;
        const summary = await stack.workspace.stack();
        expect(summary!.name).to.equal("dev");
    }).timeout(100000);
});