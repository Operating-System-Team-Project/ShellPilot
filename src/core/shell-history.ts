import type { CommandExecution } from "../domain/command-execution.js";

export class ShellHistory {
  private readonly executions: CommandExecution[] = [];

  add(execution: CommandExecution): void {
    this.executions.push(execution);
  }

  latest(): CommandExecution | undefined {
    return this.executions.at(-1);
  }

  tail(count = 8): readonly CommandExecution[] {
    if (count <= 0) {
      return [];
    }

    return this.executions.slice(-count);
  }

  clear(): void {
    this.executions.length = 0;
  }
}
