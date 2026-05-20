export type KeybindingAction =
  | "exit"
  | "toggleMouseCapture"
  | "suggestionNext"
  | "suggestionPrev"
  | "historyNext"
  | "historyPrev"
  | "applySuggestion"
  | "submit"
  | "deleteChar"
  | "scrollUp"
  | "scrollDown"
  | "scrollPageUp"
  | "scrollPageDown"
  | "scrollToBottom";

export const KEYBINDING_ACTIONS: readonly KeybindingAction[] = [
  "exit",
  "toggleMouseCapture",
  "suggestionNext",
  "suggestionPrev",
  "historyNext",
  "historyPrev",
  "applySuggestion",
  "submit",
  "deleteChar",
  "scrollUp",
  "scrollDown",
  "scrollPageUp",
  "scrollPageDown",
  "scrollToBottom",
] as const;

export type KeybindingOverrides = Partial<Record<KeybindingAction, string | readonly string[]>>;
export type KeybindingAliasMap = Readonly<Record<string, KeybindingAction>>;

export type KeybindingConfig = Readonly<Record<KeybindingAction, readonly string[]>>;

type SpecialKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "enter"
  | "tab"
  | "backspace"
  | "delete"
  | "escape"
  | "space";

type ParsedBinding = {
  readonly raw: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly special?: SpecialKey;
  readonly char?: string;
};

type KeyEventLike = {
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly home?: boolean;
  readonly end?: boolean;
  readonly return?: boolean;
  readonly tab?: boolean;
  readonly backspace?: boolean;
  readonly delete?: boolean;
  readonly escape?: boolean;
};

const SPECIAL_ALIASES: Readonly<Record<string, SpecialKey>> = {
  up: "up",
  arrowup: "up",
  down: "down",
  arrowdown: "down",
  left: "left",
  arrowleft: "left",
  right: "right",
  arrowright: "right",
  pageup: "pageup",
  pagedown: "pagedown",
  home: "home",
  end: "end",
  enter: "enter",
  return: "enter",
  tab: "tab",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  escape: "escape",
  esc: "escape",
  space: "space",
};

export const DEFAULT_KEYBINDINGS: KeybindingConfig = {
  exit: ["ctrl+c"],
  toggleMouseCapture: ["ctrl+g"],
  suggestionNext: ["down"],
  suggestionPrev: ["up"],
  historyNext: ["down"],
  historyPrev: ["up"],
  applySuggestion: ["tab", "right"],
  submit: ["enter"],
  deleteChar: ["backspace", "delete"],
  scrollUp: ["up", "ctrl+u"],
  scrollDown: ["down", "ctrl+d"],
  scrollPageUp: ["pageup"],
  scrollPageDown: ["pagedown"],
  scrollToBottom: ["end"],
};

export type CompiledKeybindings = {
  readonly config: KeybindingConfig;
  matches(action: KeybindingAction, input: string, key: KeyEventLike): boolean;
};

function isModifierToken(token: string): boolean {
  return ["ctrl", "crtl", "control", "meta", "cmd", "command", "alt", "option", "shift"].includes(token);
}

function normalizeModifierToken(token: string): "ctrl" | "control" | "meta" | "cmd" | "command" | "alt" | "option" | "shift" {
  if (token === "crtl") {
    return "ctrl";
  }
  return token as "ctrl" | "control" | "meta" | "cmd" | "command" | "alt" | "option" | "shift";
}

function normalizeBindingList(value: string | readonly string[] | undefined, fallback: readonly string[]): readonly string[] {
  if (value === undefined) {
    return [...fallback];
  }

  if (typeof value === "string") {
    return [value];
  }

  return [...value];
}

function parseBinding(binding: string): ParsedBinding {
  const raw = binding;
  const tokens = binding
    .toLowerCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error(`Invalid empty keybinding: \"${raw}\"`);
  }

  let ctrl = false;
  let meta = false;
  let shift = false;
  let special: SpecialKey | undefined;
  let char: string | undefined;

  for (const token of tokens) {
    if (isModifierToken(token)) {
      const normalizedModifier = normalizeModifierToken(token);
      if (normalizedModifier === "ctrl" || normalizedModifier === "control") {
        ctrl = true;
        continue;
      }
      if (
        normalizedModifier === "meta" ||
        normalizedModifier === "cmd" ||
        normalizedModifier === "command" ||
        normalizedModifier === "alt" ||
        normalizedModifier === "option"
      ) {
        meta = true;
        continue;
      }
      if (normalizedModifier === "shift") {
        shift = true;
        continue;
      }
    }

    if (SPECIAL_ALIASES[token]) {
      if (special || char) {
        throw new Error(`Keybinding \"${raw}\" has multiple non-modifier keys`);
      }
      special = SPECIAL_ALIASES[token];
      continue;
    }

    if (token.length === 1) {
      if (special || char) {
        throw new Error(`Keybinding \"${raw}\" has multiple non-modifier keys`);
      }
      char = token;
      continue;
    }

    throw new Error(`Unknown key token \"${token}\" in keybinding \"${raw}\"`);
  }

  if (!special && !char) {
    throw new Error(`Keybinding \"${raw}\" needs a key (example: enter, tab, ctrl+c)`);
  }

  return {
    raw,
    ctrl,
    meta,
    shift,
    special,
    char,
  };
}

