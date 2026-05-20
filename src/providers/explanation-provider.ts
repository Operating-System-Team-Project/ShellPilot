import os from "node:os";

import type { CommandExecution } from "../domain/command-execution.js";

export type ExplanationProviderKind = "mock" | "ollama" | "openai-compatible";

export interface ExplanationProviderMetadata {
  readonly kind: ExplanationProviderKind;
  readonly model: string;
  readonly baseUrl?: string;
}

export interface ExplanationRequest {
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly execution?: CommandExecution;
}

export interface ExplanationProvider {
  metadata(): ExplanationProviderMetadata;
  explainCommand(request: ExplanationRequest): AsyncIterable<string>;
}

export interface ExplanationProviderConfig {
  readonly provider?: ExplanationProviderKind;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly systemPrompt?: string;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

const MAX_OUTPUT_CHARS = 4000;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function formatExecutionContext(execution: CommandExecution | undefined): string {
  if (!execution) {
    return "Execution context: not executed in this session.";
  }

  const exitStatus =
    execution.exitCode === null ? `signal ${execution.signal ?? "unknown"}` : `exit ${String(execution.exitCode)}`;
  const stdout = execution.stdout ? truncate(execution.stdout, MAX_OUTPUT_CHARS) : "(empty)";
  const stderr = execution.stderr ? truncate(execution.stderr, MAX_OUTPUT_CHARS) : "(empty)";

  return [
    "Execution context:",
    `- Status: ${exitStatus}`,
    `- Duration: ${String(execution.durationMs)}ms`,
    `- Working directory before: ${execution.cwd}`,
    execution.cwdAfter ? `- Working directory after: ${execution.cwdAfter}` : undefined,
    "- stdout:",
    stdout,
    "- stderr:",
    stderr,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function buildExplanationMessages(
  request: ExplanationRequest,
  systemPrompt?: string,
): readonly ChatMessage[] {
  const system =
    systemPrompt ??
    [
      "You explain shell commands to a terminal user.",
      "Be concise and practical.",
      "Explain what the command does, important options and arguments, side effects, risks, and how to verify the result.",
      "If execution output is provided, use it as context without inventing missing facts.",
    ].join(" ");

  return [
    {
      role: "system",
      content: system,
    },
    {
      role: "user",
      content: [
        `Command: ${request.command}`,
        `Shell: ${request.shell}`,
        `Working directory: ${request.cwd}`,
        `Platform: ${os.platform()} ${os.release()} (${os.arch()})`,
        formatExecutionContext(request.execution),
      ].join("\n"),
    },
  ];
}
