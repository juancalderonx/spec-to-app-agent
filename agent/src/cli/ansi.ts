/**
 * Every escape sequence the terminal user interface uses, built from one
 * constant.
 *
 * Written as `\u001b` in one place rather than as a literal control byte in
 * twenty: a raw escape in a source file is invisible in a diff, survives a
 * copy-paste as something else, and is the kind of character a reviewer cannot
 * see to review.
 */
const ESC = "\u001b";

/**
 * 256-colour rather than 24-bit. A terminal without truecolor renders a 24-bit
 * escape wrong instead of approximately, and nothing here needs a colour the
 * 256-colour cube cannot name.
 */
export const VIOLET = `${ESC}[38;5;141m`;
export const BLUE = `${ESC}[38;5;110m`;
export const GREEN = `${ESC}[38;5;114m`;
export const AMBER = `${ESC}[38;5;179m`;
export const RED = `${ESC}[38;5;168m`;
export const GREY = `${ESC}[38;5;244m`;
export const FAINT = `${ESC}[38;5;238m`;
export const BAR = `${ESC}[48;5;236m`;
export const BOLD = `${ESC}[1m`;
export const REVERSE = `${ESC}[7m`;
export const RESET = `${ESC}[0m`;

/** Screen control. The alternate buffer is what keeps a run out of the shell's scrollback. */
export const ALT_SCREEN_ON = `${ESC}[?1049h`;
export const ALT_SCREEN_OFF = `${ESC}[?1049l`;
export const CURSOR_HIDE = `${ESC}[?25l`;
export const CURSOR_SHOW = `${ESC}[?25h`;
export const HOME = `${ESC}[H`;
export const CLEAR_BELOW = `${ESC}[0J`;

/** Moves the cursor up `lines` and clears everything below it. */
export function rewind(lines: number): string {
  return `${ESC}[${lines}A${ESC}[0J`;
}

/** True when `text` carries any escape sequence at all. The one check a plain-output test needs. */
export function hasEscape(text: string): boolean {
  return text.includes(ESC);
}

export function paint(text: string, code: string, colour: boolean): string {
  return colour ? `${code}${text}${RESET}` : text;
}

/**
 * Printable width in columns.
 *
 * Code points, not UTF-16 units, and escape sequences do not count — a padded
 * line whose colour codes were measured is a line that breaks a box.
 */
export function width(text: string): number {
  return [...text.replace(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g"), "")].length;
}

export function pad(text: string, columns: number): string {
  return text + " ".repeat(Math.max(columns - width(text), 0));
}

/** Cuts to `columns`, marking the cut. Only ever applied to text with no escapes in it. */
export function truncate(text: string, columns: number): string {
  const points = [...text];
  return points.length <= columns ? text : `${points.slice(0, Math.max(columns - 1, 0)).join("")}…`;
}

/**
 * Breaks `text` into lines of at most `columns`, indenting every line after the
 * first.
 *
 * Word-aware, falling back to a hard cut for a word longer than the width — a
 * file path is one word and is exactly what a log line is full of.
 */
export function wrap(text: string, columns: number, indent: number = 0): string[] {
  if (columns <= 1) {
    return [text];
  }
  const lines: string[] = [];
  let current = "";
  let limit = columns;
  const push = (): void => {
    lines.push(current);
    current = " ".repeat(indent);
    limit = columns;
  };
  for (const word of text.split(" ")) {
    const candidate = current === "" || current.trim() === "" ? `${current}${word}` : `${current} ${word}`;
    if (width(candidate) <= limit) {
      current = candidate;
      continue;
    }
    if (current.trim() !== "") {
      push();
    }
    let rest = word;
    while (width(`${current}${rest}`) > limit) {
      const room = Math.max(limit - width(current), 1);
      current = `${current}${[...rest].slice(0, room).join("")}`;
      rest = [...rest].slice(room).join("");
      push();
    }
    current = `${current}${rest}`;
  }
  if (current.trim() !== "" || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

/** A key drawn as a key. Reverse video, because a box around one character needs three lines. */
export function cap(label: string, colour: boolean): string {
  return colour ? `${REVERSE} ${label} ${RESET}` : `[${label}]`;
}

/** `1m48s`, `47s`. No hour segment: an hour reads as `72m03s`, which is not wrong. */
export function duration(milliseconds: number): string {
  const seconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest}s` : `${minutes}m${String(rest).padStart(2, "0")}s`;
}
