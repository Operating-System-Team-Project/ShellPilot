#!/usr/bin/env node
import { render } from "ink";
import React from "react";

import { loadAppConfig } from "./config/app-config.js";
import { createRuntime } from "./core/create-runtime.js";
import type { ExplanationProviderKind } from "./providers/explanation-provider.js";
import { App } from "./ui/app.js";
import { resolveKeybindings } from "./ui/keybindings.js";

type CliArgs = {
  oncePrompt?: string;
  configPath?: string;
  showHelp: boolean;
  assistantProvider?: ExplanationProviderKind;
  assistantModel?: string;
  assistantBaseUrl?: string;
  assistantApiKey?: string;
};

function parseProviderKind(rawValue: string | undefined): ExplanationProviderKind | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "mock" || normalized === "ollama" || normalized === "openai-compatible") {
    return normalized;
  }

  if (normalized === "openai") {
    return "openai-compatible";
  }

  return undefined;
}

function parseArguments(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    showHelp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--once") {
      const value = argv[index + 1];
      if (value) {
        args.oncePrompt = value;
        index += 1;
      }
      continue;
    }

    if (token === "--config") {
      const value = argv[index + 1];
      if (value) {
        args.configPath = value;
        index += 1;
      }
      continue;
    }

    if (token === "--assistant-provider") {
      const value = parseProviderKind(argv[index + 1]);
      if (value) {
        args.assistantProvider = value;
        index += 1;
      }
      continue;
    }

    if (token === "--assistant-model") {
      const value = argv[index + 1];
      if (value) {
        args.assistantModel = value;
        index += 1;
      }
      continue;
    }

    if (token === "--assistant-base-url") {
      const value = argv[index + 1];
      if (value) {
        args.assistantBaseUrl = value;
        index += 1;
      }
      continue;
    }

    if (token === "--assistant-api-key") {
      const value = argv[index + 1];
      if (value) {
        args.assistantApiKey = value;
        index += 1;
      }
      continue;
    }

    if (token === "-h" || token === "--help") {
      args.showHelp = true;
    }
  }

  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      "CLIA-term - Interactive shell with explicit command explanations",
      "",
      "Usage:",
      "  clia-term [--config <path>] [--once <command-or-internal-command>]",
      "            [--assistant-provider <mock|ollama|openai-compatible>]",
      "            [--assistant-model <model>] [--assistant-base-url <url>]",
      "",
      "Options:",
      "  --config <path>                      Load JSON configuration file",
      "                                       (default: clia-term.config.json/.clia-termrc.json)",
      "  --once <input>                       Run one input line and exit",
      "  --assistant-provider <provider>      Override assistant provider",
      "  --assistant-model <model>            Override assistant model",
      "  --assistant-base-url <url>           Override assistant base URL",
      "  --assistant-api-key <key>            Override assistant API key for cloud providers",
      "  -h, --help                           Show this help",
      "",
      "Runtime:",
      "  Type shell commands directly to execute them.",
      "  Use /explain to explain the previous command, or /explain <command> for a specific command.",
      "  Use /help inside the app for internal commands.",
      "",
    ].join("\n"),
  );
}

async function runOnce(prompt: string, runtime: ReturnType<typeof createRuntime>): Promise<number> {
  const result = runtime.submitLine(prompt, { terminalWidth: process.stdout.columns ?? 80 });

  for (const event of result.events) {
    process.stdout.write(`${event.role}> ${event.content}\n`);
  }

  if (result.stream) {
    let fullResponse = "";
    for await (const chunk of result.stream) {
      fullResponse += chunk;
      process.stdout.write(chunk);
    }
    process.stdout.write("\n");
    result.commitAssistant?.(fullResponse.trim());
  }

  return 0;
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));
  const appConfig = await loadAppConfig(args.configPath);
  const keybindings = resolveKeybindings(appConfig.keybindings, appConfig.keybindingAliases);

  if (args.showHelp) {
    printHelp();
    return 0;
  }

  const runtime = createRuntime({
    commandAliases: appConfig.commandAliases,
    assistant: {
      ...appConfig.assistant,
      provider: args.assistantProvider ?? appConfig.assistant?.provider,
      model: args.assistantModel ?? appConfig.assistant?.model,
      baseUrl: args.assistantBaseUrl ?? appConfig.assistant?.baseUrl,
      apiKey: args.assistantApiKey ?? appConfig.assistant?.apiKey,
    },
  });

  if (args.oncePrompt) {
    return runOnce(args.oncePrompt, runtime);
  }

  render(<App runtime={runtime} keybindings={keybindings} configPath={appConfig.configPath} />);
  return 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
