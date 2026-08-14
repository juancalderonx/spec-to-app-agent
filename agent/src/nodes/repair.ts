import { join, resolve } from "node:path";
import type { BaseMessageLike } from "@langchain/core/messages";
import { taskInFlight } from "../graph/routers.ts";
import type { AgentState, LogEntry, UsageEntry } from "../graph/state.ts";
import type { ModelClient } from "../llm/factory.ts";
import { CODER_SYSTEM, coderPrefix, repairRequest } from "../prompts/coder.ts";
import { loadPacks } from "../prompts/packs.ts";
import { FILE_SCHEMA, readContents } from "../schema/file.ts";
import { parseSurface } from "../surface/manifest.ts";
import { openSandbox, readFileIn, writeFileIn } from "../tools/fs.ts";
import { openTrace } from "../tools/trace.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Rewrites the one file the validators rejected, from their parsed findings and
 * its current body.
 *
 * This is the only node that reads a file this run wrote. Everywhere else a file
 * travels as its signature — see §4 of the architecture — and the exception is
 * declared rather than incidental: a correction needs the line it is correcting.
 * It stays an exception by being scoped to a single file, the one this task owns.
 *
 * **No retry of its own.** The repair *is* the retry, and how many a task gets is
 * `routeAfterValidate`'s to decide; a loop here would be a second ceiling nobody
 * reads. The attempt is charged whatever the outcome, so a repair that keeps
 * failing still walks the task towards the ceiling instead of circling below it.
 *
 * It does not snapshot. The snapshot `generate` kept is the state before the
 * task began, which is what a rollback wants — not the state before the repair,
 * which is the broken file.
 */
export async function repair(
  state: AgentState,
  client: ModelClient,
): Promise<Partial<AgentState>> {
  const log: LogEntry[] = [];
  const usage: UsageEntry[] = [];

  const task = taskInFlight(state);
  if (task === undefined) {
    // Unreachable through `routeAfterValidate`, which refuses to repair what it
    // cannot name. Kept because the guarantee belongs to this function.
    return { log: [record("skipped", `no task in flight at queue position ${state.cursor - 1}`)] };
  }

  const attempt = (state.attempts[task.id] ?? 0) + 1;
  const attempts = { ...state.attempts, [task.id]: attempt };

  const trace = openTrace(join(REPO_ROOT, "agent", "runs", state.runId, "tools.jsonl"));

  try {
    const sandbox = await openSandbox(state.outputDir, trace);
    const body = await readFileIn(sandbox, task.targetPath);

    const packs = loadPacks(task.taskType);
    const messages: BaseMessageLike[] = [
      ["system", CODER_SYSTEM],
      // Byte-identical to the prefix `generate` sent, so a repair reads the
      // cache rather than writing a second copy of it.
      client.cacheable(coderPrefix(state.spec, packs.standing, state.projectSurface)),
      ["human", repairRequest(task, body, state.errors)],
    ];

    const answer = await client.invokeStructured("repair", messages, FILE_SCHEMA);
    usage.push(answer.usage);

    const contents = readContents(answer.value);
    if (!contents.ok) {
      return {
        attempts,
        usage,
        log: [...log, record("unusable", `${task.id} attempt ${attempt}: ${contents.error}`)],
      };
    }

    await writeFileIn(sandbox, task.targetPath, contents.contents);
    log.push(
      record(
        "rewrote",
        `${task.id} → ${task.targetPath} · attempt ${attempt} · ` +
          `${state.errors.length} errors sent · ${Buffer.byteLength(contents.contents)} bytes · ` +
          `via ${client.modelId}`,
      ),
    );

    return {
      surface: { ...state.surface, [task.targetPath]: parseSurface(task.targetPath, contents.contents) },
      attempts,
      usage,
      log,
    };
  } catch (error) {
    // The attempt is spent either way, so the ceiling still closes on a task
    // whose repair cannot even be issued. The run does not stop here: `validate`
    // runs again and, once the budget is gone, rolls the task back.
    const message = error instanceof Error ? error.message : String(error);
    return {
      attempts,
      usage,
      log: [...log, record("failed", `${task.id} attempt ${attempt}: ${message}`)],
    };
  }
}

function record(event: string, detail: string): LogEntry {
  return { node: "repair", event, detail };
}
