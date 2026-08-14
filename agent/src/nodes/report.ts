import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  AgentState,
  BuildError,
  LogEntry,
  ReviewReport,
  TaskStatus,
  UsageEntry,
} from "../graph/state.ts";
import { runVerdict } from "../graph/verdict.ts";
import { totalUsage } from "../llm/ledger.ts";
import { costUsd } from "../llm/pricing.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Writes what a run leaves behind, and nothing else: this node judges nothing
 * and calls no provider.
 *
 * Three of the five artifacts are written here. The other two are written where
 * they are produced — `plan.json` by `plan`, as soon as a plan validates, and
 * `tools.jsonl` by the trace, one line per tool invocation — so that a run that
 * dies before this node still leaves them on disk.
 *
 * **It does not set the process exit code.** The ticket asked it to; a node that
 * writes `process.exitCode` changes the exit status of any process that runs the
 * graph, and the graph is run by the test suite. The verdict is written into the
 * summary instead, and the process still gets it from `runVerdict`, called once,
 * in the CLI.
 *
 * **On failure:** I/O only, and it falls back to printing the summary on stdout.
 * A run whose artifacts cannot be written must still be able to tell someone
 * what it did.
 */
export async function report(state: AgentState): Promise<Partial<AgentState>> {
  const directory = join(REPO_ROOT, "agent", "runs", state.runId);
  const summary = buildSummary(state);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "errors.jsonl"),
      state.errors.map((error) => `${JSON.stringify(error)}\n`).join(""),
      "utf8",
    );
    await writeFile(
      join(directory, "usage.json"),
      `${JSON.stringify({ totals: totalUsage(state.usage), entries: state.usage }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(directory, "summary.md"), summary, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(summary);
    return { log: [record("failed", `artifacts not written: ${message}`)] };
  }

  return {
    log: [
      record(
        "wrote",
        `errors.jsonl, usage.json, summary.md · agent/runs/${state.runId} · exit ${runVerdict(state)}`,
      ),
    ],
  };
}

/**
 * The artifact a reader opens first, and the only one that has to be readable by
 * someone who has not seen the code.
 *
 * It answers three questions the submission is judged on, in this order: what
 * came out of the run, what it cost, and what the run itself says is still
 * missing. The cost section splits the spend by kind of token rather than
 * printing one total, because the split is the interesting part — a run whose
 * bill is almost entirely output tokens is a run whose context management
 * worked.
 */
function buildSummary(state: AgentState): string {
  const totals = totalUsage(state.usage);
  const byKind = costByKind(state.usage);
  const cost = totals.costUsd;
  // Against the sum of the four parts rather than the ledger's total, so the
  // column adds up to 100% inside its own table. The two agree whenever the
  // ledger was priced by the same table, which is every run of this agent.
  const priced = byKind.input + byKind.cachedRead + byKind.cacheWrite + byKind.output;
  const share = (part: number): string =>
    priced === 0 ? "—" : `${((part / priced) * 100).toFixed(1)}%`;

  const counts = statusCounts(state);
  return [
    `# Run ${state.runId}`,
    "",
    `${state.orderedTaskIds.length} tasks · ${counts.done} done · ${counts.failed} failed · ` +
      `${counts.pending} unresolved · ${state.usage.length} calls · ` +
      `$${cost.toFixed(4)} · exit ${runVerdict(state)}`,
    "",
    "## Cost",
    "",
    table(
      ["", "tokens", "cost", "share"],
      [
        ["input, uncached", String(totals.inputTokens), money(byKind.input), share(byKind.input)],
        ["input, cache read", String(totals.cachedReadTokens), money(byKind.cachedRead), share(byKind.cachedRead)],
        ["input, cache write", String(totals.cacheWriteTokens), money(byKind.cacheWrite), share(byKind.cacheWrite)],
        ["output", String(totals.outputTokens), money(byKind.output), share(byKind.output)],
      ],
    ),
    "",
    `Total: **${money(cost)}** over ${state.usage.length} calls.`,
    "",
    "### By role",
    "",
    table(
      ["role", "models", "calls", "input", "cache read", "cache write", "output", "cost"],
      rollup(state.usage, (entry) => entry.role).map(([role, entries]) => [
        role,
        [...new Set(entries.map((entry) => entry.model))].join(", "),
        ...figures(entries),
      ]),
    ),
    "",
    "### By node",
    "",
    table(
      ["node", "calls", "input", "cache read", "cache write", "output", "cost"],
      rollup(state.usage, (entry) => entry.node).map(([node, entries]) => [node, ...figures(entries)]),
    ),
    "",
    "## Tasks, in execution order",
    "",
    renderTasks(state),
    "",
    "## Review",
    "",
    renderReview(state.reviewReport),
    "",
    "## Errors at the end of the run",
    "",
    renderErrors(state.errors),
    "",
  ].join("\n");
}

/**
 * One row per task, in the order they ran, with what each one spent.
 *
 * Three statuses, not two. A task whose validation was red about files it does
 * not own is neither done nor failed: it was attempted, nothing it owns was ever
 * judged clean, and it was not rolled back. Collapsing it into either column
 * would quietly drop the one task a reader most needs to look at.
 */
