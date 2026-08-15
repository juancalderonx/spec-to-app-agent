import assert from "node:assert/strict";
import { test } from "node:test";
import { runScreen, type Section } from "../../cli/menu.ts";

/** Built rather than written, so no source file here carries a raw control byte. */
const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = "\r";

const SECTIONS: Section[] = [
  {
    title: "Specification",
    rows: [
      { glyph: "▤", label: "specs/first.md", note: "First Collection" },
      { glyph: "▤", label: "specs/second.md", note: "Second Collection" },
      { glyph: "▤", label: "specs/third.md", note: "Third Collection" },
    ],
  },
  {
    title: "Provider",
    rows: [
      { glyph: "◆", label: "one", note: "default" },
      { glyph: "◆", label: "two", note: "" },
    ],
  },
];

/** A terminal's input, without a terminal. Records what raw mode was set to. */
function fakeInput(): {
  rawModes: boolean[];
  listeners: number;
  press(chunk: string): void;
  setRawMode(mode: boolean): void;
  setEncoding(encoding: "utf8"): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: string) => void): void;
  off(event: "data", listener: (chunk: string) => void): void;
} {
  const listeners = new Set<(chunk: string) => void>();
  const rawModes: boolean[] = [];
  return {
    rawModes,
    get listeners(): number {
      return listeners.size;
    },
    press(chunk: string): void {
      for (const listener of [...listeners]) {
        listener(chunk);
      }
    },
    setRawMode(mode: boolean): void {
      rawModes.push(mode);
    },
    setEncoding(): void {},
    resume(): void {},
    pause(): void {},
    on(_event: "data", listener: (chunk: string) => void): void {
      listeners.add(listener);
    },
    off(_event: "data", listener: (chunk: string) => void): void {
      listeners.delete(listener);
    },
  };
}

function fakeOutput(): { written: string[]; write(text: string): void } {
  const written: string[] = [];
  return { written, write: (text: string) => void written.push(text) };
}

test("returns one answer per section, in the order they were asked", async () => {
  const input = fakeInput();
  const answers = runScreen(SECTIONS, input, fakeOutput());

  input.press(DOWN);
  input.press(DOWN);
  input.press(ENTER);
  input.press(DOWN);
  input.press(ENTER);

  assert.deepEqual(await answers, [2, 1]);
});

test("returns nothing when the reader quits, so the caller spends nothing", async () => {
  const input = fakeInput();
  const answers = runScreen(SECTIONS, input, fakeOutput());

  input.press("q");

  assert.equal(await answers, null);
});

test("leaves the terminal out of raw mode and drops its listener", async () => {
  const input = fakeInput();
  const answers = runScreen(SECTIONS, input, fakeOutput());

  input.press(String.fromCharCode(3));
  await answers;

  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.listeners, 0);
});

test("redraws the block in place instead of printing it again below itself", async () => {
  const input = fakeInput();
  const output = fakeOutput();
  const answers = runScreen(SECTIONS, input, output);

  input.press(DOWN);
  input.press(ENTER);
  input.press(ENTER);
  await answers;

  const first = output.written[0] ?? "";
  assert.ok(!first.startsWith(ESC), "the first draw has nothing above it to rewind");
  const height = first.split("\n").length - 1;
  assert.ok((output.written[1] ?? "").startsWith(`${ESC}[${height}A${ESC}[0J`));
});
