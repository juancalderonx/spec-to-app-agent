import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BaseMessageLike } from "@langchain/core/messages";
import type {
  AgentState,
  LogEntry,
  SurfaceManifest,
  Task,
  UsageEntry,
} from "../graph/state.ts";
import type { ModelClient } from "../llm/factory.ts";
import { CODER_SYSTEM, coderCorrection, coderPrefix, coderRequest } from "../prompts/coder.ts";
import { loadPacks } from "../prompts/packs.ts";
import { FILE_SCHEMA, readContents } from "../schema/file.ts";
import { parseSurface } from "../surface/manifest.ts";
import { openSandbox, readFileIn, resolveInside, writeFileIn, type Sandbox } from "../tools/fs.ts";
import { SandboxError, openTrace, traced } from "../tools/trace.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * One answer, one correction — the same budget the planner gets, for the same
 * reason: a second paid call is worth it only when the first one told this code
 * something it can send back.
 */
const MAX_ATTEMPTS = 2;

/** Ahead of a retry that failed in transport, so a blip is not hit twice at once. */
const RETRY_DELAY_MS = 1_000;

export interface Snapshot {
  /** Absolute, as the sandbox resolved it. */
  path: string;
  /** The same file relative to the project root, which is how `surface` keys it. */
  targetPath: string;
  /** The file's text before this task touched it, or `null` if it did not exist. */
  contents: string | null;
}

/**
 * What each task overwrote, by run and then by task id, so a failed task can be
 * put back where it was.
 *
 * Keyed by run rather than kept in one flat map: a module-level map every caller
 * shares is the defect `agent/knowledge/rules.md` describes in the provided mock
 * store — the second caller in a process sees whatever the first one wrote. It
 * is out of the graph state on purpose too, since a file body in a channel is
 * precisely what §4 of the architecture keeps out of them.
 */
const snapshots = new Map<string, Map<string, Snapshot[]>>();

/** What this run overwrote, per task id. Empty for a run that wrote nothing. */
export function snapshotsFor(runId: string): ReadonlyMap<string, Snapshot[]> {
  return snapshots.get(runId) ?? new Map<string, Snapshot[]>();
}

function remember(runId: string, taskId: string, snapshot: Snapshot): void {
  const run = snapshots.get(runId) ?? new Map<string, Snapshot[]>();
  snapshots.set(runId, run);
  run.set(taskId, [...(run.get(taskId) ?? []), snapshot]);
}

/**
 * Writes the file for one task, and only that one.
 *
 * The prompt is a stable prefix — standing pack, output contract, specification,
 * the surface the project shipped — carrying the cache breakpoint, and then the
 * task: its conventions, its own text, and the signatures of its **direct
 * dependencies alone**. That is what keeps a late task's prompt the size of an
 * early one's instead of the size of everything built so far, and what lets the
 * prefix be paid for once per run rather than once per task; the ledger entry
 * this node appends is what lets both claims be checked rather than asserted.
 *
 * A written file is not a finished task: `status` stays `pending` until
 * `validate` has two green signals to say otherwise. Only a failure is recorded
 * here, and it does not stop the run — the cursor advances and the next task
 * gets its turn.
 */
export async function generate(
  state: AgentState,
  client: ModelClient,
): Promise<Partial<AgentState>> {
  const log: LogEntry[] = [];
  const usage: UsageEntry[] = [];

  const taskId = state.orderedTaskIds[state.cursor];
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    return {
      cursor: state.cursor + 1,
      log: [record("skipped", `the queue holds no task at position ${state.cursor}`)],
    };
  }

  const trace = openTrace(join(REPO_ROOT, "agent", "runs", state.runId, "tools.jsonl"));
  const sandbox = await openSandbox(state.outputDir, trace);

  try {
    // Resolved before the provider is called, not after. A target outside the
    // output directory is a refusal this code can reach on its own, and finding
    // it out after the answer arrived would have paid for the answer first.
    const absolute = await traced(
      trace,
      "resolvePath",
      { path: task.targetPath },
      () => resolveInside(sandbox, task.targetPath),
      (resolved) => resolved,
    );

    const packs = loadPacks(task.taskType);
    if (packs.fallback !== null) {
      log.push(record("pack-fallback", packs.fallback));
    }

    const messages: BaseMessageLike[] = [
      ["system", CODER_SYSTEM],
      client.cacheable(coderPrefix(state.spec, packs.standing, state.projectSurface)),
      ["human", coderRequest(task, dependencySignatures(state, task), packs.conventions)],
    ];

    const contents = await ask(client, messages, usage, log, task.id);

    await keepSnapshot(sandbox, state, task, absolute);
    // The absolute path is what the trace records, so a reader sees where the
    // write actually landed rather than the relative path the task asked for.
    await writeFileIn(sandbox, absolute, contents);

    const spent = (field: keyof UsageEntry & `${string}Tokens`): number =>
      usage.reduce((total, entry) => total + entry[field], 0);
    log.push(
      record(
        "wrote",
        `${task.id} → ${task.targetPath} · ${Buffer.byteLength(contents)} bytes · ` +
          `${spent("inputTokens")} uncached input, ${spent("cachedReadTokens")} cached read, ` +
          `${spent("cacheWriteTokens")} cache write · via ${client.modelId}`,
      ),
    );

    return {
      surface: { ...state.surface, [task.targetPath]: parseSurface(task.targetPath, contents) },
      cursor: state.cursor + 1,
      usage,
      log,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A sandbox refusal is never retried: the prompt that produced the path is
    // the one that would be sent again, so a second call buys the same refusal
    // at full price. The retry that does exist lives in `ask`, where the answer
    // itself is what came back wrong.
    const event = error instanceof SandboxError ? "rejected" : "failed";
    return failed(state, task, log, usage, event, message);
  }
}

