import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CommandExecution } from "../domain/command-execution.js";

export interface ShellRunOptions {
  readonly cwd: string;
  readonly previousCwd?: string;
  readonly executionId: number;
}

type DirectoryChangeCommand = {
  readonly target?: string;
  readonly previous: boolean;
};

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }

  return process.env.SHELL ?? "/bin/sh";
}

function shellArguments(command: string): readonly string[] {
  if (process.platform === "win32") {
    return ["/d", "/s", "/c", command];
  }

  return ["-lc", command];
}

function stripMatchingQuotes(value: string): string | undefined {
  if (value.length < 2) {
    return value || undefined;
  }

  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return value;
  }

  const inner = value.slice(1, -1);
  if (quote === "'") {
    return inner;
  }

  return inner.replace(/\\(["\\$`])/g, "$1");
}

function parseSingleDirectoryTarget(rawTarget: string): string | undefined {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/\s/.test(trimmed) && !/^(['"]).*\1$/.test(trimmed)) {
    return undefined;
  }

  return stripMatchingQuotes(trimmed);
}

function parseDirectoryChange(command: string): DirectoryChangeCommand | null {
  const trimmed = command.trim();
  if (trimmed === "cd") {
    return { previous: false };
  }

  if (!trimmed.startsWith("cd ")) {
    return null;
  }

  const target = parseSingleDirectoryTarget(trimmed.slice(3));
  if (target === undefined) {
    return null;
  }

  if (target === "-") {
    return { previous: true };
  }

  return { target, previous: false };
}

function expandHomeDirectory(target: string): string {
  if (target === "~") {
    return os.homedir();
  }

  if (target.startsWith("~/")) {
    return path.join(os.homedir(), target.slice(2));
  }

  return target;
}

function createExecution(params: {
  readonly id: number;
  readonly command: string;
  readonly cwd: string;
  readonly cwdAfter?: string;
  readonly shell: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: Date;
}): CommandExecution {
  const finishedAt = new Date();
  return {
    id: params.id,
    command: params.command,
    cwd: params.cwd,
    cwdAfter: params.cwdAfter,
    shell: params.shell,
    stdout: params.stdout ?? "",
    stderr: params.stderr ?? "",
    exitCode: params.exitCode,
    signal: params.signal,
    startedAt: params.startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - params.startedAt.getTime(),
  };
}

export class ShellRunner {
  private readonly shell: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options?: { readonly shell?: string; readonly environment?: NodeJS.ProcessEnv }) {
    this.shell = options?.shell ?? defaultShell();
    this.environment = options?.environment ?? process.env;
  }

  getShell(): string {
    return this.shell;
  }

  async run(command: string, options: ShellRunOptions): Promise<CommandExecution> {
    const cwd = path.resolve(options.cwd);
    const startedAt = new Date();
    const directoryChange = parseDirectoryChange(command);

    if (directoryChange) {
      return this.runDirectoryChange(command, directoryChange, {
        cwd,
        previousCwd: options.previousCwd,
        executionId: options.executionId,
        startedAt,
      });
    }

    return this.runShellCommand(command, {
      cwd,
      executionId: options.executionId,
      startedAt,
    });
  }

  private async runDirectoryChange(
    command: string,
    directoryChange: DirectoryChangeCommand,
    options: ShellRunOptions & { readonly startedAt: Date },
  ): Promise<CommandExecution> {
    const target = directoryChange.previous
      ? options.previousCwd
      : expandHomeDirectory(directoryChange.target ?? os.homedir());

    if (!target) {
      return createExecution({
        id: options.executionId,
        command,
        cwd: options.cwd,
        shell: this.shell,
        stderr: "cd: previous directory is not available",
        exitCode: 1,
        signal: null,
        startedAt: options.startedAt,
      });
    }

    const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(options.cwd, target);

    try {
      const stat = await fs.stat(resolvedTarget);
      if (!stat.isDirectory()) {
        return createExecution({
          id: options.executionId,
          command,
          cwd: options.cwd,
          shell: this.shell,
          stderr: `cd: not a directory: ${resolvedTarget}`,
          exitCode: 1,
          signal: null,
          startedAt: options.startedAt,
        });
      }

      const cwdAfter = await fs.realpath(resolvedTarget);
      return createExecution({
        id: options.executionId,
        command,
        cwd: options.cwd,
        cwdAfter,
        shell: this.shell,
        stdout: cwdAfter,
        exitCode: 0,
        signal: null,
        startedAt: options.startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createExecution({
        id: options.executionId,
        command,
        cwd: options.cwd,
        shell: this.shell,
        stderr: `cd: ${message}`,
        exitCode: 1,
        signal: null,
        startedAt: options.startedAt,
      });
    }
  }

  private async runShellCommand(
    command: string,
    options: Pick<ShellRunOptions, "cwd" | "executionId"> & { readonly startedAt: Date },
  ): Promise<CommandExecution> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      let child;
      try {
        child = spawn(this.shell, shellArguments(command), {
          cwd: options.cwd,
          env: this.environment,
          windowsHide: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve(
          createExecution({
            id: options.executionId,
            command,
            cwd: options.cwd,
            shell: this.shell,
            stderr: message,
            exitCode: 1,
            signal: null,
            startedAt: options.startedAt,
          }),
        );
        return;
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        stderr += `${stderr ? "\n" : ""}${error.message}`;
      });

      child.on("close", (exitCode, signal) => {
        resolve(
          createExecution({
            id: options.executionId,
            command,
            cwd: options.cwd,
            shell: this.shell,
            stdout,
            stderr,
            exitCode,
            signal,
            startedAt: options.startedAt,
          }),
        );
      });
    });
  }
}
