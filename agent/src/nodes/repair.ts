import { join, resolve } from "node:path";
import type { BaseMessageLike } from "@langchain/core/messages";
import { MAX_REPAIRS_PER_TASK, taskInFlight } from "../graph/routers.ts";
import type { AgentState, LogEntry, UsageEntry } from "../graph/state.ts";
import type { ModelClient } from "../llm/factory.ts";
import { CODER_SYSTEM, coderCorrection, coderPrefix, repairRequest } from "../prompts/coder.ts";
import { loadPacks } from "../prompts/packs.ts";
import { digestAnswer, FILE_SCHEMA, readContents } from "../schema/file.ts";
import { parseSurface } from "../surface/manifest.ts";
import { openSandbox, readFileIn, writeFileIn, type Sandbox } from "../tools/fs.ts";
import { openTrace } from "../tools/trace.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Rounds spent getting an answer in the right *shape* out of one visit. The same
 * budget `generate` gets, for the same reason: the second call carries something
 * the first one taught this code, so it is not the first call repeated.
 *
 * This is not the repair budget. That one counts corrections that were tried and
 * did not work, and it belongs to `routeAfterValidate`.
 */
const MAX_SCHEMA_ROUNDS = 2;

/**
 * Rewrites the one file the validators rejected, from their parsed findings and
 * its current body.
 *
 * This is the only node that reads a file this run wrote. Everywhere else a file
 * travels as its signature — see §4 of the architecture — and the exception is
 * declared rather than incidental: a correction needs the line it is correcting.
 * It stays an exception by being scoped to a single file, the one this task owns.
 *
 * **One retry, and only over the answer's shape.** The repair *is* the retry of
 * the correction, and how many a task gets is `routeAfterValidate`'s to decide;
 * a loop over corrections here would be a second ceiling nobody reads. An answer
 * this code cannot even read is a different failure, and it used to spend a
 * whole attempt without a single correction ever being sent — five of nine
 * repairs in the run this node was written against died that way. So the shape
 * is retried once inside the visit, with the rejection sent back.
 *
 * The attempt is charged whatever the outcome. It has to be: a provider that
 * never answers in shape would otherwise keep the task below the ceiling
 * forever, and the ceiling exists to stop exactly that.
 *
 * It does not snapshot. The snapshot `generate` kept is the state before the
 * task began, which is what a rollback wants — not the state before the repair,
 * which is the broken file.
 *
 * **A file that is not there is not a repair.** A correction needs the lines it
 * is correcting, so an absent target ends the visit before the provider is
 * reached, and spends the task's whole repair budget at once: the second attempt
 * would read the same absent file and learn the same thing, one full validation
 * later. The accepted cost is that those unspent attempts still count towards
 * `MAX_REPAIRS_PER_RUN`, which sums `attempts` — so a missing file charges the
 * run ceiling for two provider calls nobody made. Taken deliberately: separating
 * "attempts spent" from "calls made" is a second bookkeeping channel for a case
 * that is rare now that a task `generate` failed no longer reaches this node.
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
    const body = await bodyOf(sandbox, task.targetPath);
    if (body === null) {
      return {
        attempts: { ...state.attempts, [task.id]: MAX_REPAIRS_PER_TASK },
        log: [
          record(
            "missing",
            `${task.id}: ${task.targetPath} is not on disk, so there is nothing to correct · ` +
              `its ${MAX_REPAIRS_PER_TASK} repairs are spent here rather than one absent file at a time`,
          ),
        ],
      };
    }

    const packs = loadPacks(task.taskType);
    const messages: BaseMessageLike[] = [
      ["system", CODER_SYSTEM],
      // Byte-identical to the prefix `generate` sent, so a repair reads the
      // cache rather than writing a second copy of it.
      client.cacheable(coderPrefix(state.spec, packs.standing, state.projectSurface)),
      ["human", repairRequest(task, body, state.errors)],
    ];

    let corrected: string | undefined;
    for (let round = 1; round <= MAX_SCHEMA_ROUNDS && corrected === undefined; round += 1) {
      const answer = await client.invokeStructured("repair", messages, FILE_SCHEMA);
      // Charged to the task, like the `generate` call it is correcting, so the
      // summary's per-task figure covers what the task really cost.
      usage.push({ ...answer.usage, task: task.id });

      const contents = readContents(answer.value);
      if (contents.ok) {
        corrected = contents.contents;
        break;
      }

      log.push(
        record(
          "unusable",
          `${task.id} attempt ${attempt} round ${round} of ${MAX_SCHEMA_ROUNDS}: ` +
            `${contents.error} · answer was ${digestAnswer(answer.value)}`,
        ),
      );
      if (round < MAX_SCHEMA_ROUNDS) {
        messages.push(["human", coderCorrection(contents.error)]);
      }
    }

    if (corrected === undefined) {
      // Charged, and nothing written: the file on disk is still the one the
      // validators rejected, which is what the next visit will read.
      return { attempts, usage, log };
    }

    await writeFileIn(sandbox, task.targetPath, corrected);
    log.push(
      record(
        "rewrote",
        `${task.id} → ${task.targetPath} · attempt ${attempt} · ` +
          `${state.errors.length} errors sent · ${Buffer.byteLength(corrected)} bytes · ` +
          `via ${client.modelId}`,
      ),
    );

    return {
      surface: { ...state.surface, [task.targetPath]: parseSurface(task.targetPath, corrected) },
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

/**
 * The file's current text, or `null` when it is not there.
 *
 * Only absence is answered with `null`. A read that fails for any other reason —
 * a directory in the way, a permission — is a broken workspace and travels up as
 * itself, rather than being reported as a task whose file was never written.
 */
async function bodyOf(sandbox: Sandbox, path: string): Promise<string | null> {
  try {
    return await readFileIn(sandbox, path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function record(event: string, detail: string): LogEntry {
  return { node: "repair", event, detail };
}
