export type MouseWheelDirection = "up" | "down";

const ESCAPE_SEQUENCE = "\u001b";
const CSI_SEQUENCE_PREFIX = "\u001b[";
export const MOUSE_SEQUENCE_PREFIX = "\u001b[<";
const SGR_MOUSE_EVENT_PATTERN = /\u001b\[<(\d+);(\d+);(\d+)([mM])/g;
const MAX_MOUSE_BUFFER_SIZE = 256;

export const ENABLE_MOUSE_TRACKING_SEQUENCE = "\u001b[?1000h\u001b[?1006h";
export const DISABLE_MOUSE_TRACKING_SEQUENCE = "\u001b[?1000l\u001b[?1006l";

export type MouseWheelParseResult = {
  readonly directions: readonly MouseWheelDirection[];
  readonly remainder: string;
};

function extractTrailingMouseRemainder(segment: string): string {
  const mousePrefixIndex = segment.lastIndexOf(MOUSE_SEQUENCE_PREFIX);
  if (mousePrefixIndex >= 0) {
    return segment.slice(mousePrefixIndex);
  }

  if (segment.endsWith(CSI_SEQUENCE_PREFIX)) {
    return CSI_SEQUENCE_PREFIX;
  }

  if (segment.endsWith(ESCAPE_SEQUENCE)) {
    return ESCAPE_SEQUENCE;
  }

  return "";
}

export function consumeMouseWheelDirections(remainder: string, chunk: string): MouseWheelParseResult {
  const combined = `${remainder}${chunk}`.slice(-MAX_MOUSE_BUFFER_SIZE);
  const directions: MouseWheelDirection[] = [];
  let lastConsumedIndex = 0;

  SGR_MOUSE_EVENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_EVENT_PATTERN.exec(combined)) !== null) {
    const code = Number.parseInt(match[1], 10);
    if ((code & 64) !== 64) {
      lastConsumedIndex = SGR_MOUSE_EVENT_PATTERN.lastIndex;
      continue;
    }

    // Ignore horizontal wheel and keep only vertical scrolling directions.
    if ((code & 0b10) !== 0) {
      lastConsumedIndex = SGR_MOUSE_EVENT_PATTERN.lastIndex;
      continue;
    }

    directions.push((code & 0b1) === 0 ? "up" : "down");
    lastConsumedIndex = SGR_MOUSE_EVENT_PATTERN.lastIndex;
  }

  const trailingSegment = combined.slice(lastConsumedIndex);
  const nextRemainder = extractTrailingMouseRemainder(trailingSegment);

  return {
    directions,
    remainder: nextRemainder,
  };
}
