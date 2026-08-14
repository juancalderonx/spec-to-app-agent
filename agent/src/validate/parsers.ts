import type { BuildError } from "../graph/state.ts";

/**
 * Turns the two validators' output into errors a prompt can be built from.
 *
 * Nothing here truncates or ranks: every error the output names comes back, and
 * whoever builds a repair prompt decides how many fit. Cutting by characters is
 * what a caller must not have to do — half a compiler message is noise, and the
 * unit that survives a cut is one whole error.
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

  const error: BuildError = {
    file: header.groups["file"] ?? "",
    code: named?.groups?.["code"] ?? "test-failed",
    message: `${name}: ${named?.groups?.["message"] ?? detail.trim()}`,
    source: "vitest",
  };
  if (frame?.groups !== undefined) {
    error.line = Number(frame.groups["line"]);
  }
  return error;
}

function strip(output: string): string {
  return output.replace(ANSI, "");
}
