import { TASK_TYPES, type Gap, type ReviewReport } from "../graph/state.ts";

/**
 * The shape the provider is made to answer in, rather than asked for in prose.
 *
 * Each gap carries the file that closes it and the role that file plays, because
 * a gap becomes a task: a finding without those two is a sentence nothing can
 * act on. Same restraint as `PLAN_SCHEMA` — no keyword the strict flavour of
 * JSON Schema output rejects, since `readReview` re-checks everything anyway.
 */
export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "gaps"],
  properties: {
    verdict: {
      type: "string",
      description: "One sentence on whether the specification is covered.",
    },
    gaps: {
      type: "array",
      description: "One entry per requirement the surface does not represent. Empty when every requirement is covered.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "detail", "targetPath", "taskType"],
        properties: {
          requirement: {
            type: "string",
            description: "The requirement, in the specification's own terms.",
          },
          detail: {
            type: "string",
            description: "What is missing, and what the file must do to close it.",
          },
          targetPath: {
            type: "string",
            description:
              "The one file that closes this gap, relative to the project root. An existing path to rewrite, or a new one to add.",
          },
          taskType: {
            type: "string",
            enum: [...TASK_TYPES],
            description: "The role that file plays, from the fixed set.",
          },
        },
      },
    },
  },
};

export type ReviewAnswer =
  | { ok: true; report: ReviewReport }
  | { ok: false; error: string };

/**
 * Checks a review before any of it becomes work.
 *
 * The schema guarantees the fields are present; what it cannot state is that
 * they are filled in. An empty `targetPath` would produce a task that writes
 * nothing, and an empty gap list is a valid answer — the one a covered build
 * deserves — so the two have to be told apart rather than both waved through.
 *
 * Unlike the planner's, this failure buys no retry: a review is advisory, and
 * `review` records the rejection and lets the run report. The sentence is for
 * the log, not for a correction.
 */
export function readReview(value: unknown): ReviewAnswer {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "the answer was not an object." };
  }
  const source: Record<string, unknown> = { ...value };

  const verdict = source["verdict"];
  if (typeof verdict !== "string" || verdict.trim() === "") {
    return { ok: false, error: '"verdict" must be a non-empty sentence.' };
  }
  if (!Array.isArray(source["gaps"])) {
    return { ok: false, error: '"gaps" must be an array, empty when nothing is missing.' };
  }

  const gaps: Gap[] = [];
  for (const [index, item] of source["gaps"].entries()) {
    const gap = readGap(item);
    if (!gap.ok) {
      return { ok: false, error: `gaps[${index}]: ${gap.error}` };
    }
    gaps.push(gap.gap);
  }
  return { ok: true, report: { gaps, verdict } };
}

type GapAnswer = { ok: true; gap: Gap } | { ok: false; error: string };

function readGap(value: unknown): GapAnswer {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "must be an object." };
  }
  const source: Record<string, unknown> = { ...value };

  const requirement = text(source["requirement"]);
  const detail = text(source["detail"]);
  const targetPath = text(source["targetPath"]);
  if (requirement === null || detail === null || targetPath === null) {
    return {
      ok: false,
      error: "requirement, detail and targetPath must all be non-empty strings.",
    };
  }

  const taskType = TASK_TYPES.find((candidate) => candidate === source["taskType"]);
  if (taskType === undefined) {
    return {
      ok: false,
      error: `taskType must be one of: ${TASK_TYPES.join(", ")} — received ${JSON.stringify(source["taskType"])}.`,
    };
  }
  return { ok: true, gap: { requirement, detail, targetPath, taskType } };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
