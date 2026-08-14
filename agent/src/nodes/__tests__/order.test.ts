import assert from "node:assert/strict";
import { test } from "node:test";
import { routeAfterOrder } from "../../graph/routers.ts";
import type { AgentState, Task } from "../../graph/state.ts";
import { order } from "../order.ts";

/** A task carries only what the sort reads; the rest is filler. */
function task(id: string, dependsOn: string[]): Task {
  return {
    id,
    description: `Builds ${id}.`,
    targetPath: `src/${id}.ts`,
    taskType: "component",
    dependsOn,
    acceptance: [`${id} exists.`],
  };
}

// A→B, A→C, B→D, C→D. Two tasks are ready at once, which is where a sort with
// no tie-break stops being reproducible.
const ROOT = task("a-root", []);
const LEFT = task("b-left", ["a-root"]);
const RIGHT = task("c-right", ["a-root"]);
const JOIN = task("d-join", ["b-left", "c-right"]);
const DIAMOND: Task[] = [ROOT, LEFT, RIGHT, JOIN];

const CHAIN: Task[] = [
  task("s1-first", []),
  task("s2-second", ["s1-first"]),
  task("s3-third", ["s2-second"]),
];

/**
 * The same plans, handed over the way a planner might emit them. Both fixtures
 * are declared in an order that is already valid, so every assertion about the
 * sort runs over the shuffles as well: against the fixtures alone, an
 * implementation that returned its input untouched would pass.
 */
const DIAMOND_ARRIVALS: Task[][] = [
  DIAMOND,
  [...DIAMOND].reverse(),
  [JOIN, LEFT, ROOT, RIGHT],
  [RIGHT, ROOT, JOIN, LEFT],
];

const ARRIVALS: Task[][] = [...DIAMOND_ARRIVALS, CHAIN, [...CHAIN].reverse()];

function stateFor(tasks: Task[]): AgentState {
  return {
    runId: "test-order",
    spec: "",
    outputDir: "/tmp-never-written-by-this-test",
    surface: {},
    tasks,
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

/**
 * The property that defines a topological order: nothing runs before what it
 * depends on. Without this assertion, returning the input untouched would pass.
 */
function assertDependenciesComeFirst(tasks: Task[], orderedTaskIds: string[]): void {
  assert.equal(orderedTaskIds.length, tasks.length);
  for (const item of tasks) {
    const position = orderedTaskIds.indexOf(item.id);
    assert.notEqual(position, -1, `${item.id} is missing from the order`);
    for (const dependency of item.dependsOn) {
      assert.ok(
        orderedTaskIds.indexOf(dependency) < position,
        `${item.id} is ordered before its dependency ${dependency}`,
      );
    }
  }
}

test("orders every task after all of its dependencies", () => {
  for (const tasks of ARRIVALS) {
    const result = order(stateFor(tasks));
    assertDependenciesComeFirst(tasks, result.orderedTaskIds ?? []);
  }
});

test("orders the same plan the same way whatever order it arrives in", () => {
  for (const tasks of DIAMOND_ARRIVALS) {
    assert.deepEqual(order(stateFor(tasks)).orderedTaskIds, [
      "a-root",
      "b-left",
      "c-right",
      "d-join",
    ]);
  }
});

test("marks every ordered task pending and starts the queue at its head", () => {
  const result = order(stateFor(CHAIN));

  assert.deepEqual(result.status, {
    "s1-first": "pending",
    "s2-second": "pending",
    "s3-third": "pending",
  });
  assert.equal(result.cursor, 0);
  assert.equal(result.errors, undefined);
});

test("detects a cycle and routes to report instead of throwing", () => {
  const cyclic = [task("one", ["three"]), task("two", ["one"]), task("three", ["two"])];

  const result = order(stateFor(cyclic));

  assert.equal(result.orderedTaskIds, undefined);
  assert.equal(result.errors?.length, 1);
  assert.equal(result.errors?.[0]?.code, "order-failed");
  assert.match(result.errors?.[0]?.message ?? "", /close a cycle: none of one, three, two/);
  assert.equal(routeAfterOrder({ ...stateFor(cyclic), ...result }), "report");
});

test("reports a dependency on an id the plan does not define", () => {
  const dangling = [task("only", ["absent"])];

  const result = order(stateFor(dangling));

  assert.equal(result.orderedTaskIds, undefined);
  assert.equal(result.errors?.[0]?.code, "order-failed");
  assert.match(result.errors?.[0]?.message ?? "", /"only" depends on "absent"/);
});

test("routes an ordered plan to generate and an empty one to report", () => {
  const ordered = order(stateFor(CHAIN));

  assert.equal(routeAfterOrder({ ...stateFor(CHAIN), ...ordered }), "generate");
  assert.equal(routeAfterOrder(stateFor([])), "report");
});
