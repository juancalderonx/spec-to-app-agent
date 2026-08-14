import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { AgentState, LogEntry, Task, UsageEntry } from "../graph/state.ts";
import type { ModelClient } from "../llm/factory.ts";
import { PLANNER_SYSTEM, plannerCorrection, plannerRequest } from "../prompts/planner.ts";
import { PLAN_SCHEMA, validatePlan } from "../schema/plan.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/**
 * One answer, one correction. A planner that cannot satisfy the rules with the
 * failures spelled out for it will not satisfy them on a third paid attempt.
 */
const MAX_ATTEMPTS = 2;

/**
 * Turns the specification into a validated task graph.
 *
 * The call carries the schema, so the answer's shape is enforced by the
 * provider; `validatePlan` then checks what a schema cannot state, and its
 * complaints are what the retry sends back. The plan is written to
 * `agent/runs/<runId>/plan.json` as soon as it is valid, so the decomposition
 * can be read without running the agent again.
 *
 * A planner that fails twice is recorded rather than thrown, like `prepare`:
 * the graph continues to `report`, which turns the record into an artifact and
 * a non-zero exit code.
 */
export async function plan(
  state: AgentState,
  client: ModelClient,
): Promise<Partial<AgentState>> {
  const log: LogEntry[] = [];
  const usage: UsageEntry[] = [];
  const messages: BaseMessageLike[] = [
    ["system", PLANNER_SYSTEM],
    ["human", plannerRequest(state.spec, state.surface)],
  ];

  try {
    let rejections: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const answer = await client.invokeStructured("plan", messages, PLAN_SCHEMA);
      usage.push(answer.usage);

      const validation = validatePlan(answer.value);
      if (validation.ok) {
        await writePlan(state.runId, validation.tasks);
        log.push(
          record(
            "planned",
            `${validation.tasks.length} tasks on attempt ${attempt} of ${MAX_ATTEMPTS} ` +
              `via ${client.modelId}`,
          ),
        );
        return { tasks: validation.tasks, usage, log };
      }

      rejections = validation.errors;
      log.push(record("rejected", `attempt ${attempt}: ${rejections.join(" ")}`));
      if (attempt < MAX_ATTEMPTS) {
        messages.push(["human", plannerCorrection(rejections)]);
      }
    }

    return failed(
      state,
      log,
      usage,
      `the plan was still invalid after ${MAX_ATTEMPTS} attempts: ${rejections.join(" ")}`,
    );
  } catch (error) {
    return failed(state, log, usage, error instanceof Error ? error.message : String(error));
  }
}

async function writePlan(runId: string, tasks: Task[]): Promise<void> {
  const artifact = join(REPO_ROOT, "agent", "runs", runId, "plan.json");
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
}

function failed(
  state: AgentState,
  log: LogEntry[],
  usage: UsageEntry[],
  message: string,
): Partial<AgentState> {
  return {
    usage,
    log: [...log, record("failed", message)],
    errors: [
      {
        file: state.outputDir,
        code: "plan-failed",
        message,
        source: "runner",
      },
    ],
  };
}

function record(event: string, detail: string): LogEntry {
  return { node: "plan", event, detail };
}
