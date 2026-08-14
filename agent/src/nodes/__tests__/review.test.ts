import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { BaseMessageLike } from "@langchain/core/messages";
import { MAX_REVIEW_ROUNDS, routeAfterReview } from "../../graph/routers.ts";
import type { AgentState, Task, UsageEntry } from "../../graph/state.ts";
import { runVerdict } from "../../graph/verdict.ts";
import type { ModelClient } from "../../llm/factory.ts";
import { generate } from "../generate.ts";
import { MAX_REMEDIATION_TASKS, review } from "../review.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** No provider is reached: every answer below is fixed in the test. */
function stub(answers: readonly unknown[]): { client: ModelClient; seen: BaseMessageLike[][] } {
  const seen: BaseMessageLike[][] = [];
  const client: ModelClient = {
    modelId: "stub-reviewer",
    cacheable: (text) => ["human", text],
    invoke: () => Promise.reject(new Error("review does not use the unstructured call")),
    invokeStructured: (node, messages) => {
      seen.push([...messages]);
      const answer = answers[seen.length - 1];
      if (answer === undefined) {
        return Promise.reject(new Error(`the stub has no answer ${seen.length}`));
      }
      return Promise.resolve({ value: answer, usage: usage(node) });
    },
  };
  return { client, seen };
}

function usage(node: string): UsageEntry {
  return {
    node,
    role: "reviewer",
    model: "stub-reviewer",
    inputTokens: 1_200,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 40,
    costUsd: 0,
  };
}

const BUILT: Task = {
  id: "collection-hook",
  description: "Loads the collection and exposes its loading and failure states.",
  targetPath: "src/hooks/useCollection.ts",
  taskType: "hook",
  dependsOn: [],
  acceptance: ["Exposes the collection, a loading flag and a failure."],
};

/** The signature the run produced. A remediation task that never sees it invents one. */
const SIGNATURE = "function useCollection(): { items: Item[]; loading: boolean }";

const GAP = {
  requirement: "The collection is filterable from the page itself.",
  detail: "Nothing exports a filter over the collection.",
  targetPath: "src/components/Filter.tsx",
  taskType: "component",
};

/** A run whose queue is exhausted and whose one task came out green. */
function stateFor(overrides: Partial<AgentState> = {}): AgentState {
  return {
    runId: "test-review",
    spec: "One screen listing the collection, with a filter over it.",
    outputDir: "/nowhere",
    surface: {
      "src/hooks/useCollection.ts": { exports: [{ name: "useCollection", signature: SIGNATURE }] },
    },
    projectSurface: {},
    tasks: [BUILT],
    orderedTaskIds: [BUILT.id],
    cursor: 1,
    attempts: {},
    status: { [BUILT.id]: "done" },
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
    ...overrides,
  };
}

function merge(state: AgentState, result: Partial<AgentState>): AgentState {
  return { ...state, ...result };
}

test("records the verdict and spends a round when nothing is missing", async () => {
  const { client, seen } = stub([{ verdict: "Every requirement is covered.", gaps: [] }]);

  const result = await review(stateFor(), client);

  assert.deepEqual(result.reviewReport, { gaps: [], verdict: "Every requirement is covered." });
  assert.equal(result.reviewRounds, 1);
  assert.equal(result.tasks, undefined);
  assert.equal(result.usage?.length, 1);
  assert.equal(routeAfterReview(merge(stateFor(), result)), "report");
  assert.equal(seen.length, 1);
});

test("is handed signatures and never a file body", async () => {
  const { client, seen } = stub([{ verdict: "Covered.", gaps: [] }]);
  const body = "export function useCollection() { return { items: [], loading: false }; }";

  await review(stateFor({ spec: "One screen listing the collection." }), client);
  const request = String(JSON.stringify(seen[0]?.at(-1)));

  assert.match(request, /useCollection/);
  assert.match(request, /items: Item\[\]/);
  // The node reads the manifest and nothing else, so a body cannot reach the
  // prompt unless someone changes what it reads.
  assert.equal(request.includes(body), false);
  assert.equal(request.includes("return {"), false);
});

