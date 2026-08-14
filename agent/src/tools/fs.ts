import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SandboxError, traced, type Trace } from "./trace.ts";

/** Where the tools may write, and where every invocation is recorded. */
export interface Sandbox {
  /** Absolute and already resolved through any symlink — see `openSandbox`. */
  root: string;
  trace: Trace;
}

/**
 * Fixes the root to its real path once, so every later check compares a real
 * path against a real path. Doing it per call would still work; doing it here
 * means a root that is itself a symlink (a temporary directory on macOS, for
 * one) cannot make legitimate paths look like escapes.
 */
export async function openSandbox(root: string, trace: Trace): Promise<Sandbox> {
  return { root: await realpath(root), trace };
}

/**
 * Resolves `target` against the sandbox root and refuses anything landing
 * outside it.
 *
 * The check resolves the closest *existing* ancestor rather than the full path,
 * because the file being written usually does not exist yet: resolving only the
 * full path would throw on every create and skip the symlink check exactly when
 * it matters. Everything below that ancestor cannot be a symlink — it does not
 * exist — and `resolve` has already collapsed any `..`, so nothing below can
 * climb back out.
 */
export async function resolveInside(sandbox: Sandbox, target: string): Promise<string> {
  const absolute = resolve(sandbox.root, target);
  const anchor = await realpathOfNearestExisting(absolute);
  if (anchor !== sandbox.root && !anchor.startsWith(sandbox.root + sep)) {
    throw new SandboxError(
      `Path "${target}" resolves to "${anchor}", outside the output directory "${sandbox.root}".`,
    );
  }
  return absolute;
}

async function realpathOfNearestExisting(path: string): Promise<string> {
  let current = path;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return current; // Reached the filesystem root: nothing left to resolve.
      }
      current = parent;
    }
  }
}

export function readFileIn(sandbox: Sandbox, path: string): Promise<string> {
  return traced(
    sandbox.trace,
    "readFile",
    { path },
    async () => readFile(await resolveInside(sandbox, path), "utf8"),
    (contents) => `${Buffer.byteLength(contents)} bytes`,
  );
}

export function writeFileIn(
  sandbox: Sandbox,
  path: string,
  contents: string,
): Promise<void> {
  return traced(sandbox.trace, "writeFile", { path, bytes: Buffer.byteLength(contents) }, async () => {
    const absolute = await resolveInside(sandbox, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  });
}

/** Lists files below `path`, recursively, as paths relative to the root. */
export function listFilesIn(sandbox: Sandbox, path: string): Promise<string[]> {
  return traced(
    sandbox.trace,
    "listFiles",
    { path },
    async () => {
      const absolute = await resolveInside(sandbox, path);
      const entries = await readdir(absolute, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => relative(sandbox.root, join(entry.parentPath, entry.name)))
        .sort();
    },
    (files) => `${files.length} files`,
  );
}
