export interface CommandExecution {
  readonly id: number;
  readonly command: string;
  readonly cwd: string;
  readonly cwdAfter?: string;
  readonly shell: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
}

function trimRight(value: string): string {
  return value.replace(/\s+$/g, "");
}

export function formatExecutionStatus(execution: CommandExecution): string {
  const status =
    execution.exitCode === null
      ? `signal ${execution.signal ?? "unknown"}`
      : `exit ${String(execution.exitCode)}`;
  const cwdSuffix =
    execution.cwdAfter && execution.cwdAfter !== execution.cwd ? `, cwd: ${execution.cwdAfter}` : "";
  return `[${status} in ${String(execution.durationMs)}ms${cwdSuffix}]`;
}

export function formatExecutionForTranscript(execution: CommandExecution): string {
  const sections: string[] = [];
  const stdout = trimRight(execution.stdout);
  const stderr = trimRight(execution.stderr);

  if (stdout) {
    sections.push(stdout);
  }

  if (stderr) {
    sections.push(`stderr:\n${stderr}`);
  }

  sections.push(formatExecutionStatus(execution));
  return sections.join("\n");
}

export function formatShellExecutionForTranscript(
  execution: CommandExecution,
  terminalWidth: number,
): string {
  const sections: string[] = [formatShellPromptLine(execution.command, execution.exitCode, terminalWidth)];
  const stdout = trimRight(execution.stdout);
  const stderr = trimRight(execution.stderr);

  if (stdout) {
    sections.push(stdout);
  }

  if (stderr) {
    sections.push(stderr);
  }

  return sections.join("\n");
}

export function formatShellPromptLine(
  command: string,
  exitCode: number | null,
  terminalWidth: number,
): string {
  const left = `% ${command}`;
  const right = `${String(exitCode ?? 1)} ↵`;
  const safeWidth = Math.max(left.length + right.length + 1, terminalWidth);
  const gap = " ".repeat(Math.max(1, safeWidth - left.length - right.length));
  return `${left}${gap}${right}`;
}
