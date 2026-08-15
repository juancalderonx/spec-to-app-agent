import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeKey,
  initialScreen,
  nextIndex,
  reduce,
  renderScreen,
  type Section,
} from "../../cli/menu.ts";

/** Built rather than written, so no source file here carries a raw control byte. */
const ESC = String.fromCharCode(27);

const SECTIONS: Section[] = [
  {
    title: "Specification",
    rows: [
      { glyph: "▤", label: "specs/first.md", note: "First Collection" },
      { glyph: "▤", label: "specs/second.md", note: "Second Collection" },
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

test("reads the arrows, the confirmations and the ways out", () => {
  assert.equal(decodeKey(`${ESC}[A`), "up");
  assert.equal(decodeKey(`${ESC}[B`), "down");
  assert.equal(decodeKey("\r"), "select");
  assert.equal(decodeKey("q"), "quit");
  assert.equal(decodeKey(String.fromCharCode(3)), "quit");
});

test("ignores a key the menu has no meaning for", () => {
  assert.equal(decodeKey("x"), null);
  assert.equal(decodeKey(`${ESC}[C`), null);
});

test("wraps the selection at both ends", () => {
  assert.equal(nextIndex("down", 1, 2), 0);
  assert.equal(nextIndex("up", 0, 2), 1);
  assert.equal(nextIndex("down", 0, 2), 1);
});

test("moves nowhere in a menu with no options", () => {
  assert.equal(nextIndex("down", 0, 0), 0);
});

test("the arrows move inside the focused section and leave the others alone", () => {
  const start = initialScreen(SECTIONS);

  const moved = reduce(start, "down", SECTIONS);

  assert.deepEqual(moved.screen, { focus: 0, choices: [1, 0] });
  assert.equal(moved.status, "open");
});

test("enter hands the focus to the next section, and settles on the last", () => {
  const first = reduce(initialScreen(SECTIONS), "select", SECTIONS);
  assert.deepEqual(first.screen.focus, 1);
  assert.equal(first.status, "open");

  const second = reduce(first.screen, "select", SECTIONS);
  assert.equal(second.status, "done");
  assert.deepEqual(second.screen.choices, [0, 0]);
});

test("quitting settles nothing", () => {
  const quit = reduce(initialScreen(SECTIONS), "quit", SECTIONS);

  assert.equal(quit.status, "quit");
});

test("marks the row in flight, the settled ones and nothing else", () => {
  const screen = { focus: 1, choices: [1, 0] };

  const lines = renderScreen(SECTIONS, screen, false).split("\n");

  assert.deepEqual(lines.slice(0, 3), [
    "Specification",
    "   ▤ specs/first.md   First Collection",
    " ✓ ▤ specs/second.md  Second Collection",
  ]);
  assert.equal(lines[4], "Provider");
  assert.match(lines[5] ?? "", /^ ❯ ◆ one/);
});

test("tells a section already answered from one still showing its default", () => {
  const ahead = renderScreen(SECTIONS, initialScreen(SECTIONS), false).split("\n");

  assert.match(ahead[1] ?? "", /^ ❯ ▤ specs\/first\.md/);
  assert.match(ahead[5] ?? "", /^ · ◆ one/);
});

test("keeps every section on screen, not only the one being answered", () => {
  const view = renderScreen(SECTIONS, initialScreen(SECTIONS), false);

  assert.ok(view.includes("Specification"));
  assert.ok(view.includes("Provider"));
  assert.ok(view.includes("↑↓ move"));
});

test("writes no escape sequence when the output is not a terminal", () => {
  const view = renderScreen(SECTIONS, initialScreen(SECTIONS), false, ["ready"]);

  assert.ok(!view.includes(ESC), "plain output must carry no escape sequence");
  assert.ok(view.endsWith("ready"));
});

test("highlights the row in flight to one width when the output is a terminal", () => {
  const lines = renderScreen(SECTIONS, initialScreen(SECTIONS), true).split("\n");
  const highlighted = lines.filter((line) => line.includes("[48;5;236m"));

  assert.equal(highlighted.length, 1);
  assert.ok(highlighted[0]?.includes("specs/first.md"));
});
