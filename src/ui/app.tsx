import os from "node:os";

import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CommandAliasMetadata,
  CommandMetadata,
  RuntimeController,
  TranscriptEvent,
  TranscriptRole,
} from "../core/runtime-controller.js";
import { compileKeybindings, type KeybindingConfig } from "./keybindings.js";
import {
  consumeMouseWheelDirections,
  DISABLE_MOUSE_TRACKING_SEQUENCE,
  ENABLE_MOUSE_TRACKING_SEQUENCE,
  MOUSE_SEQUENCE_PREFIX,
} from "./mouse-wheel.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { buildHeroLogoLines, getHeroLogoWidth } from "./hero-logo.js";
import { buildWelcomePanelLines } from "./welcome-panel.js";

type TranscriptLine = {
  id: number;
  role: TranscriptRole;
  content: string;
};

type TimelineEntry =
  | {
      id: string;
      kind: "panel";
      text: string;
    }
  | {
      id: number;
      kind: "transcript";
      role: TranscriptRole;
      content: string;
    };

type TimelineRow =
  | {
      id: string;
      kind: "panel";
      text: string;
    }
  | {
      id: string;
      kind: "separator";
      text: string;
    }
  | {
      id: string;
      kind: "transcript";
      role: TranscriptRole;
      label: string;
      content: string;
      showLabel: boolean;
    };

const ROLE_COLOR: Record<TranscriptRole, string> = {
  system: "yellow",
  user: "green",
  assistant: "cyan",
  command: "white",
};

const MAX_FILTERED_COMMAND_SUGGESTIONS = 6;
const MIN_TERMINAL_WIDTH = 20;
const PANEL_TITLE = "CLIA-term";
const PROMPT_SEPARATOR = "─";
const MIN_TRANSCRIPT_ROWS_WITH_HERO = 6;
const NO_HISTORY_CURSOR = -1;
const GENERATION_TRACK_WIDTH = 14;
const GENERATION_FRAME_MS = 90;

type CommandSuggestion = {
  kind: "command" | "alias" | "argument";
  label: string;
  description: string;
  replacement: string;
};

type ArgumentCandidate = {
  value: string;
  description: string;
};

type ParsedSlashInput = {
  command: string;
  completedArgs: readonly string[];
  currentFragment: string;
};

function buildSlashReplacement(command: string, completedArgs: readonly string[], nextToken: string): string {
  const nextArgs = [...completedArgs, nextToken];
  return `/${command}${nextArgs.length > 0 ? ` ${nextArgs.join(" ")}` : ""} `;
}

function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith("/")) {
    return null;
  }

  const endsWithSpace = /\s$/.test(input);
  const tokens = input
    .slice(1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const [commandToken, ...argsTokens] = tokens;
  const completedArgs = endsWithSpace ? argsTokens : argsTokens.slice(0, -1);
  const currentFragment = endsWithSpace ? "" : (argsTokens.at(-1) ?? "");

  return {
    command: commandToken.toLowerCase(),
    completedArgs,
    currentFragment,
  };
}

function filterCandidatesByFragment(
  candidates: readonly ArgumentCandidate[],
  fragment: string,
): readonly ArgumentCandidate[] {
  const query = fragment.toLowerCase();
  return candidates.filter((candidate) => candidate.value.toLowerCase().startsWith(query));
}

function resolveArgumentCandidates(parsedInput: ParsedSlashInput): readonly ArgumentCandidate[] {
  const { command, completedArgs } = parsedInput;

  if (command === "history" && completedArgs.length === 0) {
    return [
      { value: "8", description: "Default history size" },
      { value: "20", description: "Show last 20 messages" },
    ];
  }

  return [];
}

