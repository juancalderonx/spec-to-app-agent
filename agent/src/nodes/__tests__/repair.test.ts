import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { AgentState, BuildError, Task, UsageEntry } from "../../graph/state.ts";
import type { ModelClient } from "../../llm/factory.ts";
import { repair } from "../repair.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

/** No provider is reached: every answer below is fixed in the test. */
function stub(answers: readonly unknown[]): { client: ModelClient; seen: BaseMessageLike[][] } {
  const seen: BaseMessageLike[][] = [];
  const client: ModelClient = {
    modelId: "stub",
    cacheable: (text) => ["human", text],
    invoke: () => Promise.reject(new Error("repair does not use the unstructured call")),
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
    cachedReadTokens: 900,
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

const BROKEN = "export default function ListPanel() {\n  return missing;\n}\n";
const FIXED = "export default function ListPanel() {\n  return null;\n}\n";

const FAILURE: BuildError = {
  file: "src/components/ListPanel.tsx",
  line: 2,
  code: "TS2304",
  message: "Cannot find name 'missing'.",
  source: "tsc",
};

/** A workspace of its own per test, so nothing one test writes reaches another. */
async function workspace(runId: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "repair-"));
  after(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(join(REPO_ROOT, "agent", "runs", runId), { recursive: true, force: true });
  });
  return directory;
}

/** A run whose cursor has already moved past the task that was just written. */
function stateFor(runId: string, outputDir: string, overrides: Partial<AgentState> = {}): AgentState {
  const tasks = [task()];
  return {
    runId,
    spec: "One screen listing the collection, with a filter over it.",
    outputDir,
    surface: {},
    projectSurface: {},
    tasks,
    orderedTaskIds: tasks.map((entry) => entry.id),
    cursor: 1,
    attempts: {},
    status: { "list-panel": "pending" },
    errors: [FAILURE],
    reviewReport: null,
    reviewRounds: 0,
    usage: [],
    log: [],
    ...overrides,
  };
}

async function withFile(outputDir: string, contents: string): Promise<void> {
  await mkdir(join(outputDir, "src/components"), { recursive: true });
  await writeFile(join(outputDir, "src/components/ListPanel.tsx"), contents, "utf8");
}

test("rewrites the failing file from its body and the parsed errors", async () => {
  const runId = "test-repair-rewrites";
  const outputDir = await workspace(runId);
  await withFile(outputDir, BROKEN);
  const { client, seen } = stub([{ contents: FIXED }]);

  const result = await repair(stateFor(runId, outputDir), client);

  assert.equal(await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"), FIXED);
  assert.equal(result.attempts?.["list-panel"], 1);
  assert.equal(result.usage?.length, 1);
  assert.deepEqual(result.surface?.["src/components/ListPanel.tsx"], {
    exports: [{ name: "default", signature: "function ListPanel()" }],
  });

  // The body and the structured findings both reach the prompt, and the body is
  // the one file this node is allowed to see.
  const request = JSON.stringify(seen[0]?.at(-1));
  assert.match(request, /return missing/);
  assert.match(request, /TS2304/);
  assert.match(request, /ListPanel\.tsx:2/);
});

test("carries the failures in other files as context, apart from its own", async () => {
  const runId = "test-repair-elsewhere";
  const outputDir = await workspace(runId);
  await withFile(outputDir, BROKEN);
  const { client, seen } = stub([{ contents: FIXED }]);

  // The compiler reports a changed export at the importer, not at the file that
  // changed. Filtering the payload down to this task's own file would hide the
  // symptom of the very change being repaired.
  const importer: BuildError = {
    file: "src/App.tsx",
    line: 4,
    code: "TS2305",
    message: "Module './ListPanel' has no exported member 'Panel'.",
    source: "tsc",
  };
  const result = await repair(
    stateFor(runId, outputDir, { errors: [FAILURE, importer] }),
    client,
  );

  assert.equal(result.attempts?.["list-panel"], 1);
  const request = String(JSON.stringify(seen[0]?.at(-1)));
  assert.match(request, /TS2305/);
  assert.match(request, /src\/App\.tsx/);
  // And it is told which of the two it is allowed to answer with.
  assert.match(request, /What failed elsewhere/);
  assert.match(request, /you cannot rewrite them/);
});

test("retries the schema inside the visit, and charges one attempt for both rounds", async () => {
  const runId = "test-repair-schema-retry";
  const outputDir = await workspace(runId);
  await withFile(outputDir, BROKEN);
  // The shape the run this was written against kept receiving: an answer the
  // adapter parsed, under every key but the one asked for.
  const { client, seen } = stub([{ text: "Here is the corrected file." }, { contents: FIXED }]);

  const result = await repair(stateFor(runId, outputDir), client);

  assert.equal(await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"), FIXED);
  // Two calls, one attempt: the malformed answer cost the run a call and did not
  // cost the task a correction.
  assert.equal(seen.length, 2);
  assert.equal(result.attempts?.["list-panel"], 1);
  assert.equal(result.usage?.length, 2);
  // The second call carries the first one's rejection, which is what makes it
  // something other than the first call sent twice.
  assert.match(String(JSON.stringify(seen[1]?.at(-1))), /could not be written/);
});

test("charges one attempt when both rounds are malformed, and writes nothing", async () => {
  const runId = "test-repair-unusable";
  const outputDir = await workspace(runId);
  await withFile(outputDir, BROKEN);
  const { client, seen } = stub([
    { contents: "```tsx\nexport default null;\n```" },
    { contents: "```tsx\nexport default null;\n```" },
  ]);

  const result = await repair(stateFor(runId, outputDir, { attempts: { "list-panel": 1 } }), client);

  assert.equal(await readFile(join(outputDir, "src/components/ListPanel.tsx"), "utf8"), BROKEN);
  assert.equal(seen.length, 2);
  // Charged, so a provider that never answers in shape cannot circle below the
  // ceiling the repair budget sets.
  assert.equal(result.attempts?.["list-panel"], 2);
  assert.equal(result.surface, undefined);
  assert.equal(result.log?.length, 2);
  assert.deepEqual(
    result.log?.map((entry) => entry.event),
    ["unusable", "unusable"],
  );
});

test("logs a digest of an answer it could not use", async () => {
  const runId = "test-repair-digest";
  const outputDir = await workspace(runId);
  await withFile(outputDir, BROKEN);
  // No key is defined and none is reached: every answer below is the stub's.
  const { client } = stub([{ refusal: "I cannot complete this request." }, { contents: FIXED }]);

  const result = await repair(stateFor(runId, outputDir), client);
  const rejected = result.log?.[0]?.detail ?? "";

  // The rejection sentence alone is the same for a truncation, a refusal and a
  // wrong shape. These are what tell them apart.
  assert.match(rejected, /object keys \[refusal\]/);
  assert.match(rejected, /I cannot complete this request\./);
  assert.match(rejected, /round 1/);
});

test("charges the attempt when the failing file cannot even be read", async () => {
  const runId = "test-repair-missing-file";
  const outputDir = await workspace(runId);
  const { client, seen } = stub([{ contents: FIXED }]);

  const result = await repair(stateFor(runId, outputDir), client);

  assert.equal(seen.length, 0);
  assert.equal(result.attempts?.["list-panel"], 1);
  assert.equal(result.log?.[0]?.event, "failed");
});
