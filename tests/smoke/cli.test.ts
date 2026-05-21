import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

async function createConfig(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "clia-cli-"));
  tempRoots.push(root);
  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify({ assistant: { provider: "mock" } }), "utf8");
  return configPath;
}

async function runCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", path.join("src", "index.tsx"), ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("CLI smoke", () => {
  it("prints help without entering the interactive UI", async () => {
    const configPath = await createConfig();

    const { stdout, stderr } = await runCli(["--config", configPath, "--help"]);

    expect(stderr).toBe("");
    expect(stdout).toContain("CLIA-term - Interactive shell with explicit command explanations");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--once <input>");
  });

  it("runs one internal command with the mock assistant provider", async () => {
    const configPath = await createConfig();

    const { stdout, stderr } = await runCli([
      "--config",
      configPath,
      "--once",
      "/whatami",
      "--assistant-provider",
      "mock",
    ]);

    expect(stderr).toBe("");
    expect(stdout).toContain("system> Active assistant:");
    expect(stdout).toContain("system> Provider: mock");
    expect(stdout).toContain("system> Model: mock-explainer");
  });
});
