import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadAppConfig } from "../../src/config/app-config.js";

const tempRoots: string[] = [];
const previousApiKey = process.env.CLIA_TEST_KEY;

async function writeConfig(config: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "clia-config-"));
  tempRoots.push(root);
  const configPath = path.join(root, "clia-term.config.json");
  await fs.writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

afterEach(async () => {
  if (previousApiKey === undefined) {
    delete process.env.CLIA_TEST_KEY;
  } else {
    process.env.CLIA_TEST_KEY = previousApiKey;
  }

  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("loadAppConfig", () => {
  it("loads explicit config paths and normalizes aliases and provider settings", async () => {
    process.env.CLIA_TEST_KEY = "secret";
    const configPath = await writeConfig({
      keybindings: {
        submit: ["enter", "ctrl+m"],
      },
      aliases: {
        commands: {
          "?": "help",
        },
        keybindings: {
          "ctrl+x": "exit",
        },
        "!": "status",
        "ctrl+q": "exit",
      },
      assistant: {
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1/",
        apiKeyEnv: "CLIA_TEST_KEY",
      },
    });

    const config = await loadAppConfig(configPath);

    expect(config.configPath).toBe(path.resolve(configPath));
    expect(config.keybindings?.submit).toEqual(["enter", "ctrl+m"]);
    expect(config.commandAliases).toEqual({
      "?": "help",
      "!": "status",
    });
    expect(config.keybindingAliases).toEqual({
      "ctrl+x": "exit",
      "ctrl+q": "exit",
    });
    expect(config.assistant).toEqual({
      provider: "openai-compatible",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1/",
      apiKey: "secret",
      systemPrompt: undefined,
    });
  });

  it("rejects invalid config shapes", async () => {
    const configPath = await writeConfig({
      keybindings: {
        unknownAction: "enter",
      },
    });

    await expect(loadAppConfig(configPath)).rejects.toThrow("Unknown keybinding action: unknownAction");
  });
});
