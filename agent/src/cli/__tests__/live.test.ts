import assert from "node:assert/strict";
import { test } from "node:test";
import { ALT_SCREEN_OFF, ALT_SCREEN_ON } from "../../cli/ansi.ts";
import { createLive, decodeCommand, scrollBy, type ScreenOutput } from "../../cli/live.ts";
import type { KeyInput } from "../../cli/menu.ts";
import type { AgentState, LogEntry } from "../../graph/state.ts";

/** Built rather than written, so no source file here carries a raw control byte. */
const ESC = String.fromCharCode(27);

test("answers the keys the screen documents, and ignores the rest", () => {
  assert.equal(decodeCommand("q"), "stop");
  assert.equal(decodeCommand(String.fromCharCode(3)), "stop");
  assert.equal(decodeCommand(`${ESC}[A`), "up");
  assert.equal(decodeCommand(`${ESC}[B`), "down");
  assert.equal(decodeCommand(`${ESC}[5~`), "page-up");
  assert.equal(decodeCommand(`${ESC}[6~`), "page-down");
  assert.equal(decodeCommand("g"), "follow");
  assert.equal(decodeCommand("z"), null);
});

test("follows the tail until the reader scrolls away from it", () => {
  assert.equal(scrollBy(0, "up", 10, 100), 1);
  assert.equal(scrollBy(1, "page-up", 10, 100), 11);
  assert.equal(scrollBy(11, "page-down", 10, 100), 1);
  assert.equal(scrollBy(1, "follow", 10, 100), 0);
});

test("cannot scroll past the oldest line or below the newest", () => {
  assert.equal(scrollBy(0, "down", 10, 100), 0);
  assert.equal(scrollBy(95, "up", 10, 100), 90);
  assert.equal(scrollBy(0, "up", 10, 5), 0);
});

test("leaves the window where it is when the key was not a scroll", () => {
  assert.equal(scrollBy(7, "stop", 10, 100), 7);
});

/** A terminal's two ends, without a terminal. */
function fakeTerminal(): {
  written: string[];
  keys: (chunk: string) => void;
  input: KeyInput;
  output: ScreenOutput;
} {
  const written: string[] = [];
  const listeners = new Set<(chunk: string) => void>();
  return {
    written,
    keys: (chunk: string) => {
      for (const listener of [...listeners]) {
        listener(chunk);
      }
    },
    input: {
      setRawMode: () => undefined,
      setEncoding: () => undefined,
      resume: () => undefined,
      pause: () => undefined,
      on: (_event, listener) => listeners.add(listener),
      off: (_event, listener) => listeners.delete(listener),
    },
    output: {
      write: (text: string) => void written.push(text),
      columns: 100,
      rows: 30,
      isTTY: true,
      on: () => undefined,
      off: () => undefined,
    },
  };
}

function stateWith(log: LogEntry[]): AgentState {
  return {
    runId: "test-live",
    spec: "One screen listing the collection.",
    outputDir: "/nowhere",
    surface: {},
    projectSurface: {},
    tasks: [],
    orderedTaskIds: ["first"],
    cursor: 1,
    attempts: {},
    status: {},
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log,
  };
}

const FACTS = {
  runId: "app-2026-08-15T06-22-08-872Z",
  provider: "anthropic",
  model: "test-model",
  cache: "on",
  startedAt: new Date("2026-08-15T06:22:08.872Z"),
};

test("takes the alternate buffer, gives it back, and leaves the log behind", () => {
  const terminal = fakeTerminal();
  let stopped = false;
  const live = createLive({
    facts: FACTS,
    input: terminal.input,
    output: terminal.output,
    onStop: () => {
      stopped = true;
    },
  });

  const entries: LogEntry[] = [
    { node: "prepare", event: "installed", detail: "npm install exited 0" },
    { node: "plan", event: "planned", detail: "1 task on attempt 1 of 2" },
  ];
  live.update(stateWith(entries), entries, ["first"]);
  terminal.keys("q");
  const replay = live.finish("stopped");

  assert.ok(terminal.written[0]?.includes(ALT_SCREEN_ON), "the screen is taken on the way in");
  assert.ok(terminal.written.at(-1)?.includes(ALT_SCREEN_OFF), "and given back on the way out");
  assert.equal(stopped, true);
  assert.deepEqual(replay, [
    "[prepare] installed: npm install exited 0",
    "[plan] planned: 1 task on attempt 1 of 2",
  ]);
});

test("stops drawing once it is finished", () => {
  const terminal = fakeTerminal();
  const live = createLive({
    facts: FACTS,
    input: terminal.input,
    output: terminal.output,
    onStop: () => undefined,
  });

  live.finish("finished");
  const afterFinish = terminal.written.length;
  terminal.keys("g");

  assert.equal(terminal.written.length, afterFinish);
});
