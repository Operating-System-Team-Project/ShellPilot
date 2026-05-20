import type { ChatSession } from "../domain/chat-session.js";
import type { Message } from "../domain/message.js";

export type CommandResult = {
  systemMessages: string[];
  clearTranscript?: boolean;
  stream?: AsyncIterable<string>;
};

export interface CommandContext {
  readonly session: ChatSession;
  requestStop(): void;
  listCommands(): readonly CommandDefinition[];
  listAliases(): readonly CommandAliasDefinition[];
  getRuntimeStatus(): readonly string[];
  getAssistantIdentity(): readonly string[];
  explainCommand(command?: string): AsyncIterable<string>;
}

export interface CommandDefinition {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  execute(args: readonly string[], context: CommandContext): CommandResult;
}

export type CommandAliasMap = Readonly<Record<string, string>>;
export type CommandAliasDefinition = Readonly<{ alias: string; target: string }>;

export type DispatchResult = {
  handled: boolean;
  result: CommandResult;
};

const DEFAULT_HISTORY_COUNT = 8;

function parseCount(rawValue: string | undefined): number | null {
  if (!rawValue) {
    return DEFAULT_HISTORY_COUNT;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function formatHistoryLine(index: number, message: Message): string {
  return `${String(index).padStart(2, "0")} ${message.role.padEnd(9, " ")} ${message.content}`;
}

function tokenizeCommand(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function normalizeCommandToken(token: string): string {
  return token.trim().replace(/^\//, "").toLowerCase();
}

export class CommandRegistry {
  private readonly commandsByName: Map<string, CommandDefinition>;
  private readonly aliasesByName: Map<string, string>;

  constructor(commands: readonly CommandDefinition[], aliases?: CommandAliasMap) {
    this.commandsByName = new Map(commands.map((command) => [normalizeCommandToken(command.name), command]));
    this.aliasesByName = new Map();

    for (const [alias, target] of Object.entries(aliases ?? {})) {
      const normalizedAlias = normalizeCommandToken(alias);
      const normalizedTarget = normalizeCommandToken(target);
      if (!normalizedAlias || !normalizedTarget) {
        continue;
      }
      this.aliasesByName.set(normalizedAlias, normalizedTarget);
    }
  }

  listCommands(): readonly CommandDefinition[] {
    return Array.from(this.commandsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listAliases(): readonly CommandAliasDefinition[] {
    return Array.from(this.aliasesByName.entries())
      .filter(([, target]) => this.commandsByName.has(target))
      .sort(([leftAlias], [rightAlias]) => leftAlias.localeCompare(rightAlias))
      .map(([alias, target]) => ({ alias, target }));
  }

  dispatch(line: string, context: CommandContext): DispatchResult {
    if (!line.startsWith("/")) {
      const bareAlias = normalizeCommandToken(line);
      const bareTarget = this.aliasesByName.get(bareAlias);
      if (bareTarget) {
        const bareCommand = this.commandsByName.get(bareTarget);
        if (bareCommand) {
          return {
            handled: true,
            result: bareCommand.execute([], context),
          };
        }
      }

      return {
        handled: false,
        result: {
          systemMessages: [],
        },
      };
    }

    const tokens = tokenizeCommand(line.slice(1));
    if (tokens.length === 0) {
      return {
        handled: true,
        result: {
          systemMessages: ["Empty command."],
        },
      };
    }

    const [name, ...args] = tokens;
    const normalizedName = normalizeCommandToken(name);
    const resolvedName = this.aliasesByName.get(normalizedName) ?? normalizedName;
    const command = this.commandsByName.get(resolvedName);
    if (!command) {
      return {
        handled: true,
        result: {
          systemMessages: [`Unknown command: /${name}. Try /help`],
        },
      };
    }

    return {
      handled: true,
      result: command.execute(args, context),
    };
  }
}

export function buildDefaultCommandRegistry(options?: { aliases?: CommandAliasMap }): CommandRegistry {
  const commands: CommandDefinition[] = [
    {
      name: "alias",
      usage: "/alias",
      description: "List configured command aliases",
      execute: (_args, context) => {
        const aliases = context.listAliases();
        if (aliases.length === 0) {
          return {
            systemMessages: ["No aliases configured."],
          };
        }

        const lines = ["Configured aliases:"];
        for (const alias of aliases) {
          lines.push(`${alias.alias.padEnd(12, " ")} -> /${alias.target}`);
        }
        return { systemMessages: lines };
      },
    },
    {
      name: "clear",
      usage: "/clear",
      description: "Clear transcript and reset conversation messages",
      execute: (_args, context) => {
        context.session.clear();
        return {
          systemMessages: [],
          clearTranscript: true,
        };
      },
    },
    {
      name: "exit",
      usage: "/exit",
      description: "Exit the application",
      execute: (_args, context) => {
        context.requestStop();
        return {
          systemMessages: ["Exiting..."],
        };
      },
    },
    {
      name: "explain",
      usage: "/explain [command]",
      description: "Explain the previous shell command or the command argument",
      execute: (args, context) => ({
        systemMessages: [],
        stream: context.explainCommand(args.join(" ").trim() || undefined),
      }),
    },
    {
      name: "help",
      usage: "/help",
      description: "Show available commands",
      execute: (_args, context) => {
        const lines = ["Available commands:"];
        for (const command of context.listCommands()) {
          lines.push(`${command.usage.padEnd(24, " ")} ${command.description}`);
        }
        return { systemMessages: lines };
      },
    },
    {
      name: "history",
      usage: "/history [count]",
      description: "Show latest messages from current session",
      execute: (args, context) => {
        const count = parseCount(args[0]);
        if (count === null) {
          return {
            systemMessages: ["Usage: /history [count]"],
          };
        }

        const history = context.session.tail(count);
        if (history.length === 0) {
          return {
            systemMessages: ["No messages yet."],
          };
        }

        const lines = history.map((message, index) => formatHistoryLine(index + 1, message));
        return {
          systemMessages: lines,
        };
      },
    },
    {
      name: "quit",
      usage: "/quit",
      description: "Alias for /exit",
      execute: (_args, context) => {
        context.requestStop();
        return {
          systemMessages: ["Exiting..."],
        };
      },
    },
    {
      name: "status",
      usage: "/status",
      description: "Show shell and assistant provider status",
      execute: (_args, context) => ({
        systemMessages: [...context.getRuntimeStatus()],
      }),
    },
    {
      name: "whatami",
      usage: "/whatami",
      description: "Show the active AI provider and model",
      execute: (_args, context) => ({
        systemMessages: [...context.getAssistantIdentity()],
      }),
    },
  ];

  return new CommandRegistry(commands, options?.aliases);
}
