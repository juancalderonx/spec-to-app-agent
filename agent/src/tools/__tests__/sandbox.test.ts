import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { listFilesIn, openSandbox, readFileIn, removeFileIn, writeFileIn } from "../fs.ts";
import { runCommand } from "../shell.ts";
import { SandboxError, openTrace, truncate, type TraceEntry } from "../trace.ts";

const workspace = await mkdtemp(join(tmpdir(), "agent-sandbox-"));
const root = join(workspace, "output");
const outside = join(workspace, "outside");
await mkdir(root, { recursive: true });
await mkdir(outside, { recursive: true });
await writeFile(join(outside, "secret.txt"), "not yours", "utf8");

const sandbox = await openSandbox(root, openTrace(join(workspace, "tools.jsonl")));

after(() => rm(workspace, { recursive: true, force: true }));

test("writes and reads a file inside the sandbox", async () => {
  await writeFileIn(sandbox, "src/app.ts", "export const answer = 42;\n");

  assert.equal(await readFileIn(sandbox, "src/app.ts"), "export const answer = 42;\n");
});

test("lists files as paths relative to the sandbox root", async () => {
  assert.deepEqual(await listFilesIn(sandbox, "."), ["src/app.ts"]);
});

test("rejects a relative path that climbs out of the sandbox", async () => {
  await assert.rejects(() => readFileIn(sandbox, "../../etc/passwd"), SandboxError);
});

test("rejects an absolute path outside the sandbox, without writing", async () => {
  const target = join(outside, "escape.txt");

  await assert.rejects(() => writeFileIn(sandbox, target, "planted"), SandboxError);
  assert.equal(existsSync(target), false);
});

test("rejects a symlink escaping the sandbox, on write as well as on read", async () => {
  await symlink(outside, join(root, "link"));

  await assert.rejects(() => readFileIn(sandbox, "link/secret.txt"), SandboxError);
  // The write is the case worth naming: the target does not exist yet, so the
  // check has to resolve the closest existing ancestor to see the escape.
  await assert.rejects(() => writeFileIn(sandbox, "link/planted.txt", "planted"), SandboxError);
  assert.equal(existsSync(join(outside, "planted.txt")), false);
});

test("deletes a file inside the sandbox, and tolerates one that is not there", async () => {
  await writeFileIn(sandbox, "src/doomed.ts", "export const gone = true;\n");

  await removeFileIn(sandbox, "src/doomed.ts");
  assert.equal(existsSync(join(root, "src/doomed.ts")), false);

  // A rollback of a task whose write never landed finds nothing to delete.
  await removeFileIn(sandbox, "src/doomed.ts");
});

test("refuses to delete outside the sandbox, by climbing or through a symlink", async () => {
  const target = join(outside, "secret.txt");

  await assert.rejects(() => removeFileIn(sandbox, "../outside/secret.txt"), SandboxError);
  await assert.rejects(() => removeFileIn(sandbox, target), SandboxError);
  await assert.rejects(() => removeFileIn(sandbox, "link/secret.txt"), SandboxError);
  assert.equal(existsSync(target), true);
});

test("rejects a command outside the allowlist", async () => {
  await assert.rejects(() => runCommand(sandbox, "rm -rf /"), SandboxError);
});

test("runs an allowlisted command in the sandbox root and reports its exit code", async () => {
  const project = join(workspace, "project");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "probe", private: true, scripts: { typecheck: "node -e ''" } }),
    "utf8",
  );
  const projectSandbox = await openSandbox(project, openTrace(join(workspace, "project.jsonl")));

  const result = await runCommand(projectSandbox, "typecheck");

  assert.equal(result.code, 0);
});

test("records one parseable JSON line per invocation, and never a file body", async () => {
  const tracePath = join(workspace, "scripted.jsonl");
  const scripted = await openSandbox(root, openTrace(tracePath));
  const contents = `const marker = "SENTINEL-NOT-IN-TRACE";\n`.repeat(20);

  await writeFileIn(scripted, "notes/big.ts", contents);
  await readFileIn(scripted, "notes/big.ts");
  await assert.rejects(() => readFileIn(scripted, "../escape.txt"));

  const raw = await readFile(tracePath, "utf8");
  const entries: TraceEntry[] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));

  assert.equal(entries.length, 3);
  assert.equal(raw.includes("SENTINEL-NOT-IN-TRACE"), false);
  assert.deepEqual(entries[0]?.args, { path: "notes/big.ts", bytes: Buffer.byteLength(contents) });
  assert.equal(entries[0]?.outcome, "ok");
  assert.equal(entries[1]?.detail, `${Buffer.byteLength(contents)} bytes`);
  assert.equal(entries[2]?.outcome, "rejected");
  assert.equal(typeof entries[2]?.durationMs, "number");
});

test("truncation announces what it cut", () => {
  assert.equal(truncate("abcdef", 3), "abc… (3 more characters)");
  assert.equal(truncate("abc", 3), "abc");
});
