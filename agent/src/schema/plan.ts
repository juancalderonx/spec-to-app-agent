import { TASK_TYPES, type Task, type TaskType } from "../graph/state.ts";

/**
 * The shape the provider is made to answer in, rather than asked for in prose.
 *
 * No `minItems`, no `pattern`, no other keyword the strict flavour of JSON
 * Schema output rejects: everything a provider might drop on the floor is
 * re-checked by `validatePlan`, which has to run anyway.
 */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      description: "Every task the specification needs, in no particular order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "description", "targetPath", "taskType", "dependsOn", "acceptance"],
        properties: {
          id: {
            type: "string",
            description: "Short stable slug, unique within the plan.",
          },
          description: {
            type: "string",
            description: "What this task builds, in one or two sentences.",
          },
          targetPath: {
            type: "string",
            description: "The file this task writes, relative to the project root.",
          },
          taskType: {
            type: "string",
            enum: [...TASK_TYPES],
            description: "The role the file plays, from the fixed set.",
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "Ids of the tasks whose exports this task imports.",
          },
          acceptance: {
            type: "array",
            items: { type: "string" },
            description: "Short checkable statements drawn from the specification.",
          },
        },
      },
    },
  },
};

export type PlanValidation =
  | { ok: true; tasks: Task[] }
  | { ok: false; errors: string[] };

/**
 * Checks an answer against everything the plan has to satisfy — including the
 * two rules no JSON Schema can state: every `dependsOn` names a task in the
 * same plan, and the edges are acyclic.
 *
 * The cycle check belongs here rather than in the sort that consumes the plan.
 * A cycle found here is one more sentence in a retry the caller was going to
 * spend anyway; the same cycle found downstream ends the run with an artifact
 * already on disk.
 *
 * Every failure comes back as a sentence, because the sentences are what gets
 * appended to the retry.
 */
export function validatePlan(value: unknown): PlanValidation {
  if (!isRecord(value) || !isUnknownArray(value["tasks"])) {
    return { ok: false, errors: ['The answer must be an object holding a "tasks" array.'] };
  }

  const errors: string[] = [];
  const tasks: Task[] = [];
  for (const [index, item] of value["tasks"].entries()) {
    const task = readTask(item, `tasks[${index}]`, errors);
    if (task !== null) {
      tasks.push(task);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (tasks.length === 0) {
    return { ok: false, errors: ["The plan holds no tasks. It must hold at least one."] };
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      errors.push(`Two tasks share the id "${task.id}". Ids must be unique.`);
    }
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        errors.push(
          `Task "${task.id}" depends on "${dependency}", which is not a task in this plan.`,
        );
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const cycle = findCycle(tasks);
  if (cycle !== null) {
    return {
      ok: false,
      errors: [
        `The dependencies close a cycle: ${cycle.join(" -> ")}. ` +
          `Break it so the edges point one way only.`,
      ],
    };
  }

  return { ok: true, tasks };
}

/**
 * The first cycle reachable from any task, as the path that closes it, or
 * `null`. Depth-first with a third mark for "on the current path": that mark is
 * what tells a cycle apart from a task legitimately reached twice.
 */
function findCycle(tasks: Task[]): string[] | null {
  const edges = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const marks = new Map<string, "open" | "closed">();
  const path: string[] = [];

  function walk(id: string): string[] | null {
    const mark = marks.get(id);
    if (mark === "closed") {
      return null;
    }
    if (mark === "open") {
      return [...path.slice(path.indexOf(id)), id];
    }

    marks.set(id, "open");
    path.push(id);
    for (const dependency of edges.get(id) ?? []) {
      const cycle = walk(dependency);
      if (cycle !== null) {
        return cycle;
      }
    }
    path.pop();
    marks.set(id, "closed");
    return null;
  }

  for (const task of tasks) {
    const cycle = walk(task.id);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

function readTask(value: unknown, where: string, errors: string[]): Task | null {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object.`);
    return null;
  }

  const id = readString(value, "id", where, errors);
  const description = readString(value, "description", where, errors);
  const targetPath = readString(value, "targetPath", where, errors);
  const taskType = readTaskType(value, where, errors);
  const dependsOn = readStringArray(value, "dependsOn", where, errors);
  const acceptance = readStringArray(value, "acceptance", where, errors);

  if (
    id === null ||
    description === null ||
    targetPath === null ||
    taskType === null ||
    dependsOn === null ||
    acceptance === null
  ) {
    return null;
  }
  return { id, description, targetPath, taskType, dependsOn, acceptance };
}

function readString(
  source: Record<string, unknown>,
  key: string,
  where: string,
  errors: string[],
): string | null {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${where}.${key} must be a non-empty string.`);
    return null;
  }
  return value;
}

function readStringArray(
  source: Record<string, unknown>,
  key: string,
  where: string,
  errors: string[],
): string[] | null {
  const value = source[key];
  if (!isUnknownArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${where}.${key} must be an array of strings.`);
    return null;
  }
  return value.filter((item) => typeof item === "string");
}

function readTaskType(
  source: Record<string, unknown>,
  where: string,
  errors: string[],
): TaskType | null {
  const value = source["taskType"];
  const match = TASK_TYPES.find((candidate) => candidate === value);
  if (match === undefined) {
    errors.push(
      `${where}.taskType must be one of: ${TASK_TYPES.join(", ")} — received ` +
        `${JSON.stringify(value)}.`,
    );
    return null;
  }
  return match;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Array.isArray` alone widens to `any[]`; this keeps the members unknown. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
