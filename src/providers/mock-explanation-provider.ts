import {
  buildExplanationMessages,
  type ExplanationProvider,
  type ExplanationProviderMetadata,
  type ExplanationRequest,
} from "./explanation-provider.js";

export class MockExplanationProvider implements ExplanationProvider {
  constructor(private readonly model = "mock-explainer") {}

  metadata(): ExplanationProviderMetadata {
    return {
      kind: "mock",
      model: this.model,
    };
  }

  async *explainCommand(request: ExplanationRequest): AsyncIterable<string> {
    const messages = buildExplanationMessages(request);
    const context = messages[messages.length - 1]?.content ?? "";
    const exitSummary = request.execution
      ? request.execution.exitCode === 0
        ? "The last execution completed successfully."
        : `The last execution returned exit code ${String(request.execution.exitCode)}.`
      : "The command was not executed in this session.";

    yield [
      `[${this.model}] ${exitSummary}`,
      "",
      `Command: ${request.command}`,
      "",
      "This mock provider is active, so no external LLM request was made.",
      "Configure assistant.provider as \"ollama\" or \"openai-compatible\" to use a real model.",
      "",
      "Prompt context sent to a real provider would include:",
      context,
    ].join("\n");
  }
}
