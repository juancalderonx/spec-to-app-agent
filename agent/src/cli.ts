import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { GraphRecursionError } from "@langchain/langgraph";
import { MAX_PLAN_TASKS, RECURSION_LIMIT, buildGraph } from "./graph/index.ts";
import type { AgentState } from "./graph/state.ts";
import { openGaps, runVerdict } from "./graph/verdict.ts";
import { DEFAULT_PROVIDER, PROVIDERS, requireApiKey } from "./llm/factory.ts";
import { totalUsage } from "./llm/ledger.ts";

// Two modes because the agent has one cache and it is the provider's prompt
// cache: a breakpoint is written and read, or it is not placed at all. A
// `read-only` mode would name a state no provider-side cache can be put in.
const CACHE_MODES = ["on", "off"] as const;

const USAGE = `Usage: npm start -- --spec <path> --output <dir> [options]

Turns a natural-language specification into a working application.

Options:
  --spec <path>      Specification file to build from. Required.
  --output <dir>     Directory the application is generated into. Required.
  --provider <name>  LLM provider: ${PROVIDERS.join(" | ")}.
                     Defaults to $LLM_PROVIDER, then anthropic.
  --model <id>       Model id, overriding the default for every role.
  --cache <mode>     Prompt cache on the stable prefix: ${CACHE_MODES.join(" | ")}.
                     Off prices a run that caches nothing. Defaults to on.
  --help             Print this message.`;

/** Narrows a flag's value to one of its allowed members, or explains why not. */
function member<T extends string>(
  value: string,
  allowed: readonly T[],
  flag: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(
      `--${flag} must be one of: ${allowed.join(", ")} — received "${value}"`,
    );
  }
  return match;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      output: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      cache: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }

  if (values.spec === undefined || values.output === undefined) {
    console.error("Both --spec and --output are required.\n");
    console.error(USAGE);
    return 1;
  }

  const provider = member(
    values.provider ?? process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER,
    PROVIDERS,
    "provider",
  );
  const cache = member(values.cache ?? "on", CACHE_MODES, "cache");
  const model = values.model ?? "provider default";

  // Fails here rather than mid-run: a missing credential should cost nothing.
  requireApiKey(provider);

  // Fixed at startup rather than generated mid-graph, so a replay writes to the
  // same paths as the run it replays.
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const spec = await readFile(resolve(values.spec), "utf8");
  const outputDir = resolve(values.output);

  console.log(
    `run ${runId} · provider ${provider} · model ${model} · cache ${cache}`,
  );

  // Streamed rather than invoked: a run takes minutes, and `invoke` returns
  // only once the whole graph is done, so every line would arrive at the end at
  // once. `"values"` hands over the complete state after each superstep, which
  // is both the line to print now and, at the last one, the state the exit code
  // reads — nothing has to be re-accumulated here to get it.
  const states = await buildGraph({
    provider,
    model: values.model,
    promptCache: cache === "on",
  }).stream(
    { runId, spec, outputDir },
    // The library's default of 25 supersteps is below what a real plan needs
    // once each task costs a visit of its own.
    { recursionLimit: RECURSION_LIMIT, streamMode: "values" },
  );

  // `log` accumulates across the run, so each state carries the lines already
  // printed. The cursor is what keeps a line from being printed twice.
  let printed = 0;
  let final: AgentState | undefined;
  for await (const state of states) {
    for (const entry of state.log.slice(printed)) {
      console.log(`[${entry.node}] ${entry.event}: ${entry.detail}`);
    }
    printed = state.log.length;
    final = state;
  }

  if (final === undefined) {
    console.error("The graph produced no state. Nothing ran.");
    return 1;
  }

  for (const line of summarizeUsage(final)) {
    console.log(line);
  }

  // The rule itself lives in `runVerdict`, where it is unit-tested, and this is
  // the one place a process reads it: `report` writes the same verdict into
  // `summary.md` and sets nothing, because a node that writes `process.exitCode`
  // changes the exit status of every process that runs the graph — the test
  // suite included. What is named here is what the verdict counted — the gaps
  // still open, not every task that ever failed: a task the run gave up on and a
  // later one wrote clean is in the log and in the summary's table already, and
  // naming it beside an exit code of 0 would read as a contradiction.
  const open = openGaps(final);
  if (open.length > 0) {
    console.error(`gaps left open: ${open.join(", ")}`);
  }
  return runVerdict(final);
}

/**
 * What the run spent, with the three kinds of input token reported apart.
 *
 * The cached figures are the only evidence that the prompt cache exists: a
 * breakpoint placed on a prefix that is not stable, or on one below the model's
 * cacheable minimum, produces no error at all — just a bill for the whole
 * prefix on every task. So a run that cached nothing says so rather than
 * printing three zeros and leaving the reader to notice.
 *
 * One line, at the end of a run that has been streaming for minutes. The
 * breakdown — per kind of token, per role, per node and per task — is in
 * `summary.md`, which `report` has just written.
 */
function summarizeUsage(final: AgentState): string[] {
  const total = totalUsage(final.usage);
  const lines = [
    `usage · ${final.usage.length} calls · ` +
      `${total.inputTokens} uncached input · ${total.cachedReadTokens} cached read · ` +
      `${total.cacheWriteTokens} cache write · ${total.outputTokens} output · ` +
      `$${total.costUsd.toFixed(4)}`,
  ];
  if (total.cacheWriteTokens > 0 && total.cachedReadTokens === 0) {
    lines.push(
      "cache: the prefix was written and never read. Something ahead of the " +
        "breakpoint changes from one task to the next.",
    );
  }
  if (total.cacheWriteTokens === 0 && total.cachedReadTokens === 0 && final.usage.length > 0) {
    lines.push(
      "cache: nothing was cached. The stable prefix did not reach the coder " +
        "model's cacheable minimum, or this provider places no breakpoint.",
    );
  }
  return lines;
}

/**
 * The library's own recursion message names a config key and a documentation
 * page, which says nothing about the run that hit it. Exhausting this budget
 * means one thing here: the plan was longer than the agent is built to carry,
 * since the queue advances one task at a time and never loops back.
 */
function explain(error: unknown): string {
  if (error instanceof GraphRecursionError) {
    return (
      `The run exceeded its budget of ${RECURSION_LIMIT} steps, which covers a plan of up to ` +
      `${MAX_PLAN_TASKS} tasks. This specification decomposed into more than that: narrow it, ` +
      `or raise MAX_PLAN_TASKS in agent/src/graph/index.ts.`
    );
  }
  return error instanceof Error ? error.message : String(error);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(explain(error));
  process.exitCode = 1;
}
