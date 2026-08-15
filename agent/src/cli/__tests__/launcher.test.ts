import assert from "node:assert/strict";
import { test } from "node:test";
import {
  banner,
  defaultOutput,
  needsLauncher,
  specTitle,
  type Environment,
} from "../../cli/launcher.ts";

/** Built rather than written, so no source file here carries a raw control byte. */
const ESC = String.fromCharCode(27);

const ENVIRONMENT: Environment = { version: "0.1.0", node: "v25.8.1", envLoaded: true };

test("closes the welcome box whatever the text inside it is", () => {
  const lines = banner(false, ENVIRONMENT).split("\n");
  const widths = new Set(lines.map((line) => [...line].length));

  assert.equal(widths.size, 1, `ragged box: ${lines.join(" | ")}`);
  assert.match(lines[0] ?? "", /^╭─+╮$/);
  assert.match(lines.at(-1) ?? "", /^╰─+╯$/);
});

test("says what it is running on, and whether a credential file was loaded", () => {
  assert.match(banner(false, ENVIRONMENT), /v0\.1\.0 · Node v25\.8\.1 · \.env loaded/);
  assert.match(banner(false, { ...ENVIRONMENT, envLoaded: false }), /no \.env/);
});

test("leaves the version out when npm did not supply one", () => {
  const line = banner(false, { ...ENVIRONMENT, version: undefined });

  assert.doesNotMatch(line, /v0\.1\.0/);
  assert.match(line, /Node v25\.8\.1/);
});

test("writes no escape sequence when the output is not a terminal", () => {
  assert.ok(!banner(false, ENVIRONMENT).includes(ESC));
  assert.ok(banner(true, ENVIRONMENT).includes(ESC));
});

test("asks only when a terminal is there and no specification was named", () => {
  assert.equal(needsLauncher({}, true), true);
  assert.equal(needsLauncher({ spec: "specs/one.md" }, true), false);
  assert.equal(needsLauncher({}, false), false);
});

test("describes a specification with its own first heading", () => {
  assert.equal(specTitle("# Vinyl Record Collection\n\n## Context\n"), "Vinyl Record Collection");
  assert.equal(specTitle("Not a heading\n"), "");
  assert.equal(specTitle("## Context\n# Later Heading\n"), "Later Heading");
});

test("offers a directory no earlier run can have written into", () => {
  const output = defaultOutput(new Date("2026-08-15T05:55:09.788Z"));

  assert.equal(output, "runs/app-2026-08-15T05-55-09-788Z");
});
