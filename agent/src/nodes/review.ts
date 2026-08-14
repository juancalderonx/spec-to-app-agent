import type { BaseMessageLike } from "@langchain/core/messages";
import { remediable } from "../graph/routers.ts";
import type { AgentState, Gap, LogEntry, Task, TaskStatus } from "../graph/state.ts";
import type { ModelClient } from "../llm/factory.ts";
import {
  REVIEWER_SYSTEM,
  reviewerRequest,
  type UnfinishedTask,
} from "../prompts/reviewer.ts";
import { digestAnswer } from "../schema/file.ts";
import { REVIEW_SCHEMA, readReview } from "../schema/review.ts";

/**
 * Gaps one review turns into work. A review that lists more than a handful is
 * describing a run that did not build the application, not one with six small
 * holes, and queueing all of them spends a second full generation pass to arrive
 * at the same verdict. The ones beyond the cut are still in `reviewReport` and
 * still in the summary; what they do not get is a paid task each.
 */
export const MAX_REMEDIATION_TASKS = 5;

/**
 * Checks what was built against the specification, using a different provider
 * from the one that wrote it.
 *
 * It reads signatures, never bodies: the question is whether every stated
 * requirement is represented, which a surface can answer, and not whether the
 * code is good, which it cannot. That is also what keeps the call cheap enough
 * to be worth giving to a second provider at all.
 *
 * Gaps become tasks and go back through the queue once — see `remediable`, which
 * this node and `routeAfterReview` both ask so that queued work and the route
 * that builds it cannot disagree.
 *
 * **A review that fails does not sink the run.** It writes a null report, spends
 * its round, and adds no errors: nothing here judges the workspace, so a
 * provider outage at the last node must not turn a green run red. The exit code
 * stays with `runVerdict`, which reads `status`.
 */
export async function review(
  state: AgentState,
  client: ModelClient,
): Promise<Partial<AgentState>> {
  const reviewRounds = state.reviewRounds + 1;
  const messages: BaseMessageLike[] = [
    ["system", REVIEWER_SYSTEM],
    ["human", reviewerRequest(state.spec, state.surface, unfinished(state))],
  ];

  let answer;
  try {
    answer = await client.invokeStructured("review", messages, REVIEW_SCHEMA);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reviewReport: null,
      reviewRounds,
      log: [record("failed", `the review did not complete: ${message}`)],
    };
  }

  const usage = [answer.usage];
  const parsed = readReview(answer.value);
  if (!parsed.ok) {
    return {
      reviewReport: null,
      reviewRounds,
      usage,
      log: [
        record("unusable", `${parsed.error} · answer was ${digestAnswer(answer.value)}`),
      ],
    };
  }

  const { report } = parsed;
  const reviewed = record(
    "reviewed",
    `${report.gaps.length} gaps · round ${reviewRounds} · via ${client.modelId} · ${report.verdict}`,
  );
  if (!remediable(report.gaps.length, reviewRounds)) {
    return { reviewReport: report, reviewRounds, usage, log: [reviewed] };
  }

  const queued = report.gaps.slice(0, MAX_REMEDIATION_TASKS);
  const tasks = queued.map((gap, index) => remediationTask(state, gap, reviewRounds, index));
  const log = [reviewed];
  if (queued.length < report.gaps.length) {
    log.push(
      record(
        "capped",
        `${report.gaps.length} gaps, ${queued.length} queued · the rest are in the summary, unbuilt`,
      ),
    );
  }
  log.push(
    record(
      "remediating",
      tasks.map((task) => `${task.id} → ${task.targetPath}`).join(" · "),
    ),
  );

  return {
    reviewReport: report,
    reviewRounds,
    tasks: [...state.tasks, ...tasks],
    orderedTaskIds: [...state.orderedTaskIds, ...tasks.map((task) => task.id)],
    status: { ...state.status, ...pending(tasks) },
    usage,
    log,
  };
}

/**
 * One gap as one task, for the same queue the plan's tasks went through.
 *
 * **`dependsOn` names every task that finished**, which is wider than a planned
 * task's edges and is the point. `generate` injects the signatures of a task's
 * direct dependencies and nothing else, so a remediation task with no edges
 * would be handed the boilerplate's surface alone and would know nothing about
 * the files this run produced — it would invent names for them, which is the
 * defect the coder's project-surface block was added to fix. The reviewer names
 * a file, not the edges into it, and it has no reliable way to: the gap it is
 * closing is by definition the part nobody planned.
 *
 * The cost is a wider prompt for at most `MAX_REMEDIATION_TASKS` tasks at the
 * very end of a run — signatures only, bounded by the run's own task count. §4's
 * flatness claim is about a queue that grows task by task, and this is the last
 * thing the queue does.
 */
function remediationTask(state: AgentState, gap: Gap, round: number, index: number): Task {
  return {
    id: `remediation-${round}-${index + 1}`,
    description: `${gap.detail}\n\nIt exists because the review found this requirement unmet: ${gap.requirement}`,
    targetPath: gap.targetPath,
    taskType: gap.taskType,
    dependsOn: state.tasks
      .filter((task) => state.status[task.id] === "done")
      .map((task) => task.id),
    acceptance: [gap.requirement],
  };
}

/**
 * The tasks that ended anywhere other than done, each with how it ended.
 *
 * The reviewer needs them because a rolled-back task leaves the file exporting
 * whatever it exported before the run, which from the surface alone is
 * indistinguishable from a requirement met.
 */
function unfinished(state: AgentState): UnfinishedTask[] {
  return state.tasks
    .map((task) => ({ task, status: state.status[task.id] ?? ("pending" as TaskStatus) }))
    .filter((entry) => entry.status !== "done");
}

/** `order` writes a status per task it sorted; these arrive after it has run. */
function pending(tasks: readonly Task[]): Record<string, TaskStatus> {
  return Object.fromEntries(tasks.map((task) => [task.id, "pending" as TaskStatus]));
}

function record(event: string, detail: string): LogEntry {
  return { node: "review", event, detail };
}