function renderTasks(state: AgentState): string {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const rows = state.orderedTaskIds.map((id, index) => {
    const task = tasks.get(id);
    const spent = state.usage.filter((entry) => entry.task === id);
    const totals = totalUsage(spent);
    return [
      String(index + 1),
      id,
      task === undefined ? "—" : `\`${task.targetPath}\``,
      task === undefined ? "—" : task.taskType,
      describeStatus(state.status[id]),
      String(state.attempts[id] ?? 0),
      String(totals.inputTokens),
      String(totals.cachedReadTokens),
      String(totals.outputTokens),
      money(totals.costUsd),
    ];
  });

  return [
    table(
      ["#", "task", "file", "type", "status", "repairs", "input", "cache read", "output", "cost"],
      rows,
    ),
    "",
    "`unresolved`: the task was attempted and its validation never came back clean about the file it owns, so nothing was rolled back and no repair was charged. `failed`: the task ran out of repairs and its file was put back as it was.",
  ].join("\n");
}

function describeStatus(status: TaskStatus | undefined): string {
  return status === undefined || status === "pending" ? "unresolved" : status;
}

function statusCounts(state: AgentState): { done: number; failed: number; pending: number } {
  const counts = { done: 0, failed: 0, pending: 0 };
  for (const id of state.orderedTaskIds) {
    counts[state.status[id] ?? "pending"] += 1;
  }
  return counts;
}

function renderReview(review: ReviewReport | null): string {
  if (review === null) {
    return "No review was recorded. Either the run ended before the review, or the review itself failed — the log names which.";
  }
  if (review.gaps.length === 0) {
    return `${review.verdict}\n\nNo gaps.`;
  }
  return [
    review.verdict,
    "",
    ...review.gaps.map(
      (gap) =>
        `- **${gap.requirement}** → \`${gap.targetPath}\` (${gap.taskType})\n  ${gap.detail}`,
    ),
  ].join("\n");
}

/**
 * The last validation's findings, kept readable.
 *
 * A message arrives here carrying newlines — a test failure brings its
 * difference block and its code frame, which is what a repair is meant to read —
 * so it goes into a fenced block rather than being flattened onto one line. The
 * summary is the artifact a person reads; `errors.jsonl` is the one a program
 * reads.
 */
function renderErrors(errors: readonly BuildError[]): string {
  if (errors.length === 0) {
    return "None. The last validation of the run was clean.";
  }
  return errors
    .map((error) => {
      const at = error.line === undefined ? error.file : `${error.file}:${error.line}`;
      const head = `**\`${at}\`** — ${error.code} · ${error.source}`;
      const message = error.message.trimEnd();
      return message.includes("\n")
        ? `${head}\n\n\`\`\`text\n${message}\n\`\`\``
        : `${head}\n\n${message}`;
    })
    .join("\n\n");
}

/**
 * What each kind of token cost, priced per entry so that a run using two models
 * is priced with each one's own rates.
 */
function costByKind(entries: readonly UsageEntry[]): {
  input: number;
  cachedRead: number;
  cacheWrite: number;
  output: number;
} {
  const zero = { input: 0, cachedRead: 0, cacheWrite: 0, output: 0 };
  return entries.reduce(
    (total, entry) => ({
      input: total.input + costUsd(entry.model, { ...zero, input: entry.inputTokens }),
      cachedRead: total.cachedRead + costUsd(entry.model, { ...zero, cachedRead: entry.cachedReadTokens }),
      cacheWrite: total.cacheWrite + costUsd(entry.model, { ...zero, cacheWrite: entry.cacheWriteTokens }),
      output: total.output + costUsd(entry.model, { ...zero, output: entry.outputTokens }),
    }),
    zero,
  );
}

/** Ledger entries grouped by one of their fields, in first-seen order. */
function rollup(
  entries: readonly UsageEntry[],
  key: (entry: UsageEntry) => string,
): [string, UsageEntry[]][] {
  const groups = new Map<string, UsageEntry[]>();
  for (const entry of entries) {
    const group = groups.get(key(entry)) ?? [];
    group.push(entry);
    groups.set(key(entry), group);
  }
  return [...groups];
}

/** The columns every rollup table shares: calls, the four token counts, cost. */
function figures(entries: readonly UsageEntry[]): string[] {
  const totals = totalUsage(entries);
  return [
    String(entries.length),
    String(totals.inputTokens),
    String(totals.cachedReadTokens),
    String(totals.cacheWriteTokens),
    String(totals.outputTokens),
    money(totals.costUsd),
  ];
}

function money(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** A markdown table. An empty body still prints its header, which says so. */
function table(headers: string[], rows: string[][]): string {
  const separator = headers.map(() => "---");
  const body = rows.length === 0 ? [headers.map(() => "—")] : rows;
  return [headers, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function record(event: string, detail: string): LogEntry {
  return { node: "report", event, detail };
}
