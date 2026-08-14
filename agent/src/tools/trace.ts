import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One tool invocation, as one line of the trace.
 *
 * `args` carries identifiers and sizes — a path, a byte count, a command name —
 * and never a file's contents. A trace that embeds what was written is a second
 * copy of the output directory rather than something a reviewer can read.
 */
export interface TraceEntry {
  tool: string;
  args: Record<string, string | number>;
  outcome: "ok" | "rejected" | "failed";
  detail: string;
  durationMs: number;
}

export type Trace = (entry: TraceEntry) => void;

/**
 * A refusal by policy — a path that escapes the sandbox, a command outside the
 * allowlist — as opposed to an I/O or process failure. It lives here because
 * the trace is what has to tell the two apart: a rejection is a guarantee doing
 * its job, a failure is the machine having a bad day.
 */
export class SandboxError extends Error {}

export function openTrace(filePath: string): Trace {
  mkdirSync(dirname(filePath), { recursive: true });
  // Synchronous on purpose: appends land in invocation order and no line can
  // interleave with another, which is what makes the file parseable per line.
  return (entry) => appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Keeps a trace line readable. Announces the cut instead of hiding it. */
export function truncate(text: string, limit = 400): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}… (${text.length - limit} more characters)`;
}

/**
 * Runs one tool invocation, times it, and records exactly one trace line for it
 * whether it succeeds, is rejected or fails. Every tool goes through here, so
 * "one line per invocation" is a property of this function rather than a
 * convention each tool has to remember.
 */
export async function traced<T>(
  trace: Trace,
  tool: string,
  args: Record<string, string | number>,
  action: () => Promise<T>,
  describe: (result: T) => string = () => "",
): Promise<T> {
  const started = performance.now();
  try {
    const result = await action();
    trace({ tool, args, outcome: "ok", detail: describe(result), durationMs: elapsed(started) });
    return result;
  } catch (error) {
    trace({
      tool,
      args,
      outcome: error instanceof SandboxError ? "rejected" : "failed",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: elapsed(started),
    });
    throw error;
  }
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(1));
}
