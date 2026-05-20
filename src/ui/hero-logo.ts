const RAW_CLIA_TERM_HERO_LOGO = `
  ____ _     ___    _        _
 / ___| |   |_ _|  / \\      | |_ ___ _ __ _ __ ___
| |   | |    | |  / _ \\_____| __/ _ \\ '__| '_ \` _ \\
| |___| |___ | | / ___ \\____| ||  __/ |  | | | | | |
 \\____|_____|___/_/   \\_\\    \\__\\___|_|  |_| |_| |_|
`;

function normalizeLogo(raw: string): readonly string[] {
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

const HERO_LOGO_LINES = normalizeLogo(RAW_CLIA_TERM_HERO_LOGO);
const HERO_LOGO_WIDTH = HERO_LOGO_LINES.reduce((max, line) => Math.max(max, line.length), 0);

export function getHeroLogoWidth(): number {
  return HERO_LOGO_WIDTH;
}

export function buildHeroLogoLines(terminalWidth: number): readonly string[] {
  if (terminalWidth < HERO_LOGO_WIDTH) {
    return [];
  }

  const leftPadding = Math.floor((terminalWidth - HERO_LOGO_WIDTH) / 2);
  const prefix = " ".repeat(leftPadding);
  return HERO_LOGO_LINES.map((line) => `${prefix}${line}`);
}
