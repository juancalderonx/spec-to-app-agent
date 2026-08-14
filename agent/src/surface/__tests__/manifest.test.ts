import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { SurfaceEntry } from "../../graph/state.ts";
import { openSandbox } from "../../tools/fs.ts";
import { openTrace } from "../../tools/trace.ts";
import { parseSurface, readSurface } from "../manifest.ts";

/** The signature recorded for `name`, or `undefined` if it is not exported. */
function signatureOf(entry: SurfaceEntry, name: string): string | undefined {
  return entry.exports.find((exported) => exported.name === name)?.signature;
}

test("records a type declaration's members, which are its signature", () => {
  const entry = parseSurface(
    "types.ts",
    `export interface Reading {
       id: string;
       value: number;
     }
     export type Unit = "celsius" | "kelvin";
     interface Hidden { secret: string }`,
  );

  assert.equal(signatureOf(entry, "Reading"), "interface Reading { id: string; value: number; }");
  assert.equal(signatureOf(entry, "Unit"), 'type Unit = "celsius" | "kelvin";');
  assert.equal(signatureOf(entry, "Hidden"), undefined);
});

test("records parameter and return types where the source annotates them", () => {
  const entry = parseSurface(
    "Panel.tsx",
    `export interface PanelProps { readings: Reading[]; onPick: (id: string) => void }
     export function Panel({ readings, onPick }: PanelProps): JSX.Element {
       return <ul>{readings.map((r) => <li key={r.id} onClick={() => onPick(r.id)} />)}</ul>;
     }
     export async function load<T>(url: string): Promise<T[]> {
       return [];
     }`,
  );

  assert.equal(
    signatureOf(entry, "Panel"),
    "function Panel({ readings, onPick }: PanelProps): JSX.Element",
  );
  assert.equal(signatureOf(entry, "load"), "async function load<T>(url: string): Promise<T[]>");
});

test("omits what the source omits rather than inferring it", () => {
  // Syntax only: no checker, so an unannotated return type is absent, not
  // guessed. The provided project's own components look like this.
  const entry = parseSurface("Page.tsx", `export default function Page() { return <main />; }`);

  assert.deepEqual(entry.exports, [{ name: "default", signature: "function Page()" }]);
});

test("keeps a tagged template verbatim — the document is the contract", () => {
  const entry = parseSurface(
    "documents.ts",
    `export const LIST_READINGS = gql\`
       query ListReadings {
         readings { id value }
       }
     \`;`,
  );

  assert.equal(
    signatureOf(entry, "LIST_READINGS"),
    "const LIST_READINGS = gql` query ListReadings { readings { id value } } `",
  );
});

test("describes an initializer by what it is, not by what it contains", () => {
  const entry = parseSurface(
    "setup.ts",
    `export const port: number = 4000;
     export const gateway = new Gateway({ url: "/api" });
     export const worker = start(...handlers);
     export const routes = [routeA, routeB];
     export const defaults = { retries: 3 };
     export const pick = (id: string): Reading | undefined => registry.get(id);`,
  );

  assert.equal(signatureOf(entry, "port"), "const port: number");
  assert.equal(signatureOf(entry, "gateway"), "const gateway = new Gateway(…)");
  assert.equal(signatureOf(entry, "worker"), "const worker = start(…)");
  assert.equal(signatureOf(entry, "routes"), "const routes = […]");
  assert.equal(signatureOf(entry, "defaults"), "const defaults = {…}");
  assert.equal(signatureOf(entry, "pick"), "const pick = (id: string): Reading | undefined");
});

test("records re-exports so a name is never silently missing", () => {
  const entry = parseSurface(
    "index.ts",
    `export { Panel, load } from "./Panel";
     export * from "./types";`,
  );

  assert.deepEqual(entry.exports.map((exported) => exported.name), ["Panel", "load", "*"]);
});

test("never carries anything from inside a body", () => {
  const source = `const MARKER = "SENTINEL-NOT-IN-MANIFEST";
    export function total(values: readonly number[]): number {
      if (values.length === 0) {
        return MARKER.length;
      }
      return values.reduce((sum, value) => sum + value, 0);
    }
    export const describe = (reading: Reading): string => {
      return \`\${reading.id}: \${MARKER}\`;
    };`;

  const entry = parseSurface("total.ts", source);

  assert.equal(JSON.stringify(entry).includes("SENTINEL-NOT-IN-MANIFEST"), false);
  assert.equal(signatureOf(entry, "total"), "function total(values: readonly number[]): number");
  assert.equal(signatureOf(entry, "describe"), "const describe = (reading: Reading): string");
});

test("reads a source tree through the sandbox, skipping what is not source", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "agent-surface-"));
  after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, "src", "nested"), { recursive: true });
  await writeFile(join(workspace, "src", "unit.ts"), "export const one = 1;\n", "utf8");
  await writeFile(
    join(workspace, "src", "nested", "View.tsx"),
    "export default function View() { return null; }\n",
    "utf8",
  );
  await writeFile(join(workspace, "src", "notes.md"), "# not source\n", "utf8");
  const sandbox = await openSandbox(workspace, openTrace(join(workspace, "tools.jsonl")));

  const manifest = await readSurface(sandbox, "src");

  assert.deepEqual(Object.keys(manifest), ["src/nested/View.tsx", "src/unit.ts"]);
  assert.deepEqual(manifest["src/unit.ts"]?.exports, [{ name: "one", signature: "const one = 1" }]);
});
