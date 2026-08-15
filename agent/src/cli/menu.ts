import { BAR, BOLD, GREY, RESET, VIOLET, cap, pad, rewind, width } from "./ansi.ts";

export type Key = "up" | "down" | "select" | "quit";

/**
 * The four keys a list needs, from the bytes a terminal in raw mode delivers.
 *
 * An escape sequence arrives as one chunk, so the arrows are matched whole
 * rather than as a state machine over single bytes. Anything else is ignored:
 * a key with no meaning here must not move the selection.
 */
export function decodeKey(chunk: string): Key | null {
  switch (chunk) {
    case "\u001b[A":
    case "k":
      return "up";
    case "\u001b[B":
    case "j":
      return "down";
    case "\r":
    case "\n":
      return "select";
    // Ctrl-C reaches this function instead of the signal handler: raw mode is
    // what puts it here, so raw mode has to answer for it.
    case "\u0003":
    case "q":
    case "\u001b":
      return "quit";
    default:
      return null;
  }
}

/** Where the selection lands, wrapping at both ends. */
export function nextIndex(key: Key, index: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  if (key === "up") {
    return (index - 1 + count) % count;
  }
  if (key === "down") {
    return (index + 1) % count;
  }
  return index;
}

export interface Row {
  /** A single-cell glyph. Nothing from a patched font: an unpatched terminal draws a box. */
  glyph: string;
  label: string;
  /** What the label means, in a second column. Empty prints nothing. */
  note: string;
}

export interface Section {
  title: string;
  rows: readonly Row[];
}

/** One choice per section, and which section the keys are moving in. */
export interface Screen {
  focus: number;
  choices: readonly number[];
}

export type Status = "open" | "done" | "quit";

export function initialScreen(sections: readonly Section[]): Screen {
  return { focus: 0, choices: sections.map(() => 0) };
}

/**
 * One keypress against the screen: pure, so the whole interaction can be
 * replayed in a test without a terminal.
 *
 * The arrows move inside the section that has the focus and `enter` hands the
 * focus to the next one, which is what keeps every choice on screen at once —
 * a reader can see what they picked two questions ago instead of trusting their
 * memory of a prompt that scrolled away.
 */
export function reduce(
  screen: Screen,
  key: Key,
  sections: readonly Section[],
): { screen: Screen; status: Status } {
  if (key === "quit") {
    return { screen, status: "quit" };
  }
  if (key === "select") {
    const last = screen.focus >= sections.length - 1;
    return {
      screen: last ? screen : { ...screen, focus: screen.focus + 1 },
      status: last ? "done" : "open",
    };
  }
  const rows = sections[screen.focus]?.rows.length ?? 0;
  const choices = screen.choices.map((choice, section) =>
    section === screen.focus ? nextIndex(key, choice, rows) : choice,
  );
  return { screen: { ...screen, choices }, status: "open" };
}

const HINT = " ↑↓ move   enter select   q quit";

function hint(colour: boolean): string {
  return colour
    ? ` ${GREY}↑↓ move${RESET}   ${cap("enter", true)} ${GREY}select${RESET}   ` +
        `${cap("q", true)} ${GREY}quit${RESET}`
    : HINT;
}

/**
 * The whole screen as one string: every section, the choices made so far, and
 * a footer.
 *
 * Rendering all of it every time and redrawing the block is what makes a
 * settled choice stay visible. The alternative — printing each question as it
 * is answered — is the interaction this replaces.
 */
export function renderScreen(
  sections: readonly Section[],
  screen: Screen,
  colour: boolean,
  footer: readonly string[] = [],
): string {
  const labels = sections.flatMap((section) => section.rows.map((row) => width(row.label)));
  const column = Math.max(...labels, 0) + 2;
  // Every row is padded to the widest one so the highlight is a bar of one
  // length rather than a ragged patch behind the longest text.
  const body = (row: Row, marker: string): string =>
    ` ${marker} ${row.glyph} ${pad(row.label, column)}${row.note}`;
  const bodies = sections.flatMap((section) => section.rows.map((row) => body(row, " ")));
  const bar = Math.max(...bodies.map(width), 0) + 1;

  const lines: string[] = [];
  for (const [index, section] of sections.entries()) {
    const focused = index === screen.focus;
    lines.push(colour ? `${BOLD}${section.title}${RESET}` : section.title);
    for (const [position, row] of section.rows.entries()) {
      const chosen = position === screen.choices[index];
      // A section already answered carries a tick; one still ahead carries a
      // dot, because what it shows is a default nobody has confirmed yet.
      const settled = index < screen.focus;
      const marker = focused && chosen ? "❯" : chosen ? (settled ? "✓" : "·") : " ";
      const text = body(row, marker);
      if (!colour) {
        lines.push(text.trimEnd());
      } else if (focused && chosen) {
        lines.push(`${BAR}${VIOLET}${pad(text, bar)}${RESET}`);
      } else {
        lines.push(chosen ? `${VIOLET}${text}${RESET}` : `${GREY}${text}${RESET}`);
      }
    }
    lines.push("");
  }
  lines.push(hint(colour));
  lines.push(...footer);
  return lines.join("\n");
}

export interface MenuOutput {
  write(text: string): void;
  isTTY?: boolean;
}

/**
 * The part of a terminal's input a menu uses.
 *
 * Named as its own shape rather than as `NodeJS.ReadStream` so the keypress
 * loop can be driven by a fake in a test: the alternative is a cast, and a cast
 * to a stream type is how a keypress loop ends up with no test at all.
 * `process.stdin` satisfies it as it is.
 */
export interface KeyInput {
  setRawMode(mode: boolean): unknown;
  setEncoding(encoding: "utf8"): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

/**
 * Runs the screen until every section is settled, and returns the chosen index
 * per section. `null` means the reader quit, which is an answer: the caller
 * stops, and nothing has been spent.
 *
 * The terminal is put in raw mode so a keypress arrives without a newline, and
 * is put back on every exit — including the one through Ctrl-C, which raw mode
 * intercepts. A process left in raw mode is a shell that stops echoing what is
 * typed into it, so the restore is in a `finally` rather than beside each
 * `return`.
 */
export async function runScreen(
  sections: readonly Section[],
  input: KeyInput,
  output: MenuOutput,
  footer: (screen: Screen) => readonly string[] = () => [],
): Promise<number[] | null> {
  const colour = output.isTTY === true;
  let screen = initialScreen(sections);
  let height = 0;

  const draw = (): void => {
    const view = renderScreen(sections, screen, colour, footer(screen));
    const lines = view.split("\n");
    output.write(`${height === 0 ? "" : rewind(height)}${view}\n`);
    height = lines.length;
  };

  draw();
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  try {
    return await new Promise<number[] | null>((resolve) => {
      const onData = (chunk: string): void => {
        const key = decodeKey(chunk);
        if (key === null) {
          return;
        }
        const step = reduce(screen, key, sections);
        screen = step.screen;
        if (step.status === "open") {
          draw();
          return;
        }
        input.off("data", onData);
        draw();
        resolve(step.status === "done" ? [...screen.choices] : null);
      };
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}
