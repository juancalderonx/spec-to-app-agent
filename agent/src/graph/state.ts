import { Annotation } from "@langchain/langgraph";

/**
 * Fixed, domain-neutral vocabulary. Selects which knowledge packs a task loads.
 *
 * The array is the declaration and the type is derived from it, so the members
 * a schema offers a provider and the members the type admits cannot drift.
 */
export const TASK_TYPES = [
  "component",
  "hook",
  "test",
  "data-layer",
  "styling",
  "wiring",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type TaskStatus = "pending" | "done" | "failed";

export interface Task {
  id: string;
  description: string;
  targetPath: string;
  taskType: TaskType;
  dependsOn: string[];
  acceptance: string[];
}

/** One exported name and its signature. Never a file body. */
export interface SurfaceExport {
  /** The name an importer writes. `"default"` for a default export. */
  name: string;
  signature: string;
}

/** What a file exposes. */
export interface SurfaceEntry {
  exports: SurfaceExport[];
}

export type SurfaceManifest = Record<string, SurfaceEntry>;

export interface BuildError {
  file: string;
  /**
   * Absent when the output names no line inside the project — a test whose
   * whole stack is its dependencies', a command that failed before it ran. A
   * placeholder line would point a repair at the top of a file it did not
   * come from.
   */
  line?: number;
  code: string;
  message: string;
  source: "tsc" | "vitest" | "runner";
}

/**
 * One requirement the review believes the built surface does not represent.
 *
 * It carries a target and a type as well as the finding, because a gap that
 * only says what is missing cannot become work: `review` turns each one into a
 * remediation task, and a task without a file to write and a type to load its
 * packs from is not a task.
 */
export interface Gap {
  requirement: string;
  detail: string;
  /** The one file that closes it, relative to the project root. */
  targetPath: string;
  /** From the fixed set, for the same reason a plan's tasks carry one. */
  taskType: TaskType;
}

export interface ReviewReport {
  gaps: Gap[];
  verdict: string;
}

export type ModelRole = "planner" | "coder" | "reviewer";

export interface UsageEntry {
  node: string;
  /**
   * The task this call was spent on, where one owns it. Absent for `plan` and
   * `review`, which are spent on the run rather than on a task.
   *
   * Stamped by the node rather than derived downstream, because the order of the
   * ledger cannot be read back into tasks: a schema retry inside one visit
   * appends a second entry under the same node, and from the outside that is
   * indistinguishable from the next task's first call. It is what lets the
   * summary publish input tokens per task in execution order, which is the
   * measurement §4 of the architecture rests its context claim on.
   */
  task?: string;
  role: ModelRole;
  model: string;
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LogEntry {
  node: string;
  event: string;
  detail: string;
}

/**
 * What the provided project exposed when `prepare` read it, before anything was
 * generated. Written once and never again.
 *
 * It is a separate field rather than a view over `surface` because the two
 * answer different questions: `surface` says what a file exports *now*, and this
 * says what the project shipped. Holding the signatures rather than only the
 * paths is what keeps the answer stable — a field of paths would force the
 * reader back into `surface`, which changes after every task.
 *
 * That immutability is what makes it cacheable. It sits in the coder's stable
 * prefix, so a task that rewrites one of these files must not change it: the
 * rewritten version travels beside the task instead, as the product of the task
 * that wrote it.
 */
type ProjectSurface = SurfaceManifest;

/** A field that keeps the last value a node returned, with a starting value. */
function overwrite<T>(initial: () => T) {
  return Annotation<T>({ reducer: (_previous, next) => next, default: initial });
}

/** A field that keeps every value a node returned, in order. */
function accumulate<T>() {
  return Annotation<T[]>({
    reducer: (previous, next) => previous.concat(next),
    default: () => [],
  });
}

/**
 * The one object every node reads and writes. Only `usage` and `log`
 * accumulate; a state where every field grows costs more than the work it
 * describes.
 *
 * **A node is an action and a field is a datum: nodes are verbs, state is
 * nouns.** `prepare`, `plan`, `generate` and `validate` do something;
 * `tasks`, `orderedTaskIds` and `reviewReport` are things they produce. Three
 * fields used to carry their producer's name instead of their own, which the
 * graph library rejected outright — a node and a channel cannot share a name.
 * The clash was a naming mistake of ours; the library only pointed at it.
 */
export const AgentStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  spec: Annotation<string>,
  outputDir: Annotation<string>,
  surface: overwrite<SurfaceManifest>(() => ({})),
  projectSurface: overwrite<ProjectSurface>(() => ({})),
  tasks: overwrite<Task[]>(() => []),
  orderedTaskIds: overwrite<string[]>(() => []),
  cursor: overwrite<number>(() => 0),
  attempts: overwrite<Record<string, number>>(() => ({})),
  status: overwrite<Record<string, TaskStatus>>(() => ({})),
  errors: overwrite<BuildError[]>(() => []),
  reviewReport: overwrite<ReviewReport | null>(() => null),
  reviewRounds: overwrite<number>(() => 0),
  usage: accumulate<UsageEntry>(),
  log: accumulate<LogEntry>(),
});

export type AgentState = typeof AgentStateAnnotation.State;
