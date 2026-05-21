import { describe, expect, it, vi } from "vitest";

import { ChatSession } from "../../src/domain/chat-session.js";
import {
  buildDefaultCommandRegistry,
  type CommandContext,
  type CommandRegistry,
} from "../../src/core/command-registry.js";

function createContext(registry: CommandRegistry, session = new ChatSession()) {
  const requestStop = vi.fn();
  const context: CommandContext = {
    session,
    requestStop,
    listCommands: () => registry.listCommands(),
    listAliases: () => registry.listAliases(),
    getRuntimeStatus: () => ["status line"],
    getAssistantIdentity: () => ["assistant line"],
    explainCommand: async function* explainCommand(command?: string): AsyncIterable<string> {
      yield `explain ${command ?? "latest"}`;
    },
  };

  return { context, requestStop };
}

describe("CommandRegistry", () => {
  it("dispatches slash commands and leaves shell input unhandled", () => {
    const registry = buildDefaultCommandRegistry();
    const { context } = createContext(registry);

    const help = registry.dispatch("/help", context);
    expect(help.handled).toBe(true);
    expect(help.result.systemMessages.join("\n")).toContain("/explain");

    const unknown = registry.dispatch("/missing", context);
    expect(unknown.handled).toBe(true);
    expect(unknown.result.systemMessages).toEqual(["Unknown command: /missing. Try /help"]);

    const shellInput = registry.dispatch("ls -la", context);
    expect(shellInput.handled).toBe(false);
    expect(shellInput.result.systemMessages).toEqual([]);
  });

  it("resolves configured aliases and hides aliases with missing targets", () => {
    const registry = buildDefaultCommandRegistry({
      aliases: {
        "?": "help",
        bye: "exit",
        broken: "missing",
      },
    });
    const { context, requestStop } = createContext(registry);

    expect(registry.listAliases()).toEqual([
      { alias: "?", target: "help" },
      { alias: "bye", target: "exit" },
    ]);

    const bareAlias = registry.dispatch("?", context);
    expect(bareAlias.handled).toBe(true);
    expect(bareAlias.result.systemMessages.join("\n")).toContain("Available commands:");

    const slashAlias = registry.dispatch("/bye", context);
    expect(slashAlias.handled).toBe(true);
    expect(slashAlias.result.systemMessages).toEqual(["Exiting..."]);
    expect(requestStop).toHaveBeenCalledOnce();
  });

  it("formats history output and validates history counts", () => {
    const registry = buildDefaultCommandRegistry();
    const session = new ChatSession();
    session.addUser("pwd");
    session.addAssistant("/workspace");
    const { context } = createContext(registry, session);

    const history = registry.dispatch("/history 1", context);
    expect(history.handled).toBe(true);
    expect(history.result.systemMessages).toHaveLength(1);
    expect(history.result.systemMessages[0]).toContain("assistant");
    expect(history.result.systemMessages[0]).toContain("/workspace");

    const invalid = registry.dispatch("/history nope", context);
    expect(invalid.result.systemMessages).toEqual(["Usage: /history [count]"]);
  });
});
