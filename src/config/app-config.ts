import { promises as fs } from "node:fs";
import path from "node:path";

import type { CommandAliasMap } from "../core/command-registry.js";
import type { ExplanationProviderConfig, ExplanationProviderKind } from "../providers/explanation-provider.js";
import { KEYBINDING_ACTIONS, type KeybindingAction, type KeybindingAliasMap, type KeybindingOverrides } from "../ui/keybindings.js";

const DEFAULT_CONFIG_FILES = [
  "clia-term.config.json",
  ".clia-termrc.json",
] as const;

export interface AppConfig {
  readonly configPath?: string;
  readonly keybindings?: KeybindingOverrides;
  readonly commandAliases?: CommandAliasMap;
  readonly keybindingAliases?: KeybindingAliasMap;
  readonly assistant?: ExplanationProviderConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKeybindingAction(value: string): value is KeybindingAction {
  return (KEYBINDING_ACTIONS as readonly string[]).includes(value);
}

function parseKeybindingOverrides(value: unknown): KeybindingOverrides | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("config.keybindings must be an object");
  }

  const overrides: KeybindingOverrides = {};

  for (const [key, rawBinding] of Object.entries(value)) {
    if (!isKeybindingAction(key)) {
      throw new Error(`Unknown keybinding action: ${key}`);
    }

    if (typeof rawBinding === "string") {
      overrides[key] = rawBinding;
      continue;
    }

    if (Array.isArray(rawBinding) && rawBinding.every((entry) => typeof entry === "string")) {
      overrides[key] = rawBinding;
      continue;
    }

    throw new Error(`Invalid binding for action ${key}. Expected string or string[]`);
  }

  return overrides;
}

function isKnownKeyToken(token: string): boolean {
  return [
    "up",
    "arrowup",
    "down",
    "arrowdown",
    "left",
    "arrowleft",
    "right",
    "arrowright",
    "pageup",
    "pagedown",
    "home",
    "end",
    "enter",
    "return",
    "tab",
    "backspace",
    "delete",
    "del",
    "escape",
    "esc",
    "space",
  ].includes(token);
}

function looksLikeKeybindingAlias(alias: string): boolean {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const parts = normalized.split("+").map((token) => token.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return true;
  }

  const [token] = parts;
  return isKnownKeyToken(token);
}

function parseCommandAliasMap(value: unknown): CommandAliasMap | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("aliases.commands must be an object");
  }

  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(value)) {
    if (typeof target !== "string") {
      throw new Error(`Invalid command alias for ${alias}. Expected a string target command.`);
    }
    aliases[alias] = target;
  }
  return aliases;
}

function parseKeybindingAliasMap(value: unknown): KeybindingAliasMap | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("aliases.keybindings must be an object");
  }

  const aliases: Record<string, KeybindingAction> = {};
  for (const [binding, action] of Object.entries(value)) {
    if (typeof action !== "string" || !isKeybindingAction(action)) {
      throw new Error(`Invalid keybinding alias for ${binding}. Expected one of: ${KEYBINDING_ACTIONS.join(", ")}`);
    }
    aliases[binding] = action;
  }

  return aliases;
}

function parseAliases(value: unknown): { commandAliases?: CommandAliasMap; keybindingAliases?: KeybindingAliasMap } {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("config.aliases must be an object");
  }

  const commandAliases: Record<string, string> = {
    ...(parseCommandAliasMap(value.commands) ?? {}),
  };
  const keybindingAliases: Record<string, KeybindingAction> = {
    ...(parseKeybindingAliasMap(value.keybindings) ?? {}),
  };

  for (const [alias, target] of Object.entries(value)) {
    if (alias === "commands" || alias === "keybindings") {
      continue;
    }

    if (typeof target !== "string") {
      throw new Error(`Invalid alias value for ${alias}. Expected a string.`);
    }

    if (looksLikeKeybindingAlias(alias)) {
      if (!isKeybindingAction(target)) {
        throw new Error(
          `Invalid action \"${target}\" for keybinding alias \"${alias}\". Expected one of: ${KEYBINDING_ACTIONS.join(", ")}`,
        );
      }
      keybindingAliases[alias] = target;
      continue;
    }

    commandAliases[alias] = target;
  }

  return {
    commandAliases: Object.keys(commandAliases).length ? commandAliases : undefined,
    keybindingAliases: Object.keys(keybindingAliases).length ? keybindingAliases : undefined,
  };
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  return value.trim() || undefined;
}

function parseProviderKind(value: unknown): ExplanationProviderKind | undefined {
  const rawValue = parseOptionalString(value, "config.assistant.provider");
  if (rawValue === undefined) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "mock" || normalized === "ollama" || normalized === "openai-compatible") {
    return normalized;
  }

  if (normalized === "openai") {
    return "openai-compatible";
  }

  throw new Error('config.assistant.provider must be one of: "mock", "ollama", "openai-compatible"');
}

function parseAssistantConfig(value: unknown): AppConfig["assistant"] {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("config.assistant must be an object");
  }

  const apiKey = parseOptionalString(value.apiKey, "config.assistant.apiKey");
  const apiKeyEnv = parseOptionalString(value.apiKeyEnv, "config.assistant.apiKeyEnv");
  const parsed = {
    provider: parseProviderKind(value.provider),
    model: parseOptionalString(value.model, "config.assistant.model"),
    baseUrl: parseOptionalString(value.baseUrl, "config.assistant.baseUrl"),
    apiKey: apiKey ?? (apiKeyEnv ? process.env[apiKeyEnv] : undefined),
    systemPrompt: parseOptionalString(value.systemPrompt, "config.assistant.systemPrompt"),
  };

  if (
    parsed.provider === undefined &&
    parsed.model === undefined &&
    parsed.baseUrl === undefined &&
    parsed.apiKey === undefined &&
    parsed.systemPrompt === undefined
  ) {
    return undefined;
  }

  return parsed;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveConfigPath(explicitPath?: string): Promise<string | undefined> {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  for (const filename of DEFAULT_CONFIG_FILES) {
    const candidate = path.resolve(filename);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export async function loadAppConfig(explicitPath?: string): Promise<AppConfig> {
  const resolvedPath = await resolveConfigPath(explicitPath);
  if (!resolvedPath) {
    return {};
  }

  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("Config file must contain a JSON object");
  }

  const aliases = parseAliases(parsed.aliases);

  return {
    configPath: resolvedPath,
    keybindings: parseKeybindingOverrides(parsed.keybindings),
    commandAliases: aliases.commandAliases,
    keybindingAliases: aliases.keybindingAliases,
    assistant: parseAssistantConfig(parsed.assistant),
  };
}