function buildArgumentSuggestions(input: string): readonly CommandSuggestion[] {
  if (!input.startsWith("/") || !input.includes(" ")) {
    return [];
  }

  const parsedInput = parseSlashInput(input);
  if (!parsedInput) {
    return [];
  }

  const candidates = resolveArgumentCandidates(parsedInput);
  if (candidates.length === 0) {
    return [];
  }

  return filterCandidatesByFragment(candidates, parsedInput.currentFragment)
    .slice(0, MAX_FILTERED_COMMAND_SUGGESTIONS)
    .map((candidate) => ({
      kind: "argument",
      label: candidate.value,
      description: candidate.description,
      replacement: buildSlashReplacement(parsedInput.command, parsedInput.completedArgs, candidate.value),
    }));
}

function normalizeCompletionValue(value: string): string {
  return value.trimEnd();
}

function mapEvents(nextId: () => number, events: readonly TranscriptEvent[]): TranscriptLine[] {
  return events.map((event) => ({
    id: nextId(),
    role: event.role,
    content: event.content,
  }));
}

function updateLineContent(lines: readonly TranscriptLine[], id: number, content: string): TranscriptLine[] {
  return lines.map((line) => (line.id === id ? { ...line, content } : line));
}

function estimateWrappedRowCount(text: string, terminalWidth: number): number {
  const width = Math.max(MIN_TERMINAL_WIDTH, terminalWidth);
  const rawLines = text.split("\n");
  let rows = 0;

  for (const rawLine of rawLines) {
    const lineLength = rawLine.length;
    rows += Math.max(1, Math.ceil(lineLength / width));
  }

  return rows;
}

function estimateBlockRowCount(lines: readonly string[], terminalWidth: number): number {
  return lines.reduce((rows, line) => rows + estimateWrappedRowCount(line, terminalWidth), 0);
}

function roleLabel(role: TranscriptRole, userName: string, agentName: string): string {
  if (role === "user") {
    return userName;
  }

  if (role === "system" || role === "assistant") {
    return agentName;
  }

  return "shell";
}

function wrapRawLine(value: string, width: number): readonly string[] {
  const safeWidth = Math.max(1, width);
  const characters = Array.from(value);
  if (characters.length === 0) {
    return [""];
  }

  const rows: string[] = [];
  for (let index = 0; index < characters.length; index += safeWidth) {
    rows.push(characters.slice(index, index + safeWidth).join(""));
  }

  return rows;
}

function buildPanelRows(entry: Extract<TimelineEntry, { kind: "panel" }>, terminalWidth: number): readonly TimelineRow[] {
  return entry.text
    .split("\n")
    .flatMap((line, lineIndex) =>
      wrapRawLine(line, terminalWidth).map((wrappedLine, wrapIndex) => ({
        id: `${entry.id}-${String(lineIndex)}-${String(wrapIndex)}`,
        kind: "panel" as const,
        text: wrappedLine,
      })),
    );
}

function buildTranscriptRows(
  entry: Extract<TimelineEntry, { kind: "transcript" }>,
  terminalWidth: number,
  userName: string,
  agentName: string,
): readonly TimelineRow[] {
  if (entry.role === "command") {
    return entry.content.split("\n").flatMap((line, lineIndex) =>
      wrapRawLine(line, terminalWidth).map((wrappedLine, wrapIndex) => ({
        id: `${String(entry.id)}-${String(lineIndex)}-${String(wrapIndex)}`,
        kind: "transcript" as const,
        role: entry.role,
        label: "",
        content: wrappedLine,
        showLabel: false,
      })),
    );
  }

  const label = roleLabel(entry.role, userName, agentName);
  const labelPrefixWidth = `${label}> `.length;
  const continuationWidth = labelPrefixWidth;
  let firstRow = true;

  return entry.content.split("\n").flatMap((line, lineIndex) => {
    const availableWidth = Math.max(1, terminalWidth - (firstRow ? labelPrefixWidth : continuationWidth));
    const wrappedLines = wrapRawLine(line, availableWidth);

    return wrappedLines.map((wrappedLine, wrapIndex) => {
      const showLabel = firstRow;
      firstRow = false;
      return {
        id: `${String(entry.id)}-${String(lineIndex)}-${String(wrapIndex)}`,
        kind: "transcript" as const,
        role: entry.role,
        label,
        content: wrappedLine,
        showLabel,
      };
    });
  });
}

