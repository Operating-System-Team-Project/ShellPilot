import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ShellRunner } from "../../src/core/shell-runner.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "clia-shell-runner-"));
  tempRoots.push(root);
  return root;
}

function testShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }

  return "/bin/sh";
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("ShellRunner", () => {
  it("executes normal shell commands", async () => {
    const runner = new ShellRunner({ shell: testShell() });
    const root = await createTempRoot();
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('ok')"`;

    const execution = await runner.run(command, {
      cwd: root,
      executionId: 1,
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.stdout).toBe("ok");
    expect(execution.stderr).toBe("");
    expect(execution.cwdAfter).toBeUndefined();
  });

  it("handles persistent cd commands without spawning a shell", async () => {
    const runner = new ShellRunner({ shell: testShell() });
    const root = await createTempRoot();
    const child = path.join(root, "child");
    await fs.mkdir(child);

    const execution = await runner.run("cd child", {
      cwd: root,
      executionId: 1,
    });

    const realChild = await fs.realpath(child);
    expect(execution.exitCode).toBe(0);
    expect(execution.cwdAfter).toBe(realChild);
    expect(execution.stdout).toBe(realChild);
  });

  it("handles cd - with the previous working directory", async () => {
    const runner = new ShellRunner({ shell: testShell() });
    const root = await createTempRoot();
    const child = path.join(root, "child");
    await fs.mkdir(child);
    const realRoot = await fs.realpath(root);
    const realChild = await fs.realpath(child);

    const execution = await runner.run("cd -", {
      cwd: realChild,
      previousCwd: realRoot,
      executionId: 1,
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.cwdAfter).toBe(realRoot);
    expect(execution.stdout).toBe(realRoot);
  });

  it("reports directory change failures", async () => {
    const runner = new ShellRunner({ shell: testShell() });
    const root = await createTempRoot();
    await fs.writeFile(path.join(root, "file.txt"), "not a directory");

    const missingPrevious = await runner.run("cd -", {
      cwd: root,
      executionId: 1,
    });
    expect(missingPrevious.exitCode).toBe(1);
    expect(missingPrevious.stderr).toBe("cd: previous directory is not available");

    const missingDirectory = await runner.run("cd missing", {
      cwd: root,
      executionId: 2,
    });
    expect(missingDirectory.exitCode).toBe(1);
    expect(missingDirectory.stderr).toContain("cd:");

    const notDirectory = await runner.run("cd file.txt", {
      cwd: root,
      executionId: 3,
    });
    expect(notDirectory.exitCode).toBe(1);
    expect(notDirectory.stderr).toContain("not a directory");
  });
});
