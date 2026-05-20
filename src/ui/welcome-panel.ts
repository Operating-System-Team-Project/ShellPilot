const MIN_COMPLEX_PANEL_WIDTH = 96;
const LEFT_COLUMN_RATIO = 0.78;
const MIN_LEFT_COLUMN_WIDTH = 40;
const MIN_RIGHT_COLUMN_WIDTH = 30;

const RAW_COMPACT_LOGO = `
««««««««««««««««««««««««««««««««««««««««««««««««««
««««««««««««««««««««««««««««««««««««««««««««««««««
«««««««««««««««««↲←↔↲»««««««««««««««««««««««««««««
«««««««««««««««»»»\        /↔«««««««««««««««««««««
««««««««««««««««««»-          ⇩↲»«««««««««««««««««
««««««««««««««««»/             .↔»««««««««««««««««
««««««««««««««««|                ↑««««««««««««««««
«««««««««««««««↕.                .↲«««««««««««««««
««««««««««««««⇦                    ↓»«««««««««««««
«««««««««««»↕~                      »«««««««««««««
««««««««««↲.                        »«««««««««««««
««««««««««»<          ~↕>           ↲«««««««««««««
««««««««««»↕<  >↑↔↕↱↲»«\            ↕«««««««««««««
«««««««««««««»»»««««««⇩             ↑«««««««««««««
««««««««««««««««««««»|              /«««««««««««««
««««««««««««««««««»←                :»««««««««««««
«««««««««««««««««↲:                 ,»««««««««««««
«««««««««««««««««↑                  .↕««««««««««««
««««««««««««««««»~               .»»»»««««««««««««
«««««««««««««««««↔                ↕«««««««««««««««
«««««««««««««««»⇧|||||||||||||||||||»»««««««««««««
«««««««««««««««⇧....................>»««««««««««««
««««««««««««««/                      ~««««««««««««
«««««««««««««↱                        ↓«««««««««««
««««««««««««»~                        ^»««««««««««
««««««««««««↱\\\\\\\\\\\\\\\\\\\\\\\\\\↲««««««««««
««««««««««««««««««««««««««««««««««««««««««««««««««
««««««««««««««««««««««««««««««««««««««««««««««««««
`;

function normalizeAsciiArt(raw: string): readonly string[] {
  const lines = raw.split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }

  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  const minIndent = lines
    .filter((line) => line.trim() !== "")
    .reduce((min, line) => {
      const indent = line.search(/\S|$/);
      return Math.min(min, indent);
    }, Number.POSITIVE_INFINITY);

  return lines.map((line) => line.slice(minIndent).replace(/\s+$/g, ""));
}

function renderAsBlockLogo(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.replace(/[^\s]/g, "█"));
}

const LOGO_LINES = renderAsBlockLogo(normalizeAsciiArt(RAW_COMPACT_LOGO));
const COMPACT_LOGO_WIDTH = LOGO_LINES.reduce((max, line) => Math.max(max, line.length), 0);

export type WelcomePanelOptions = {
  readonly terminalWidth: number;
  readonly title: string;
  readonly userName: string;
  readonly shellSummary: string;
  readonly assistantSummary: string;
  readonly cwd: string;
  readonly recentActivity: readonly string[];
  readonly showCompactLogo?: boolean;
};

function trimToWidth(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value.padEnd(width, " ");
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function centerToWidth(value: string, width: number): string {
  const trimmed = value.trim();
  if (trimmed.length >= width) {
    return trimToWidth(trimmed, width);
  }

  const leftPadding = Math.floor((width - trimmed.length) / 2);
  const rightPadding = width - trimmed.length - leftPadding;
  return `${" ".repeat(leftPadding)}${trimmed}${" ".repeat(rightPadding)}`;
}

function createTopBorder(title: string, innerWidth: number): string {
  const baseTitle = ` ${title.trim()} `;
  const cappedTitle = baseTitle.length > innerWidth ? trimToWidth(baseTitle, innerWidth) : baseTitle;
  return `╭${cappedTitle}${"─".repeat(Math.max(0, innerWidth - cappedTitle.length))}╮`;
}

export function buildWelcomePanelLines(options: WelcomePanelOptions): readonly string[] {
  const width = Math.max(20, options.terminalWidth);
  if (width < MIN_COMPLEX_PANEL_WIDTH) {
    return [`CLIA-term: ${options.shellSummary}`];
  }

  const innerWidth = width - 2;
  const contentWidth = innerWidth - 5;
  const logoRequested = options.showCompactLogo ?? true;

  let leftWidth = Math.max(MIN_LEFT_COLUMN_WIDTH, Math.floor(contentWidth * LEFT_COLUMN_RATIO));
  if (logoRequested) {
    leftWidth = Math.max(leftWidth, COMPACT_LOGO_WIDTH);
  }
  leftWidth = Math.min(leftWidth, Math.max(MIN_LEFT_COLUMN_WIDTH, contentWidth - MIN_RIGHT_COLUMN_WIDTH));
  const rightWidth = Math.max(MIN_RIGHT_COLUMN_WIDTH, contentWidth - leftWidth);
  const showCompactLogo = logoRequested && leftWidth >= COMPACT_LOGO_WIDTH;

  const leftLines = [
    "",
    centerToWidth(`Welcome back ${options.userName}!`, leftWidth),
    "",
    ...(showCompactLogo ? LOGO_LINES.map((line) => centerToWidth(line, leftWidth)) : []),
    ...(showCompactLogo ? [""] : []),
    trimToWidth(`Shell: ${options.shellSummary}`, leftWidth),
    trimToWidth(`Assistant: ${options.assistantSummary}`, leftWidth),
    trimToWidth(options.cwd, leftWidth),
  ];

  const rightLines = [
    "Tips for getting started",
    "Type shell commands directly to execute them",
    "Use /explain for the previous command",
    "Use /explain <command> before running one",
    "────────────────────────────────────────",
    "Recent activity",
    ...(options.recentActivity.length > 0 ? options.recentActivity : ["No recent activity"]),
  ];

  const rowCount = Math.max(leftLines.length, rightLines.length);
  const lines: string[] = [];
  lines.push(createTopBorder(options.title, innerWidth));

  for (let index = 0; index < rowCount; index += 1) {
    const left = trimToWidth(leftLines[index] ?? "", leftWidth);
    const right = trimToWidth(rightLines[index] ?? "", rightWidth);
    lines.push(`│ ${left} │ ${right} │`);
  }

  lines.push(`╰${"─".repeat(innerWidth)}╯`);
  return lines;
}
