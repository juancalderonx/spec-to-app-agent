import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { AgentState, UsageEntry } from "../../graph/state.ts";
import type { ModelClient } from "../../llm/factory.ts";
import { plan } from "../plan.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** No provider is reached: every answer below is fixed in the test. */
function stub(answers: readonly unknown[]): { client: ModelClient; seen: BaseMessageLike[][] } {
  const seen: BaseMessageLike[][] = [];
  const client: ModelClient = {
    modelId: "stub",
    invoke: () => Promise.reject(new Error("plan does not use the unstructured call")),
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
    role: "planner",
    model: "stub",
    inputTokens: 10,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    costUsd: 0,
  };
}

function stateFor(runId: string): AgentState {
  return {
    runId,
    spec: "One screen listing the collection, with a filter over it.",
    outputDir: join(REPO_ROOT, "tmp-never-written-by-this-test"),
    surface: { "src/main.tsx": { exports: [{ name: "default", signature: "function Main()" }] } },
    projectFiles: ["src/main.tsx"],
    tasks: [],
    orderedTaskIds: [],
    cursor: 0,
    attempts: {},
    status: {},
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
  };
}

function answer(dependsOn: string[]): Record<string, unknown> {
  return {
    tasks: [
      {
        id: "list-view",
        description: "Renders the collection.",
        targetPath: "src/components/ListView.tsx",
        taskType: "component",
        dependsOn,
        acceptance: ["Renders one row per item."],
      },
    ],
  };
}

function runDir(runId: string): string {
  return join(REPO_ROOT, "agent", "runs", runId);
}

test("writes the plan as a run artifact and returns it as state", async () => {
  const runId = "test-plan-accepted";
  after(() => rm(runDir(runId), { recursive: true, force: true }));
  const { client, seen } = stub([answer([])]);

  const result = await plan(stateFor(runId), client);

  assert.equal(seen.length, 1);
  assert.deepEqual(result.tasks?.map((task) => task.id), ["list-view"]);
  assert.equal(result.usage?.length, 1);
  assert.equal(result.errors, undefined);

  const written: unknown = JSON.parse(
    await readFile(join(runDir(runId), "plan.json"), "utf8"),
  );
  assert.deepEqual(written, result.tasks);
});

test("retries once with the failures appended, and accepts the correction", async () => {
  const runId = "test-plan-corrected";
  after(() => rm(runDir(runId), { recursive: true, force: true }));
  const { client, seen } = stub([answer(["missing-task"]), answer([])]);

  const result = await plan(stateFor(runId), client);

  assert.equal(seen.length, 2);
  // The second call carries the first two messages plus the correction.
  assert.equal(seen[0]?.length, 2);
  assert.equal(seen[1]?.length, 3);
  assert.match(JSON.stringify(seen[1]?.[2]), /which is not a task in this plan/);
  assert.deepEqual(result.tasks?.map((task) => task.id), ["list-view"]);
  assert.equal(result.usage?.length, 2);
});

test("fails terminally after the second invalid answer, without throwing", async () => {
  const runId = "test-plan-rejected";
  after(() => rm(runDir(runId), { recursive: true, force: true }));
  const { client, seen } = stub([answer(["missing-task"]), answer(["still-missing"])]);

  const result = await plan(stateFor(runId), client);

  assert.equal(seen.length, 2);
  assert.equal(result.tasks, undefined);
  assert.equal(result.errors?.length, 1);
  assert.equal(result.errors?.[0]?.code, "plan-failed");
  assert.match(result.errors?.[0]?.message ?? "", /still invalid after 2 attempts/);
  // The spend still reaches the ledger: two calls were paid for.
  assert.equal(result.usage?.length, 2);
});

test("records a transport failure rather than letting it escape the graph", async () => {
  const runId = "test-plan-transport";
  const { client } = stub([]);

  const result = await plan(stateFor(runId), client);

  assert.equal(result.tasks, undefined);
  assert.equal(result.errors?.[0]?.source, "runner");
  assert.match(result.errors?.[0]?.message ?? "", /the stub has no answer 1/);
});
