import type { CommandExecution } from "../domain/command-execution.js";
import type { ExplanationProvider } from "../providers/explanation-provider.js";
import { createExplanationProvider } from "../providers/create-explanation-provider.js";
import type { ExplanationProviderConfig, ExplanationProviderMetadata } from "../providers/explanation-provider.js";

export interface ExplainCommandOptions {
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly execution?: CommandExecution;
}

export class ExplanationService {
  private readonly provider: ExplanationProvider;

  constructor(provider?: ExplanationProvider) {
    this.provider = provider ?? createExplanationProvider();
  }

  static fromConfig(config?: ExplanationProviderConfig): ExplanationService {
    return new ExplanationService(createExplanationProvider(config));
  }

  providerMetadata(): ExplanationProviderMetadata {
    return this.provider.metadata();
  }

  explainCommand(options: ExplainCommandOptions): AsyncIterable<string> {
    return this.provider.explainCommand({
      command: options.command,
      cwd: options.cwd,
      shell: options.shell,
      execution: options.execution,
    });
  }
}
