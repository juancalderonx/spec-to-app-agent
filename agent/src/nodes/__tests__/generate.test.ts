import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { AgentState, Task, UsageEntry } from "../../graph/state.ts";
import type { ModelClient } from "../../llm/factory.ts";
import { generate, snapshotsFor } from "../generate.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** No provider is reached: every answer below is fixed in the test. */
function stub(answers: readonly unknown[]): { client: ModelClient; seen: BaseMessageLike[][] } {
  const seen: BaseMessageLike[][] = [];
  const client: ModelClient = {
    modelId: "stub",
    invoke: () => Promise.reject(new Error("generate does not use the unstructured call")),
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
    role: "coder",
    model: "stub",
    inputTokens: 100,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 20,
    costUsd: 0,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "list-panel",
    description: "Renders the collection it is given.",
    targetPath: "src/components/ListPanel.tsx",
    taskType: "component",
    dependsOn: [],
    acceptance: ["Renders one row per item."],
    ...overrides,
  };
}

/** A workspace of its own per test, so nothing one test writes reaches another. */
async function workspace(runId: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "generate-"));
  after(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(join(REPO_ROOT, "agent", "runs", runId), { recursive: true, force: true });
  });
  return directory;
}

function stateFor(runId: string, outputDir: string, tasks: Task[]): AgentState {
  return {
    runId,
    spec: "One screen listing the collection, with a filter over it.",
    outputDir,
    surface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor: 0,
    attempts: {},
    status: Object.fromEntries(tasks.map((entry) => [entry.id, "pending" as const])),
    errors: [],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
  };
}

async function traceLines(runId: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(REPO_ROOT, "agent", "runs", runId, "tools.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line): Record<string, unknown> => JSON.parse(line));
}

/** The path a trace line was invoked with, without asserting the line's shape. */
function tracedPath(line: Record<string, unknown> | undefined): unknown {
  const args = line?.["args"];
  return typeof args === "object" && args !== null && "path" in args ? args.path : undefined;
}

const PANEL = "export default function ListPanel() {\n  return null;\n}\n";

test("writes the file, updates the surface and advances the cursor", async () => {
  const runId = "test-generate-writes";
  const outputDir = await workspace(runId);
  const { client } = stub([{ contents: PANEL }]);

  const result = await generate(stateFor(runId, outputDir, [task()]), client);

  assert.equal(await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"), PANEL);
  assert.equal(result.cursor, 1);
  assert.equal(result.errors, undefined);
  assert.equal(result.usage?.length, 1);
  // A written file is not a finished task: `validate` decides that, not this node.
  assert.equal(result.status, undefined);
  assert.deepEqual(result.surface?.["src/components/ListPanel.tsx"], {
    exports: [{ name: "default", signature: "function ListPanel()" }],
  });

  const written = (await traceLines(runId)).find((line) => line["tool"] === "writeFile");
  assert.equal(written?.["outcome"], "ok");
  assert.equal(tracedPath(written), join(await realpath(outputDir), "src/components/ListPanel.tsx"));
});

test("carries the signatures of the direct dependencies and no others", async () => {
  const runId = "test-generate-dependencies";
  const outputDir = await workspace(runId);
  const { client, seen } = stub([{ contents: PANEL }]);

  const state = stateFor(runId, outputDir, [
    task({ id: "shared-types", targetPath: "src/types.ts", taskType: "data-layer" }),
    task({ id: "unrelated-hook", targetPath: "src/hooks/useUnrelated.ts", taskType: "hook" }),
    task({ dependsOn: ["shared-types"] }),
  ]);
  const result = await generate(
    {
      ...state,
      cursor: 2,
      surface: {
        "src/types.ts": { exports: [{ name: "Item", signature: "interface Item { id: string }" }] },
        "src/hooks/useUnrelated.ts": {
          exports: [{ name: "useUnrelated", signature: "function useUnrelated(): void" }],
        },
      },
    },
    client,
  );

  assert.equal(result.errors, undefined);
  const request = JSON.stringify(seen[0]?.at(-1));
  assert.match(request, /src\/types\.ts/);
  assert.match(request, /interface Item/);
  assert.doesNotMatch(request, /useUnrelated/);
});

test("refuses a target outside the output directory before paying for an answer", async () => {
  const runId = "test-generate-escape";
  const outputDir = await workspace(runId);
  const { client, seen } = stub([{ contents: PANEL }]);

  const result = await generate(
    stateFor(runId, outputDir, [task({ targetPath: "../escaped.tsx" })]),
    client,
  );

  // The path is resolved before the call, so the refusal costs nothing.
  assert.equal(seen.length, 0);
  assert.equal(result.usage?.length, 0);
  assert.equal(result.status?.["list-panel"], "failed");
  assert.equal(result.errors?.[0]?.code, "generate-failed");
  assert.match(result.errors?.[0]?.message ?? "", /outside the output directory/);
  assert.equal(result.surface, undefined);
  assert.equal(result.cursor, 1);

  const trace = await traceLines(runId);
  assert.equal(trace.filter((line) => line["tool"] === "writeFile").length, 0);
  assert.equal(trace.find((line) => line["tool"] === "resolvePath")?.["outcome"], "rejected");
});

test("retries once with the failure appended when the answer is unusable", async () => {
  const runId = "test-generate-retry";
  const outputDir = await workspace(runId);
  const { client, seen } = stub([{ contents: "```tsx\nexport default null;\n```" }, { contents: PANEL }]);

  const result = await generate(stateFor(runId, outputDir, [task()]), client);

  assert.equal(seen.length, 2);
  assert.equal(seen[1]?.length, 4);
  assert.match(JSON.stringify(seen[1]?.at(-1)), /fenced block/);
  assert.equal(result.errors, undefined);
  // Both calls reach the ledger: the rejected answer was paid for too.
  assert.equal(result.usage?.length, 2);
});

test("gives up on a task whose answers stay unusable, without stopping the run", async () => {
  const runId = "test-generate-unusable";
  const outputDir = await workspace(runId);
  const { client } = stub([{ contents: "   " }, { contents: "" }]);

  const result = await generate(stateFor(runId, outputDir, [task()]), client);

  assert.equal(result.status?.["list-panel"], "failed");
  assert.match(result.errors?.[0]?.message ?? "", /unusable after 2 attempts/);
  assert.equal(result.cursor, 1);
});

test("keeps each run's snapshots to itself", async () => {
  const first = "test-generate-snapshot-first";
  const second = "test-generate-snapshot-second";
  const firstDir = await workspace(first);
  const secondDir = await workspace(second);

  // The first run overwrites a file the project already had.
  await mkdir(join(firstDir, "src/components"), { recursive: true });
  await writeFile(join(firstDir, "src/components/ListPanel.tsx"), "export default null;\n", "utf8");
  const existing = stateFor(first, firstDir, [task()]);
  await generate(
    { ...existing, surface: { "src/components/ListPanel.tsx": { exports: [] } } },
    stub([{ contents: PANEL }]).client,
  );

  // The second writes a file of the same name, in its own workspace, that did
  // not exist there.
  await generate(stateFor(second, secondDir, [task()]), stub([{ contents: PANEL }]).client);

  assert.deepEqual(snapshotsFor(first).get("list-panel"), [
    {
      path: join(await realpath(firstDir), "src/components/ListPanel.tsx"),
      contents: "export default null;\n",
    },
  ]);
  assert.deepEqual(snapshotsFor(second).get("list-panel"), [
    { path: join(await realpath(secondDir), "src/components/ListPanel.tsx"), contents: null },
  ]);
  assert.equal(snapshotsFor("test-generate-never-ran").size, 0);
});