function buildTimelineRows(
  timeline: readonly TimelineEntry[],
  terminalWidth: number,
  userName: string,
  agentName: string,
): readonly TimelineRow[] {
  const rows: TimelineRow[] = [];
  let transcriptCount = 0;

  for (const entry of timeline) {
    if (entry.kind === "panel") {
      rows.push(...buildPanelRows(entry, terminalWidth));
      continue;
    }

    if (transcriptCount > 0) {
      rows.push({
        id: `separator-${String(entry.id)}`,
        kind: "separator",
        text: PROMPT_SEPARATOR.repeat(terminalWidth),
      });
    }

    rows.push(...buildTranscriptRows(entry, terminalWidth, userName, agentName));
    transcriptCount += 1;
  }

  return rows;
}

function sliceTimelineRowsToVisible(
  rows: readonly TimelineRow[],
  rowBudget: number,
  scrollOffsetRows: number,
): readonly TimelineRow[] {
  if (rowBudget <= 0 || rows.length === 0) {
    return [];
  }

  const clampedOffset = Math.min(Math.max(0, scrollOffsetRows), Math.max(0, rows.length - rowBudget));
  const endIndex = Math.max(0, rows.length - clampedOffset);
  const startIndex = Math.max(0, endIndex - rowBudget);
  return rows.slice(startIndex, endIndex);
}

function extractCommandQuery(input: string): string | null {
  if (!input.startsWith("/") || input.includes(" ")) {
    return null;
  }
  return input.slice(1).toLowerCase();
}

function extractAliasQuery(input: string): string | null {
  if (input.startsWith("/") || input.includes(" ")) {
    return null;
  }

  const query = input.trim().toLowerCase();
  if (!query) {
    return null;
  }
  return query;
}

function buildCommandSuggestions(commands: readonly CommandMetadata[], input: string): readonly CommandSuggestion[] {
  const query = extractCommandQuery(input);
  if (query === null) {
    return [];
  }

  const suggestionLimit = query.length === 0 ? Number.POSITIVE_INFINITY : MAX_FILTERED_COMMAND_SUGGESTIONS;

  return commands
    .filter((command) => command.name.startsWith(query))
    .map((command) => ({
      kind: "command" as const,
      label: `/${command.name}`,
      description: command.description,
      replacement: `/${command.name} `,
    }))
    .slice(0, suggestionLimit);
}

function buildAliasSuggestions(
  commands: readonly CommandMetadata[],
  aliases: readonly CommandAliasMetadata[],
  input: string,
): readonly CommandSuggestion[] {
  const query = extractAliasQuery(input);
  if (query === null) {
    return [];
  }

  const commandDescriptions = new Map(commands.map((command) => [command.name, command.description]));

  return aliases
    .filter((alias) => alias.alias.startsWith(query))
    .map((alias) => {
      const targetDescription = commandDescriptions.get(alias.target);
      return {
        kind: "alias" as const,
        label: alias.alias,
        description: targetDescription
          ? `Alias for /${alias.target} - ${targetDescription}`
          : `Alias for /${alias.target}`,
        replacement: `${alias.alias} `,
      };
    })
    .slice(0, MAX_FILTERED_COMMAND_SUGGESTIONS);
}

function appendInputHistory(history: readonly string[], value: string): string[] {
  const entry = value.trim();
  if (!entry) {
    return [...history];
  }

  if (history.at(-1) === entry) {
    return [...history];
  }

  return [...history, entry];
}

function moveHistoryCursor(
  historyLength: number,
  currentCursor: number,
  direction: "next" | "previous",
): number {
  if (historyLength === 0) {
    return NO_HISTORY_CURSOR;
  }

  if (direction === "previous") {
    if (currentCursor === NO_HISTORY_CURSOR) {
      return historyLength - 1;
    }

    return Math.max(0, currentCursor - 1);
  }

  if (currentCursor === NO_HISTORY_CURSOR) {
    return NO_HISTORY_CURSOR;
  }

  if (currentCursor >= historyLength - 1) {
    return NO_HISTORY_CURSOR;
  }

  return currentCursor + 1;
}

