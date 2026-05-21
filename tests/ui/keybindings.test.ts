import { describe, expect, it } from "vitest";

import {
  compileKeybindings,
  DEFAULT_KEYBINDINGS,
  resolveKeybindings,
} from "../../src/ui/keybindings.js";

describe("keybindings", () => {
  it("resolves overrides and appends aliases", () => {
    const config = resolveKeybindings(
      {
        submit: "ctrl+m",
      },
      {
        "ctrl+x": "exit",
      },
    );
    const compiled = compileKeybindings(config);

    expect(config.submit).toEqual(["ctrl+m"]);
    expect(config.exit).toContain("ctrl+x");
    expect(compiled.matches("submit", "m", { ctrl: true })).toBe(true);
    expect(compiled.matches("submit", "", { return: true })).toBe(false);
    expect(compiled.matches("exit", "x", { ctrl: true })).toBe(true);
  });

  it("matches default special keys", () => {
    const compiled = compileKeybindings(resolveKeybindings());

    expect(compiled.matches("submit", "", { return: true })).toBe(true);
    expect(compiled.matches("applySuggestion", "\t", {})).toBe(true);
    expect(compiled.matches("scrollPageUp", "", { pageUp: true })).toBe(true);
  });

  it("rejects bindings without a key token", () => {
    expect(() =>
      compileKeybindings({
        ...DEFAULT_KEYBINDINGS,
        exit: ["ctrl"],
      }),
    ).toThrow("needs a key");
  });
});
