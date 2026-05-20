import path from "node:path";

import { ChatSession } from "../domain/chat-session.js";
import {
  formatShellExecutionForTranscript,
  type CommandExecution,
} from "../domain/command-execution.js";
import { ExplanationService } from "./explanation-service.js";
import {
  buildDefaultCommandRegistry,
  type CommandAliasDefinition,
  type CommandAliasMap,
  type CommandContext,
  type CommandDefinition,
  CommandRegistry,
  type CommandResult,
} from "./command-registry.js";
import { ShellHistory } from "./shell-history.js";
import { ShellRunner } from "./shell-runner.js";

export type TranscriptRole = "system" | "user" | "assistant" | "command";

export interface TranscriptEvent {
  role: TranscriptRole;
  content: string;
}

export type CommandMetadata = Pick<CommandDefinition, "name" | "usage" | "description">;
export type CommandAliasMetadata = Pick<CommandAliasDefinition, "alias" | "target">;

export type SubmitResult = {
  events: TranscriptEvent[];
  clearTranscript: boolean;
  shouldExit: boolean;
  stream?: AsyncIterable<string>;
  streamRole?: TranscriptRole;
  commitAssistant?: (response: string) => void;
};

export interface SubmitOptions {
  readonly terminalWidth?: number;
}

export class RuntimeController {
  private readonly session: ChatSession;
  private readonly commandRegistry: CommandRegistry;
  private readonly shellRunner: ShellRunner;
  private readonly shellHistory: ShellHistory;
  private readonly explanationService: ExplanationService;

  private running = true;
  private cwd: string;
  private previousCwd: string | undefined;
  private executionCounter = 1;

  constructor(options?: {
    session?: ChatSession;
    commandRegistry?: CommandRegistry;
    commandAliases?: CommandAliasMap;
    shellRunner?: ShellRunner;
    shellHistory?: ShellHistory;
    explanationService?: ExplanationService;
    initialCwd?: string;
  }) {
    this.session = options?.session ?? new ChatSession();
    this.shellRunner = options?.shellRunner ?? new ShellRunner();
    this.shellHistory = options?.shellHistory ?? new ShellHistory();
    this.explanationService = options?.explanationService ?? new ExplanationService();
    this.commandRegistry =
      options?.commandRegistry ?? buildDefaultCommandRegistry({ aliases: options?.commandAliases });
    this.cwd = path.resolve(options?.initialCwd ?? process.cwd());
  }

  getShellSummary(): string {
    return `${this.shellRunner.getShell()} @ ${this.cwd}`;
  }

  getCurrentWorkingDirectory(): string {
    return this.cwd;
  }

  getAssistantSummary(): string {
    const provider = this.explanationService.providerMetadata();
    return provider.baseUrl ? `${provider.kind}:${provider.model} @ ${provider.baseUrl}` : `${provider.kind}:${provider.model}`;
  }

  getAssistantName(): string {
    return this.explanationService.providerMetadata().model;
  }

  listCommands(): readonly CommandMetadata[] {
    return this.commandRegistry.listCommands().map((command) => ({
      name: command.name,
      usage: command.usage,
      description: command.description,
    }));
  }

  listCommandAliases(): readonly CommandAliasMetadata[] {
    return this.commandRegistry.listAliases().map((alias) => ({
      alias: alias.alias,
      target: alias.target,
    }));
  }

  isRunning(): boolean {
    return this.running;
  }

  submitLine(rawLine: string, options?: SubmitOptions): SubmitResult {
    const line = rawLine.trim();
    if (!line) {
      return {
        events: [],
        clearTranscript: false,
        shouldExit: !this.running,
      };
    }

    const commandContext: CommandContext = {
      session: this.session,
      requestStop: () => {
        this.running = false;
      },
      listCommands: () => this.commandRegistry.listCommands(),
      listAliases: () => this.commandRegistry.listAliases(),
      getRuntimeStatus: () => this.getRuntimeStatusLines(),
      getAssistantIdentity: () => this.getAssistantIdentityLines(),
      explainCommand: (command) => this.streamExplanation(command),
    };

    const commandDispatch = this.commandRegistry.dispatch(line, commandContext);
    if (commandDispatch.handled) {
      return this.mapCommandResult(commandDispatch.result);
    }

    return {
      events: [],
      clearTranscript: false,
      shouldExit: !this.running,
      stream: this.streamShellCommand(line, options?.terminalWidth),
      streamRole: "command",
    };
  }

  private mapCommandResult(result: CommandResult): SubmitResult {
    return {
      events: result.systemMessages.map((content) => ({
        role: "system",
        content,
      })),
      clearTranscript: Boolean(result.clearTranscript),
      shouldExit: !this.running,
      stream: result.stream,
      streamRole: "assistant",
      commitAssistant: (response) => {
        if (response) {
          this.session.addAssistant(response);
        }
      },
    };
  }

  private getRuntimeStatusLines(): readonly string[] {
    return [
      "CLIA-term status:",
      `Shell: ${this.shellRunner.getShell()}`,
      `Working directory: ${this.cwd}`,
      `Assistant: ${this.getAssistantSummary()}`,
    ];
  }

  private getAssistantIdentityLines(): readonly string[] {
    const provider = this.explanationService.providerMetadata();
    const lines = [
      "Active assistant:",
      `Provider: ${provider.kind}`,
      `Model: ${provider.model}`,
    ];

    if (provider.baseUrl) {
      lines.push(`Base URL: ${provider.baseUrl}`);
    }

    return lines;
  }

  private nextExecutionId(): number {
    const id = this.executionCounter;
    this.executionCounter += 1;
    return id;
  }

  private async runShellCommand(command: string): Promise<CommandExecution> {
    const beforeCwd = this.cwd;
    const execution = await this.shellRunner.run(command, {
      cwd: beforeCwd,
      previousCwd: this.previousCwd,
      executionId: this.nextExecutionId(),
    });

    if (execution.exitCode === 0 && execution.cwdAfter && execution.cwdAfter !== this.cwd) {
      this.previousCwd = this.cwd;
      this.cwd = execution.cwdAfter;
    }

    this.shellHistory.add(execution);
    return execution;
  }

  private streamShellCommand(command: string, terminalWidth = 80): AsyncIterable<string> {
    const self = this;
    return (async function* shellCommandStream(): AsyncIterable<string> {
      self.session.addUser(command);
      try {
        const execution = await self.runShellCommand(command);
        const transcript = formatShellExecutionForTranscript(execution, terminalWidth);
        self.session.addAssistant(transcript);
        yield transcript;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = `% ${command}\nCommand failed: ${message}`;
        self.session.addAssistant(failure);
        yield failure;
      }
    })();
  }

  private streamExplanation(command?: string): AsyncIterable<string> {
    const self = this;
    return (async function* explanationStream(): AsyncIterable<string> {
      const latestExecution = self.shellHistory.latest();
      const commandToExplain = command ?? latestExecution?.command;

      if (!commandToExplain) {
        yield "No previous shell command to explain. Use /explain <command>.";
        return;
      }

      self.session.addUser(`/explain ${commandToExplain}`);

      try {
        yield* self.explanationService.explainCommand({
          command: commandToExplain,
          cwd: latestExecution?.cwd ?? self.cwd,
          shell: self.shellRunner.getShell(),
          execution: command ? undefined : latestExecution,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield `Explanation failed: ${message}`;
      }
    })();
  }
}
