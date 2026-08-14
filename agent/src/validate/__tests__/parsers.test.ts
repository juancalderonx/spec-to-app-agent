import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { foundNoTestFiles, parseTests, parseTypecheck } from "../parsers.ts";

/**
 * Captured from real failures, not written by hand: a component with four
 * deliberate mistakes type-checked against the provided project, and two
 * deliberately failing tests run against it. Output invented from memory would
 * only prove the parser matches what its author remembered.
 */
function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", `${name}.txt`), "utf8");
}

test("parses every type error, with the file and line the compiler named", () => {
  const errors = parseTypecheck(fixture("typecheck-failure"));

  assert.equal(errors.length, 4);
  assert.deepEqual(errors[3], {
    file: "src/components/InventoryList.tsx",
    line: 29,
    code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'.",
    source: "tsc",
  });
  assert.deepEqual(
    errors.map((error) => error.line),
    [18, 20, 20, 29],
  );
  // The banner npm prints ahead of the command is not an error.
  assert.equal(
    errors.filter((error) => error.file.includes("car-inventory-boilerplate")).length,
    0,
  );
});

test("folds a multi-line diagnosis into the error it belongs to", () => {
  const overload = parseTypecheck(fixture("typecheck-failure")).find(
    (error) => error.code === "TS2769",
  );

  // "No overload matches this call" on its own says nothing about which
  // argument was wrong; the lines under it are where the answer is.
  assert.match(overload?.message ?? "", /^No overload matches this call\./);
  assert.match(overload?.message ?? "", /Overload 1 of 2/);
  assert.match(overload?.message ?? "", /Did you mean '"subtitle1"'\?/);
});

test("returns nothing for output that reports no error", () => {
  assert.deepEqual(parseTypecheck("\n> boilerplate@1.0.0 typecheck\n> tsc --noEmit\n\n"), []);
  assert.deepEqual(parseTests("\n ✓ src/__tests__/Panel.test.tsx (2 tests) 47ms\n"), []);
});

test("parses one error per failed test, from the frame inside the project", () => {
  const errors = parseTests(fixture("test-failure"));

  assert.equal(errors.length, 2);
  assert.deepEqual(errors[1], {
    file: "src/__tests__/InventoryList.test.tsx",
    line: 21,
    code: "AssertionError",
    message: "InventoryList > counts the rows it rendered: expected [] to have a length of 3 but got +0",
    source: "vitest",
  });
  // The first failure's stack opens inside the assertion library. The frame that
  // matters is the one in the file the run owns, three frames down.
  assert.equal(errors[0]?.line, 17);
  assert.equal(errors[0]?.code, "TestingLibraryElementError");
  assert.match(errors[0]?.message ?? "", /^InventoryList > renders the empty state: Unable to find/);
});

test("strips the colour escapes the runner writes to a pipe", () => {
  const serialized = JSON.stringify(parseTests(fixture("test-failure")));

  assert.doesNotMatch(serialized, new RegExp(String.fromCharCode(27)));
  assert.doesNotMatch(serialized, /\[3[0-9]m/);
});

test("leaves the line out when every frame belongs to a dependency", () => {
  const output = [
    " FAIL  src/__tests__/Panel.test.tsx > Panel > renders",
    "AssertionError: expected false to be true",
    " ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27",
    " ❯ node_modules/@testing-library/dom/dist/query-helpers.js:86:33",
  ].join("\n");

  const errors = parseTests(output);

  assert.equal(errors.length, 1);
  // Not zero and not the dependency's line: both would send a repair to a file
  // it cannot fix.
  assert.equal(errors[0]?.line, undefined);
  assert.ok(!("line" in (errors[0] ?? {})));
});

test("tells an empty test run apart from a failing one", () => {
  assert.equal(foundNoTestFiles(fixture("no-test-files")), true);
  assert.equal(foundNoTestFiles(fixture("test-failure")), false);
  // The runner exits 1 for both, and this is the only thing that separates them.
  assert.deepEqual(parseTests(fixture("no-test-files")), []);
});