function matchesSpecial(special: SpecialKey, input: string, key: KeyEventLike): boolean {
  if (special === "up") {
    return Boolean(key.upArrow);
  }
  if (special === "down") {
    return Boolean(key.downArrow);
  }
  if (special === "left") {
    return Boolean(key.leftArrow);
  }
  if (special === "right") {
    return Boolean(key.rightArrow);
  }
  if (special === "enter") {
    return Boolean(key.return);
  }
  if (special === "pageup") {
    return Boolean(key.pageUp);
  }
  if (special === "pagedown") {
    return Boolean(key.pageDown);
  }
  if (special === "home") {
    return Boolean(key.home);
  }
  if (special === "end") {
    return Boolean(key.end);
  }
  if (special === "tab") {
    return Boolean(key.tab) || input === "\t";
  }
  if (special === "backspace") {
    return Boolean(key.backspace);
  }
  if (special === "delete") {
    return Boolean(key.delete);
  }
  if (special === "escape") {
    return Boolean(key.escape);
  }
  if (special === "space") {
    return input === " ";
  }

  return false;
}

function matchesBinding(binding: ParsedBinding, input: string, key: KeyEventLike): boolean {
  if (binding.ctrl && !key.ctrl) {
    return false;
  }

  if (binding.meta && !key.meta) {
    return false;
  }

  if (binding.shift && !key.shift) {
    return false;
  }

  if (binding.special) {
    return matchesSpecial(binding.special, input, key);
  }

  if (binding.char !== undefined) {
    return input.toLowerCase() === binding.char;
  }

  return false;
}

export function resolveKeybindings(
  overrides?: KeybindingOverrides,
  aliases?: KeybindingAliasMap,
): KeybindingConfig {
  const next: Record<KeybindingAction, readonly string[]> = {
    exit: normalizeBindingList(overrides?.exit, DEFAULT_KEYBINDINGS.exit),
    toggleMouseCapture: normalizeBindingList(overrides?.toggleMouseCapture, DEFAULT_KEYBINDINGS.toggleMouseCapture),
    suggestionNext: normalizeBindingList(overrides?.suggestionNext, DEFAULT_KEYBINDINGS.suggestionNext),
    suggestionPrev: normalizeBindingList(overrides?.suggestionPrev, DEFAULT_KEYBINDINGS.suggestionPrev),
    historyNext: normalizeBindingList(overrides?.historyNext, DEFAULT_KEYBINDINGS.historyNext),
    historyPrev: normalizeBindingList(overrides?.historyPrev, DEFAULT_KEYBINDINGS.historyPrev),
    applySuggestion: normalizeBindingList(overrides?.applySuggestion, DEFAULT_KEYBINDINGS.applySuggestion),
    submit: normalizeBindingList(overrides?.submit, DEFAULT_KEYBINDINGS.submit),
    deleteChar: normalizeBindingList(overrides?.deleteChar, DEFAULT_KEYBINDINGS.deleteChar),
    scrollUp: normalizeBindingList(overrides?.scrollUp, DEFAULT_KEYBINDINGS.scrollUp),
    scrollDown: normalizeBindingList(overrides?.scrollDown, DEFAULT_KEYBINDINGS.scrollDown),
    scrollPageUp: normalizeBindingList(overrides?.scrollPageUp, DEFAULT_KEYBINDINGS.scrollPageUp),
    scrollPageDown: normalizeBindingList(overrides?.scrollPageDown, DEFAULT_KEYBINDINGS.scrollPageDown),
    scrollToBottom: normalizeBindingList(overrides?.scrollToBottom, DEFAULT_KEYBINDINGS.scrollToBottom),
  };

  for (const [binding, action] of Object.entries(aliases ?? {})) {
    if (!next[action].includes(binding)) {
      next[action] = [...next[action], binding];
    }
  }

  return next;
}

export function compileKeybindings(config: KeybindingConfig): CompiledKeybindings {
  const parsedConfig: Record<KeybindingAction, readonly ParsedBinding[]> = {
    exit: config.exit.map(parseBinding),
    toggleMouseCapture: config.toggleMouseCapture.map(parseBinding),
    suggestionNext: config.suggestionNext.map(parseBinding),
    suggestionPrev: config.suggestionPrev.map(parseBinding),
    historyNext: config.historyNext.map(parseBinding),
    historyPrev: config.historyPrev.map(parseBinding),
    applySuggestion: config.applySuggestion.map(parseBinding),
    submit: config.submit.map(parseBinding),
    deleteChar: config.deleteChar.map(parseBinding),
    scrollUp: config.scrollUp.map(parseBinding),
    scrollDown: config.scrollDown.map(parseBinding),
    scrollPageUp: config.scrollPageUp.map(parseBinding),
    scrollPageDown: config.scrollPageDown.map(parseBinding),
    scrollToBottom: config.scrollToBottom.map(parseBinding),
  };

  return {
    config,
    matches(action: KeybindingAction, input: string, key: KeyEventLike): boolean {
      return parsedConfig[action].some((binding) => matchesBinding(binding, input, key));
    },
  };
}
