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
  line: number;
  code: string;
  message: string;
  source: "tsc" | "vitest" | "runner";
}

export interface Gap {
  requirement: string;
  detail: string;
}

export interface ReviewReport {
  gaps: Gap[];
  verdict: string;
}

export type ModelRole = "planner" | "coder" | "reviewer";

export interface UsageEntry {
  node: string;
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