function buildGenerationIndicator(frame: number, agentName: string): string {
  const cycleLength = Math.max(1, GENERATION_TRACK_WIDTH * 2 - 2);
  const cyclePosition = frame % cycleLength;
  const squarePosition =
    cyclePosition < GENERATION_TRACK_WIDTH ? cyclePosition : cycleLength - cyclePosition;
  const track = Array.from({ length: GENERATION_TRACK_WIDTH }, (_, index) =>
    index === squarePosition ? "■" : "·",
  ).join("");

  return `${agentName} [${track}]`;
}

export function App({
  runtime,
  keybindings,
  configPath,
}: {
  runtime: RuntimeController;
  keybindings: KeybindingConfig;
  configPath?: string;
}): React.JSX.Element {
  const { exit } = useApp();
  const { stdin, internal_eventEmitter } = useStdin();
  const { stdout } = useStdout();
  const { width: terminalWidth, height: terminalHeight } = useTerminalSize(stdout);
  const homeDirectory = process.env.HOME;
  const runtimeDirectory = runtime.getCurrentWorkingDirectory();
  const currentDirectory =
    homeDirectory && runtimeDirectory.startsWith(homeDirectory)
      ? `~${runtimeDirectory.slice(homeDirectory.length)}`
      : runtimeDirectory;
  const userName = process.env.USER ?? process.env.USERNAME ?? "there";
  const hostName = os.hostname();
  const agentName = runtime.getAssistantName();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [generationFrame, setGenerationFrame] = useState(0);
  const [mouseCaptureEnabled, setMouseCaptureEnabled] = useState(false);
  const [scrollOffsetRows, setScrollOffsetRows] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [inputHistoryCursor, setInputHistoryCursor] = useState(NO_HISTORY_CURSOR);
  const [lines, setLines] = useState<TranscriptLine[]>([
    {
      id: 0,
      role: "system",
      content: "Type /help for CLIA-term commands. Shell commands execute directly.",
    },
  ]);

  const idCounter = useRef(1);
  const nextId = useCallback(() => {
    const id = idCounter.current;
    idCounter.current += 1;
    return id;
  }, []);

  const shellSummary = runtime.getShellSummary();
  const assistantSummary = runtime.getAssistantSummary();
  const commandCatalog = useMemo(() => runtime.listCommands(), [runtime]);
  const aliasCatalog = useMemo(() => runtime.listCommandAliases(), [runtime]);
  const compiledKeybindings = useMemo(() => compileKeybindings(keybindings), [keybindings]);
  const commandQuery = extractCommandQuery(input);
  const aliasQuery = extractAliasQuery(input);
  const suggestionState = useMemo(() => {
    if (commandQuery !== null) {
      return {
        mode: "commands" as const,
        suggestions: buildCommandSuggestions(commandCatalog, input),
      };
    }

    if (input.startsWith("/")) {
      const argumentSuggestions = buildArgumentSuggestions(input);
      if (argumentSuggestions.length > 0) {
        return {
          mode: "arguments" as const,
          suggestions: argumentSuggestions,
        };
      }
    }

    if (aliasQuery !== null) {
      return {
        mode: "aliases" as const,
        suggestions: buildAliasSuggestions(commandCatalog, aliasCatalog, input),
      };
    }

    return {
      mode: "none" as const,
      suggestions: [] as readonly CommandSuggestion[],
    };
  }, [aliasCatalog, aliasQuery, commandCatalog, commandQuery, input]);
  const suggestions = suggestionState.suggestions;
  const hasSuggestions = suggestions.length > 0;
  const selectedSuggestion = hasSuggestions ? suggestions[selectedSuggestionIndex] : undefined;
  const isSlashCompletionMode = suggestionState.mode === "commands" || suggestionState.mode === "arguments";
  const isAliasCompletionMode = suggestionState.mode === "aliases";
  const suggestionGroupLabel =
    suggestionState.mode === "aliases" ? "aliases" : suggestionState.mode === "arguments" ? "arguments" : "commands";
  const hasSuggestionsRef = useRef(hasSuggestions);
  const computedWidth = Math.max(MIN_TERMINAL_WIDTH, terminalWidth);
  const promptPrefix = `${userName}@${hostName}:${currentDirectory} % `;
  const promptLine = `${promptPrefix}${input}`;
  const generationIndicator = buildGenerationIndicator(generationFrame, agentName);
  const separatorLine = PROMPT_SEPARATOR.repeat(computedWidth);

  const suggestionsRows = hasSuggestions
    ? 1 +
      suggestions.reduce((rows, command) => {
        const suggestionLabel = command.label.padEnd(18, " ");
        return rows + estimateWrappedRowCount(`${suggestionLabel} ${command.description}`, computedWidth);
      }, 0)
    : 0;

  const recentActivityLines = useMemo(() => {
    const activity = lines
      .filter((line) => line.id !== 0)
      .slice(-3)
      .map((line) => `${roleLabel(line.role, userName, agentName)}> ${line.content}`);

    if (activity.length === 0) {
      return ["No recent activity"];
    }

    return activity;
  }, [agentName, lines, userName]);

  const welcomePanelWithCompactLogo = useMemo(
    () =>
      buildWelcomePanelLines({
        terminalWidth: computedWidth,
        title: PANEL_TITLE,
        userName,
        shellSummary,
        assistantSummary,
        cwd: currentDirectory,
        recentActivity: recentActivityLines,
        showCompactLogo: true,
      }),
    [assistantSummary, computedWidth, currentDirectory, recentActivityLines, shellSummary, userName],
  );

  const welcomePanelWithoutCompactLogo = useMemo(
    () =>
      buildWelcomePanelLines({
        terminalWidth: computedWidth,
        title: PANEL_TITLE,
        userName,
        shellSummary,
        assistantSummary,
        cwd: currentDirectory,
        recentActivity: recentActivityLines,
        showCompactLogo: false,
      }),
    [assistantSummary, computedWidth, currentDirectory, recentActivityLines, shellSummary, userName],
  );

  const bottomRows =
    estimateWrappedRowCount(promptLine, computedWidth) +
    estimateWrappedRowCount(separatorLine, computedWidth) * 2 +
    (busy ? estimateWrappedRowCount(generationIndicator, computedWidth) : 0) +
    suggestionsRows +
    (configPath ? estimateWrappedRowCount(`config> loaded from ${configPath}`, computedWidth) : 0);

  const heroLogoCandidate = useMemo(() => buildHeroLogoLines(computedWidth), [computedWidth]);
  const heroLogoByWidthAvailable = computedWidth >= getHeroLogoWidth() && heroLogoCandidate.length > 0;
  const headerRowsWithHero =
    estimateBlockRowCount(heroLogoCandidate, computedWidth) + estimateBlockRowCount(welcomePanelWithoutCompactLogo, computedWidth);
  const transcriptRowsWithHero = terminalHeight - bottomRows - headerRowsWithHero;
  const showHeroLogo = heroLogoByWidthAvailable && transcriptRowsWithHero >= MIN_TRANSCRIPT_ROWS_WITH_HERO;
  const heroLogoLines = showHeroLogo ? heroLogoCandidate : [];
  const welcomePanelLines = showHeroLogo ? welcomePanelWithoutCompactLogo : welcomePanelWithCompactLogo;
  const timelineEntries = useMemo(
    () => [
      ...heroLogoLines.map((text, index) => ({ id: `hero-logo-${index}`, kind: "panel" as const, text })),
      ...welcomePanelLines.map((text, index) => ({ id: `welcome-panel-${index}`, kind: "panel" as const, text })),
      ...lines.map(
        (line) =>
          ({
            id: line.id,
            kind: "transcript" as const,
            role: line.role,
            content: line.content,
          }) satisfies TimelineEntry,
      ),
    ],
    [heroLogoLines, lines, welcomePanelLines],
  );
  const timelineRows = useMemo(
    () => buildTimelineRows(timelineEntries, computedWidth, userName, agentName),
    [agentName, computedWidth, timelineEntries, userName],
  );
  const timelineTotalRows = timelineRows.length;
  const timelineRowBudget = Math.max(0, terminalHeight - bottomRows);
  const maxScrollOffsetRows = Math.max(0, timelineTotalRows - timelineRowBudget);
  const scrollPageRows = Math.max(1, Math.floor(timelineRowBudget * 0.8));
  const maxScrollOffsetRowsRef = useRef(maxScrollOffsetRows);
  const mouseRemainderRef = useRef("");
  const suppressedInputEventsRef = useRef(0);

  useEffect(() => {
    hasSuggestionsRef.current = hasSuggestions;
  }, [hasSuggestions]);

  useEffect(() => {
    if (!busy) {
      setGenerationFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setGenerationFrame((frame) => frame + 1);
    }, GENERATION_FRAME_MS);

    return () => {
      clearInterval(timer);
    };
  }, [busy]);

  useEffect(() => {
    maxScrollOffsetRowsRef.current = maxScrollOffsetRows;
  }, [maxScrollOffsetRows]);

  useEffect(() => {
    setScrollOffsetRows((current) => Math.min(current, maxScrollOffsetRows));
  }, [maxScrollOffsetRows]);

  const previousTimelineRowsRef = useRef(timelineTotalRows);
  useEffect(() => {
    const previousRows = previousTimelineRowsRef.current;
    const delta = timelineTotalRows - previousRows;
    if (delta > 0) {
      setScrollOffsetRows((current) => {
        if (current === 0) {
          return 0;
        }
        return Math.min(current + delta, maxScrollOffsetRows);
      });
    }
    previousTimelineRowsRef.current = timelineTotalRows;
  }, [maxScrollOffsetRows, timelineTotalRows]);

  useEffect(() => {
    if (!stdin.isTTY || !stdout.isTTY) {
      return;
    }

    if (!mouseCaptureEnabled) {
      stdout.write(DISABLE_MOUSE_TRACKING_SEQUENCE);
      mouseRemainderRef.current = "";
      suppressedInputEventsRef.current = 0;
      return;
    }

    stdout.write(ENABLE_MOUSE_TRACKING_SEQUENCE);

    const handleStdinData = (chunk: string | Buffer): void => {
      const previousRemainder = mouseRemainderRef.current;
      const payload = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const parsed = consumeMouseWheelDirections(mouseRemainderRef.current, payload);
      mouseRemainderRef.current = parsed.remainder;

      const isMouseChunk =
        payload.includes(MOUSE_SEQUENCE_PREFIX) ||
        previousRemainder.startsWith(MOUSE_SEQUENCE_PREFIX) ||
        (previousRemainder === "\u001b" && payload.startsWith("[")) ||
        (previousRemainder === "\u001b[" && payload.startsWith("<")) ||
        parsed.directions.length > 0;

      if (isMouseChunk) {
        suppressedInputEventsRef.current += 1;
      }

      if (parsed.directions.length === 0 || hasSuggestionsRef.current) {
        return;
      }

      setScrollOffsetRows((current) => {
        let next = current;
        for (const direction of parsed.directions) {
          if (direction === "up") {
            next = Math.min(maxScrollOffsetRowsRef.current, next + 1);
            continue;
          }
          next = Math.max(0, next - 1);
        }
        return next;
      });
    };

    internal_eventEmitter.on("input", handleStdinData);

    return () => {
      internal_eventEmitter.removeListener("input", handleStdinData);
      stdout.write(DISABLE_MOUSE_TRACKING_SEQUENCE);
      mouseRemainderRef.current = "";
    };
  }, [internal_eventEmitter, mouseCaptureEnabled, stdin, stdout]);

  const visibleTimelineRows = useMemo(
    () => sliceTimelineRowsToVisible(timelineRows, timelineRowBudget, scrollOffsetRows),
    [scrollOffsetRows, timelineRows, timelineRowBudget],
  );

  useEffect(() => {
    if (suggestions.length === 0) {
      setSelectedSuggestionIndex(0);
      return;
    }

    setSelectedSuggestionIndex((current) => {
      if (current < suggestions.length) {
        return current;
      }
      return suggestions.length - 1;
    });
  }, [suggestions]);

  const applySuggestion = useCallback((command: CommandSuggestion) => {
    setInput(command.replacement);
    setInputHistoryCursor(NO_HISTORY_CURSOR);
  }, []);

  const navigateInputHistory = useCallback(
    (direction: "next" | "previous") => {
      const nextCursor = moveHistoryCursor(inputHistory.length, inputHistoryCursor, direction);
      setInputHistoryCursor(nextCursor);
      setInput(nextCursor === NO_HISTORY_CURSOR ? "" : (inputHistory[nextCursor] ?? ""));
    },
    [inputHistory, inputHistoryCursor],
  );

  const appendEvents = useCallback(
    (events: readonly TranscriptEvent[]) => {
      if (events.length === 0) {
        return;
      }
      setLines((current) => [...current, ...mapEvents(nextId, events)]);
    },
    [nextId],
  );

  const submit = useCallback(
    async (rawLine: string) => {
      const trimmedLine = rawLine.trim();
      if (!trimmedLine || busy) {
        return;
      }

      setScrollOffsetRows(0);
      setInputHistory((history) => appendInputHistory(history, trimmedLine));
      setInputHistoryCursor(NO_HISTORY_CURSOR);

      const result = runtime.submitLine(trimmedLine, { terminalWidth: computedWidth });
      if (result.clearTranscript) {
        setLines([]);
        setScrollOffsetRows(0);
      }

      appendEvents(result.events);

      if (result.shouldExit) {
        exit();
        return;
      }

      if (!result.stream) {
        return;
      }

      setBusy(true);
      const assistantLineId = nextId();
      setLines((current) => [
        ...current,
        { id: assistantLineId, role: result.streamRole ?? "assistant", content: "" },
      ]);

      let fullResponse = "";
      for await (const chunk of result.stream) {
        fullResponse += chunk;
        setLines((current) => updateLineContent(current, assistantLineId, fullResponse));
      }

      result.commitAssistant?.(fullResponse.trim());
      setBusy(false);
    },
    [appendEvents, busy, computedWidth, exit, nextId, runtime],
  );

  useInput((inputChar, key) => {
    if (compiledKeybindings.matches("exit", inputChar, key)) {
      exit();
      return;
    }

    if (compiledKeybindings.matches("toggleMouseCapture", inputChar, key)) {
      const nextEnabled = !mouseCaptureEnabled;
      setMouseCaptureEnabled(nextEnabled);
      setLines((current) => [
        ...current,
        {
          id: nextId(),
          role: "system",
          content: nextEnabled
            ? "Mouse capture enabled: wheel scroll active, text selection disabled."
            : "Mouse capture disabled: text selection/copy enabled, wheel scroll disabled.",
        },
      ]);
      return;
    }

    if (suppressedInputEventsRef.current > 0) {
      suppressedInputEventsRef.current -= 1;
      return;
    }

    if (busy) {
      return;
    }

    if (inputHistoryCursor !== NO_HISTORY_CURSOR && compiledKeybindings.matches("historyPrev", inputChar, key)) {
      navigateInputHistory("previous");
      return;
    }

    if (inputHistoryCursor !== NO_HISTORY_CURSOR && compiledKeybindings.matches("historyNext", inputChar, key)) {
      navigateInputHistory("next");
      return;
    }

    if (
      !hasSuggestions &&
      input.trim().length === 0 &&
      compiledKeybindings.matches("historyPrev", inputChar, key)
    ) {
      navigateInputHistory("previous");
      return;
    }

    if (hasSuggestions && compiledKeybindings.matches("suggestionNext", inputChar, key)) {
      setSelectedSuggestionIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (hasSuggestions && compiledKeybindings.matches("suggestionPrev", inputChar, key)) {
      setSelectedSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (hasSuggestions && compiledKeybindings.matches("applySuggestion", inputChar, key)) {
      applySuggestion(suggestions[selectedSuggestionIndex]);
      return;
    }

    if (!hasSuggestions && compiledKeybindings.matches("scrollUp", inputChar, key)) {
      setScrollOffsetRows((current) => Math.min(maxScrollOffsetRows, current + 1));
      return;
    }

    if (!hasSuggestions && compiledKeybindings.matches("scrollDown", inputChar, key)) {
      setScrollOffsetRows((current) => Math.max(0, current - 1));
      return;
    }

    if (!hasSuggestions && compiledKeybindings.matches("scrollPageUp", inputChar, key)) {
      setScrollOffsetRows((current) => Math.min(maxScrollOffsetRows, current + scrollPageRows));
      return;
    }

    if (!hasSuggestions && compiledKeybindings.matches("scrollPageDown", inputChar, key)) {
      setScrollOffsetRows((current) => Math.max(0, current - scrollPageRows));
      return;
    }

    if (compiledKeybindings.matches("scrollToBottom", inputChar, key)) {
      setScrollOffsetRows(0);
      return;
    }

    if (hasSuggestions && (isSlashCompletionMode || isAliasCompletionMode) && compiledKeybindings.matches("submit", inputChar, key)) {
      if (!selectedSuggestion || normalizeCompletionValue(selectedSuggestion.replacement) !== normalizeCompletionValue(input)) {
        applySuggestion(suggestions[selectedSuggestionIndex]);
        return;
      }
    }

    if (compiledKeybindings.matches("submit", inputChar, key)) {
      const currentInput = input;
      setInput("");
      void submit(currentInput);
      return;
    }

    if (compiledKeybindings.matches("deleteChar", inputChar, key)) {
      setInputHistoryCursor(NO_HISTORY_CURSOR);
      setInput((value) => value.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && inputChar) {
      setInputHistoryCursor(NO_HISTORY_CURSOR);
      setInput((value) => value + inputChar);
    }
  });

  return (
    <Box flexDirection="column" height={Math.max(terminalHeight, 1)}>
      <Box flexDirection="column" flexGrow={1}>
        {visibleTimelineRows.map((row) =>
          row.kind === "panel" ? (
            <Text key={row.id} color="gray">
              {row.text}
            </Text>
          ) : row.kind === "separator" ? (
            <Text key={row.id} dimColor>
              {row.text}
            </Text>
          ) : (
            <Text key={row.id} color={ROLE_COLOR[row.role]} bold={row.role === "assistant"}>
              {row.role === "command" ? "" : row.showLabel ? `${row.label}> ` : " ".repeat(row.label.length + 2)}
              <Text color="white" bold={row.role === "assistant"}>
                {row.content}
              </Text>
            </Text>
          ),
        )}
      </Box>

      {busy ? (
        <Text color="cyan">{generationIndicator}</Text>
      ) : null}

      {hasSuggestions ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {suggestionGroupLabel} (
            {compiledKeybindings.config.applySuggestion.join(" or ")} to complete,{" "}
            {compiledKeybindings.config.suggestionPrev.join(" or ")}/
            {compiledKeybindings.config.suggestionNext.join(" or ")} to navigate)
          </Text>
          {suggestions.map((command, index) => {
            const selected = index === selectedSuggestionIndex;
            return (
              <Text
                key={`${command.kind}-${command.label}-${index}`}
                color={selected ? "cyan" : "gray"}
                bold={selected}
              >
                {selected ? ">" : " "} {command.label.padEnd(18)}{" "}
                <Text color={selected ? "white" : "gray"}>{command.description}</Text>
              </Text>
            );
          })}
        </Box>
      ) : null}

      {configPath ? (
        <Text dimColor>config&gt; loaded from {configPath}</Text>
      ) : null}

      <Text dimColor>{separatorLine}</Text>
      <Text>
        <Text color="green">{promptPrefix}</Text>
        <Text color="white">{input}</Text>
      </Text>
      <Text dimColor>{separatorLine}</Text>
    </Box>
  );
}
