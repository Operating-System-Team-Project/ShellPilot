import { describe, expect, it } from "vitest";

import {
  formatExecutionForTranscript,
  formatExecutionStatus,
  formatShellExecutionForTranscript,
  formatShellPromptLine,
  type CommandExecution,
} from "../../src/domain/command-execution.js";

function createExecution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const finishedAt = new Date("2026-01-01T00:00:00.007Z");

  return {
    id: 1,
    command: "pwd",
    cwd: "/workspace",
    shell: "/bin/sh",
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
    signal: null,
    startedAt,
    finishedAt,
    durationMs: 7,
    ...overrides,
  };
}

describe("command execution formatting", () => {
  it("formats execution status with cwd changes", () => {
    const execution = createExecution({ cwdAfter: "/workspace/src" });

    expect(formatExecutionStatus(execution)).toBe("[exit 0 in 7ms, cwd: /workspace/src]");
  });

  it("formats stdout, stderr, and status for assistant context", () => {
    const execution = createExecution({
      stdout: "hello\n\n",
      stderr: "warn\n",
    });

    expect(formatExecutionForTranscript(execution)).toBe("hello\nstderr:\nwarn\n[exit 0 in 7ms]");
  });

  it("formats shell prompt lines to the requested width", () => {
    const line = formatShellPromptLine("ls", 0, 12);

    expect(line.startsWith("% ls")).toBe(true);
    expect(line.endsWith("0 \u21b5")).toBe(true);
    expect(line.length).toBe(12);
  });

  it("formats shell transcript without assistant status metadata", () => {
    const execution = createExecution({
      command: "echo ok",
      stdout: "ok\n",
      stderr: "warn\n",
    });

    expect(formatShellExecutionForTranscript(execution, 20)).toBe("% echo ok        0 \u21b5\nok\nwarn");
  });
});