/**
 * One answer, then one correction carrying what was wrong with it. A transport
 * failure spends the same attempt after a pause, since nothing about the request
 * needs changing for it.
 */
async function ask(
  client: ModelClient,
  messages: BaseMessageLike[],
  usage: UsageEntry[],
  log: LogEntry[],
  taskId: string,
): Promise<string> {
  let rejection = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let answer;
    try {
      answer = await client.invokeStructured("generate", messages, FILE_SCHEMA);
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw error;
      }
      log.push(
        record(
          "retrying",
          `attempt ${attempt} did not complete: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      await delay(RETRY_DELAY_MS);
      continue;
    }

    // Stamped here rather than in the ledger: only the node knows whose call
    // this was, and the summary reports input tokens per task.
    usage.push({ ...answer.usage, task: taskId });
    const contents = readContents(answer.value);
    if (contents.ok) {
      return contents.contents;
    }

    rejection = contents.error;
    log.push(record("rejected", `attempt ${attempt}: ${rejection}`));
    if (attempt < MAX_ATTEMPTS) {
      messages.push(["human", coderCorrection(rejection)]);
    }
  }

  throw new Error(`the answer was unusable after ${MAX_ATTEMPTS} attempts: ${rejection}`);
}

/**
 * The signatures of this task's direct dependencies, as they stand now.
 *
 * A project file appears here only when a task rewrote it: `dependsOn` holds
 * task ids, so a path reaches this map only by being some task's target. That
 * is why the project's own files are no longer filtered out — the copy in the
 * cached prefix is the version the project shipped, and this is the version on
 * disk. The prompt says which is which and which one wins.
 *
 * `dependsOn` carries two kinds of edge: the tasks whose exports this one
 * imports, and the handler task for an operation it issues at runtime, which
 * orders the two without an import between them. Both kinds are injected. The
 * plan does not label its edges, so telling them apart would take a
 * classification the planner does not emit today, and a wrong guess starves a
 * task of a signature it needed; the file the second kind points at exposes a
 * single array, so carrying it costs a handful of tokens.
 */
function dependencySignatures(state: AgentState, task: Task): SurfaceManifest {
  const targetPaths = new Map(state.tasks.map((candidate) => [candidate.id, candidate.targetPath]));
  const manifest: SurfaceManifest = {};
  for (const dependency of task.dependsOn) {
    const path = targetPaths.get(dependency);
    const entry = path === undefined ? undefined : state.surface[path];
    if (path !== undefined && entry !== undefined) {
      manifest[path] = entry;
    }
  }
  return manifest;
}

/**
 * Keeps what this task is about to overwrite.
 *
 * The surface manifest is what says whether the file already exists: it lists
 * every source file in the project, so probing the disk would add a trace line
 * per task to learn something the state already holds. Known ceiling: a task
 * targeting a file the manifest does not cover — anything that is not TypeScript
 * under `src/` — is snapshotted as new, and rolling it back removes it instead
 * of restoring it.
 */
async function keepSnapshot(
  sandbox: Sandbox,
  state: AgentState,
  task: Task,
  absolute: string,
): Promise<void> {
  const existed = state.surface[task.targetPath] !== undefined;
  remember(state.runId, task.id, {
    path: absolute,
    targetPath: task.targetPath,
    contents: existed ? await readFileIn(sandbox, absolute) : null,
  });
}

function failed(
  state: AgentState,
  task: Task,
  log: LogEntry[],
  usage: UsageEntry[],
  event: string,
  message: string,
): Partial<AgentState> {
  return {
    status: { ...state.status, [task.id]: "failed" },
    cursor: state.cursor + 1,
    usage,
    log: [...log, record(event, `${task.id}: ${message}`)],
    errors: [
      {
        file: task.targetPath,
        code: "generate-failed",
        message,
        source: "runner",
      },
    ],
  };
}

function record(event: string, detail: string): LogEntry {
  return { node: "generate", event, detail };
}
