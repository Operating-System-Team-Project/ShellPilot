import { describe, expect, it } from "vitest";

import { createRuntime } from "../../src/core/create-runtime.js";

async function collectStream(stream: AsyncIterable<string> | undefined): Promise<string> {
  let output = "";
  if (!stream) {
    return output;
  }

  for await (const chunk of stream) {
    output += chunk;
  }

  return output;
}

describe("RuntimeController", () => {
  it("handles internal status commands without starting a shell stream", () => {
    const runtime = createRuntime({
      assistant: { provider: "mock" },
      initialCwd: process.cwd(),
    });

    const whatami = runtime.submitLine("/whatami");
    expect(whatami.stream).toBeUndefined();
    expect(whatami.events.map((event) => event.content)).toEqual([
      "Active assistant:",
      "Provider: mock",
      "Model: mock-explainer",
    ]);

    const status = runtime.submitLine("/status");
    expect(status.events.map((event) => event.content).join("\n")).toContain("CLIA-term status:");
    expect(status.events.map((event) => event.content).join("\n")).toContain("Assistant: mock:mock-explainer");
  });

  it("handles clear and exit commands", () => {
    const runtime = createRuntime({ assistant: { provider: "mock" } });

    const clear = runtime.submitLine("/clear");
    expect(clear.clearTranscript).toBe(true);
    expect(clear.shouldExit).toBe(false);

    const exit = runtime.submitLine("/exit");
    expect(exit.events.map((event) => event.content)).toEqual(["Exiting..."]);
    expect(exit.shouldExit).toBe(true);
    expect(runtime.isRunning()).toBe(false);
  });

  it("streams explicit explanations through the configured mock provider", async () => {
    const runtime = createRuntime({ assistant: { provider: "mock" } });

    const result = runtime.submitLine("/explain pwd");
    expect(result.streamRole).toBe("assistant");

    const output = await collectStream(result.stream);
    result.commitAssistant?.(output.trim());

    expect(output).toContain("[mock-explainer] The command was not executed in this session.");
    expect(output).toContain("Command: pwd");
    expect(output).toContain("This mock provider is active");
  });
});
