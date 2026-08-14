import type { BuildError } from "../graph/state.ts";

/**
 * Turns the two validators' output into errors a prompt can be built from.
 *
 * Nothing here ranks or drops an error: every failure the output names comes
 * back, and whoever builds a repair prompt decides how many fit. Cutting by
 * characters is what a caller must not have to do — half a compiler message is
 * noise, and the unit that survives a cut is one whole error.
 *
 * The one bounded thing is the evidence a test failure carries under its
 * headline, where the runner prints a page of DOM. That is bounded by section
 * and then by whole lines, never mid-line; see `MAX_EVIDENCE_CHARS`.
 *
 * Both parsers are pure text in, errors out, which is what lets them be tested
 * against captured output from real failures without a workspace or a key.
 */

/**
 * One `tsc` error, as it comes out without a TTY: `file(line,col): error TSxxxx:`
 * then the message. Anything the compiler adds below it is indented, which is
 * how the continuation lines are recognised.
 */
const TSC_ERROR =
  /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+): (?<message>.*)$/;

/** ` FAIL  <file> > <suite> > <test>` — the header of one failed test. */
const VITEST_FAILURE = /^\s*FAIL\s+(?<file>\S+)(?<name>.*)$/;

/** A stack frame: ` ❯ [symbol ]<file>:<line>:<column>`. */
const VITEST_FRAME = /^\s*❯\s+(?:.*\s)?(?<file>\S+):(?<line>\d+):\d+\s*$/;

/** `Error name: message` on the first line of a failure block. */
const VITEST_ERROR = /^(?<code>[A-Za-z]*Error):\s*(?<message>.*)$/;

/**
 * The head of the runner's difference block, in either shape it prints: `-
 * Expected` over `+ Received` for a structural comparison, and `Expected:` over
 * `Received:` inline for a single value.
 *
 * The inline shape is the one that matters most here. Chai caps the value it
 * quotes in the headline at 40 characters — `config.truncateThreshold`, its own
 * default — so `expected 'AbcDef…' to contain 'x'` is all the first line ever
 * says about a long string. The `Received:` line under it carries that string
 * whole, and it was being discarded.
 */
const DIFF_HEAD = /^[-+]? ?(?:Expected|Received)\b/;

/** Still inside the difference block: one of its markers, or a gap between them. */
const DIFF_BODY = /^\s*$|^[-+]|^(?:Expected|Received):/;

/**
 * One line of the code frame the runner prints under the failing assertion: a
 * numbered source line, or the caret row pointing into it.
 */
const CODE_FRAME = /^\s*(?:\d+\||\|\s*\^)/;

/**
 * How much of one section reaches the message, in characters.
 *
 * A cap is needed because a repair prompt carries every error of the visit, and
 * one failed query prints the whole DOM it searched — the sibling fixture's
 * first failure spends 12 lines on two empty `<body>` elements, and a real page
 * would spend hundreds. The number is set against what the same prompt already
 * carries: the file's own body, 3–6 KB in the run this came from. At roughly 250
 * tokens per section per error, the evidence stays a fraction of that instead of
 * displacing it.
 *
 * The budget is counted in characters but **spent on whole lines**: the cut
 * lands on a line boundary, never inside one, for the reason the module header
 * gives — half a received value is noise, and the unit that survives a cut is a
 * whole line of it.
 */
const MAX_EVIDENCE_CHARS = 1_000;

/**
 * Colour escapes, which the test runner writes even when nothing is a terminal.
 *
 * Built rather than written as a literal: the pattern starts with the escape
 * control character, and a raw one sitting in a source file is invisible to the
 * next reader and easy for a tool to mangle.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Type-checker output to errors.
 *
 * A message spanning several lines — an overload mismatch names each candidate —
 * arrives as one error whose continuation lines are folded into the message.
 * Dropping them would leave "No overload matches this call" as the entire
 * diagnosis, which says nothing about which argument was wrong.
 */
export function parseTypecheck(output: string): BuildError[] {
  const errors: BuildError[] = [];
  for (const line of strip(output).split("\n")) {
    const match = line.match(TSC_ERROR);
    if (match?.groups !== undefined) {
      errors.push({
        file: match.groups["file"] ?? "",
        line: Number(match.groups["line"]),
        code: match.groups["code"] ?? "",
        message: match.groups["message"] ?? "",
        source: "tsc",
      });
      continue;
    }
    const open = errors.at(-1);
    if (open !== undefined && /^\s+\S/.test(line)) {
      open.message += ` ${line.trim()}`;
    }
  }
  return errors;
}

