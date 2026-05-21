import { describe, expect, it } from "vitest";

import type { CommandExecution } from "../../src/domain/command-execution.js";
import { ShellHistory } from "../../src/core/shell-history.js";

function createExecution(id: number): CommandExecution {
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const finishedAt = new Date("2026-01-01T00:00:00.001Z");

  return {
    id,
    command: `command-${String(id)}`,
    cwd: "/workspace",
    shell: "/bin/sh",
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    startedAt,
    finishedAt,
    durationMs: 1,
  };
}

describe("ShellHistory", () => {
  it("tracks latest execution and bounded tails", () => {
    const history = new ShellHistory();

    expect(history.latest()).toBeUndefined();
    expect(history.tail()).toEqual([]);

    const first = createExecution(1);
    const second = createExecution(2);
    history.add(first);
    history.add(second);

    expect(history.latest()).toBe(second);
    expect(history.tail(1)).toEqual([second]);
    expect(history.tail(10)).toEqual([first, second]);
    expect(history.tail(0)).toEqual([]);
  });

  it("clears stored executions", () => {
    const history = new ShellHistory();
    history.add(createExecution(1));

    history.clear();

    expect(history.latest()).toBeUndefined();
    expect(history.tail()).toEqual([]);
  });
});
