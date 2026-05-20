import { useEffect, useState } from "react";

type TerminalSize = {
  readonly width: number;
  readonly height: number;
};

const FALLBACK_WIDTH = 80;
const FALLBACK_HEIGHT = 24;

function resolveSize(stdout: NodeJS.WriteStream): TerminalSize {
  return {
    width: stdout.columns ?? FALLBACK_WIDTH,
    height: stdout.rows ?? FALLBACK_HEIGHT,
  };
}

export function useTerminalSize(stdout: NodeJS.WriteStream): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => resolveSize(stdout));

  useEffect(() => {
    const updateSize = (): void => {
      setSize(resolveSize(stdout));
    };

    updateSize();
    stdout.on("resize", updateSize);
    return () => {
      stdout.off("resize", updateSize);
    };
  }, [stdout]);

  return size;
}