/**
 * Test-runner output to errors, one per failed test.
 *
 * The line number comes from the first stack frame inside the project. The
 * frames above it are the runner's own — a matcher failing inside the assertion
 * library reports that library's line first — and sending one back would ask for
 * a repair to a file the run does not own. When every frame belongs to a
 * dependency, the error carries no line at all rather than a misleading one.
 *
 * The message is more than the failure's first line: see `evidenceIn`.
 */
export function parseTests(output: string): BuildError[] {
  const errors: BuildError[] = [];
  let block: string[] = [];

  const close = (): void => {
    const error = toError(block);
    if (error !== undefined) {
      errors.push(error);
    }
    block = [];
  };

  for (const line of strip(output).split("\n")) {
    if (VITEST_FAILURE.test(line)) {
      close();
    }
    block.push(line);
  }
  close();
  return errors;
}

/**
 * Whether the runner found nothing to run.
 *
 * It exits non-zero for this exactly as it does for a failing assertion, and the
 * two need different repairs: one asks for the assertion to be fixed, the other
 * for the file to be moved to a path the runner's include patterns match. A
 * caller that cannot tell them apart sends the wrong one.
 */
export function foundNoTestFiles(output: string): boolean {
  return strip(output).includes("No test files found");
}

/** The failure a block describes, or nothing if the block is not one. */
function toError(block: string[]): BuildError | undefined {
  const header = block[0]?.match(VITEST_FAILURE);
  if (header?.groups === undefined) {
    return undefined;
  }
  const name = (header.groups["name"] ?? "").replace(/^\s*>\s*/, "").trim();
  const detail = block.slice(1).find((line) => line.trim() !== "") ?? "";
  const named = detail.match(VITEST_ERROR);
  const frame = block
    .map((line) => line.match(VITEST_FRAME))
    .find(
      (candidate) =>
        candidate?.groups !== undefined &&
        candidate.groups["file"]?.includes("node_modules") === false,
    );

  const headline = `${name}: ${named?.groups?.["message"] ?? detail.trim()}`;
  const error: BuildError = {
    file: header.groups["file"] ?? "",
    code: named?.groups?.["code"] ?? "test-failed",
    message: [headline, ...evidenceIn(block)].join("\n"),
    source: "vitest",
  };
  if (frame?.groups !== undefined) {
    error.line = Number(frame.groups["line"]);
  }
  return error;
}

/**
 * The two parts of a failure block a repair can work from, under the headline:
 * the runner's difference block and the code frame beneath the assertion.
 *
 * They are what the headline is not. Chai truncates the value it quotes there,
 * and the headline names no line of source at all — a repair was being asked to
 * correct an assertion it had been shown 40 characters of. The difference block
 * carries the value whole and the code frame carries the assertion that produced
 * it, with the caret on the call.
 *
 * Everything else in the block is dropped entire, which is the cut: recognised
 * sections in, the rest out. What that discards is the DOM the query library
 * prints when a lookup misses — the largest thing in a failure block and the
 * least useful, since it describes what rendered rather than what was asked of
 * it, and the difference block already says that in two lines.
 */
function evidenceIn(block: readonly string[]): string[] {
  const sections = [
    sectionFrom(block, DIFF_HEAD, DIFF_BODY),
    sectionFrom(block, CODE_FRAME, CODE_FRAME),
  ];
  return sections.filter((section) => section.length > 0).flatMap((section) => ["", ...section]);
}

/**
 * The contiguous run one section occupies: from the first line its head matches,
 * for as long as its body keeps matching. Trailing blank lines are the gap
 * before whatever follows the section, not part of it.
 */
function sectionFrom(block: readonly string[], head: RegExp, body: RegExp): string[] {
  const start = block.findIndex((line) => head.test(line));
  if (start === -1) {
    return [];
  }

  const lines: string[] = [];
  for (const line of block.slice(start)) {
    if (!body.test(line)) {
      break;
    }
    lines.push(line);
  }
  while (lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  return withinBudget(lines);
}

/** Whole lines up to the budget, then a count of what was left behind. */
function withinBudget(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let spent = 0;
  for (const line of lines) {
    spent += line.length + 1;
    if (spent > MAX_EVIDENCE_CHARS) {
      kept.push(`… ${lines.length - kept.length} more lines, past the ${MAX_EVIDENCE_CHARS}-character budget`);
      break;
    }
    kept.push(line);
  }
  return kept;
}

function strip(output: string): string {
  return output.replace(ANSI, "");
}