test("turns a gap into a task carrying what this run already built", async () => {
  const runId = "test-review-remediation";
  const outputDir = await mkdtemp(join(tmpdir(), "review-"));
  after(async () => {
    await rm(outputDir, { recursive: true, force: true });
    await rm(join(REPO_ROOT, "agent", "runs", runId), { recursive: true, force: true });
  });

  const reviewer = stub([{ verdict: "One requirement is unmet.", gaps: [GAP] }]);
  const state = stateFor({ runId, outputDir });
  const reviewed = merge(state, await review(state, reviewer.client));

  const queued = reviewed.tasks.at(-1);
  assert.equal(queued?.id, "remediation-1-1");
  assert.equal(queued?.targetPath, "src/components/Filter.tsx");
  assert.equal(queued?.taskType, "component");
  assert.deepEqual(reviewed.orderedTaskIds, [BUILT.id, "remediation-1-1"]);
  assert.equal(reviewed.status["remediation-1-1"], "pending");
  assert.equal(routeAfterReview(reviewed), "generate");

  // The point of the edge: the remediation task reaches `generate` knowing what
  // this run produced, not only what the boilerplate ships. With no dependsOn it
  // would be handed the project surface alone and would invent the name.
  assert.deepEqual(queued?.dependsOn, [BUILT.id]);
  const coder = stub([{ contents: "export default function Filter() {\n  return null;\n}\n" }]);
  await generate(reviewed, coder.client);
  const prompt = String(JSON.stringify(coder.seen[0]?.at(-1)));

  assert.match(prompt, /useCollection/);
  assert.match(prompt, /items: Item\[\]/);
  assert.match(prompt, /src\/hooks\/useCollection\.ts/);
});

/**
 * Round 2 of the first full run reported as uncovered the two files its own
 * round-1 remediations had just written, because the unfinished list still
 * carried the tasks those remediations replaced — and a reviewer told a file is
 * not what it was asked for believes it over the surface.
 */
test("stops calling a file unfinished once a later task wrote it clean", async () => {
  const abandoned: Task = {
    id: "collection-filter",
    description: "Exposes a filter over the collection.",
    targetPath: GAP.targetPath,
    taskType: "component",
    dependsOn: [],
    acceptance: [GAP.requirement],
  };
  const closed: Task = { ...abandoned, id: "remediation-1-1" };
  const { client, seen } = stub([{ verdict: "Every requirement is covered.", gaps: [] }]);

  await review(
    stateFor({
      tasks: [BUILT, abandoned, closed],
      orderedTaskIds: [BUILT.id, abandoned.id, closed.id],
      cursor: 3,
      status: { [BUILT.id]: "done", "collection-filter": "failed", "remediation-1-1": "done" },
      reviewRounds: 1,
    }),
    client,
  );
  const request = String(JSON.stringify(seen[0]?.at(-1)));

  assert.equal(request.includes("given up on"), false);
  assert.match(request, /No file is still as a task that did not finish left it/);
});

test("queues nothing once the review rounds are spent", async () => {
  const { client } = stub([{ verdict: "Still unmet.", gaps: [GAP] }]);
  const state = stateFor({ reviewRounds: MAX_REVIEW_ROUNDS - 1 });

  const result = await review(state, client);

  assert.equal(result.reviewRounds, MAX_REVIEW_ROUNDS);
  assert.equal(result.tasks, undefined);
  assert.equal(result.orderedTaskIds, undefined);
  assert.equal(routeAfterReview(merge(state, result)), "report");
});

test("queues at most the ceiling, and says what it left out", async () => {
  const gaps = Array.from({ length: MAX_REMEDIATION_TASKS + 2 }, (_unused, index) => ({
    ...GAP,
    targetPath: `src/components/Filter${index}.tsx`,
  }));
  const { client } = stub([{ verdict: "Much is unmet.", gaps }]);

  const result = await review(stateFor(), client);

  assert.equal(result.tasks?.length, 1 + MAX_REMEDIATION_TASKS);
  assert.equal(result.reviewReport?.gaps.length, gaps.length);
  // Cut, and the cut is written down: the gaps beyond it are still in the report
  // and in the summary, unbuilt.
  assert.equal(result.log?.some((entry) => entry.event === "capped"), true);
});

test("a review that fails leaves the run's verdict where it was", async () => {
  const client: ModelClient = {
    modelId: "stub-reviewer",
    cacheable: (text) => ["human", text],
    invoke: () => Promise.reject(new Error("unused")),
    invokeStructured: () => Promise.reject(new Error("503 the provider is unavailable")),
  };
  const state = stateFor();

  const result = await review(state, client);
  const settled = merge(state, result);

  assert.equal(result.reviewReport, null);
  assert.equal(result.reviewRounds, 1);
  // No errors written: nothing here judged the workspace, so a provider outage
  // at the last node must not turn a green run red.
  assert.equal(result.errors, undefined);
  assert.equal(runVerdict(settled), 0);
  assert.equal(routeAfterReview(settled), "report");
  assert.equal(result.log?.[0]?.event, "failed");
});

test("an answer it cannot read is recorded with a digest, not acted on", async () => {
  const { client } = stub([{ gaps: [{ requirement: "", detail: "", targetPath: "" }] }]);

  const result = await review(stateFor(), client);

  assert.equal(result.reviewReport, null);
  assert.equal(result.tasks, undefined);
  assert.match(result.log?.[0]?.detail ?? "", /verdict/);
  assert.match(result.log?.[0]?.detail ?? "", /object keys \[gaps\]/);
});
