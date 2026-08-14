import { cp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AgentState, LogEntry } from "../graph/state.ts";
import { readSurface } from "../surface/manifest.ts";
import { openSandbox } from "../tools/fs.ts";
import { runCommand } from "../tools/shell.ts";
import { openTrace, truncate } from "../tools/trace.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BOILERPLATE_DIR = join(REPO_ROOT, "boilerplate");

/** Never copied: one is reinstalled, the other belongs to whoever made it. */
const EXCLUDED = new Set(["node_modules", ".DS_Store"]);

/**
 * Shipped as examples and removed here rather than by the model. Removing a
 * component and forgetting its test breaks the suite on an import that no
 * longer resolves, and the repair loop then spends its budget on a problem it
 * did not cause. Nothing else in the project imports either file.
 */
const REFERENCE_FILES = ["src/components/Example.tsx", "src/__tests__/Example.test.tsx"];

/** Where the project's own sources live, relative to the output directory. */
const SOURCE_DIR = "src";

/**
 * Copies the provided project into the output directory, installs it, and reads
 * what it exposes.
 *
 * A setup failure is recorded rather than thrown: the graph continues to
 * `report`, which turns the record into an artifact and a non-zero exit code.
 * Generating against a workspace that did not install is wasted spend, but a
 * stack trace is not diagnosable.
 */
export async function prepare(state: AgentState): Promise<Partial<AgentState>> {
  const log: LogEntry[] = [];
  const trace = openTrace(join(REPO_ROOT, "agent", "runs", state.runId, "tools.jsonl"));

  try {
    // Copied with `fs.cp` rather than through the sandboxed tools on purpose:
    // these paths come from the agent's own configuration, never from the
    // model. The sandbox exists to bound what the model writes.
    await cp(BOILERPLATE_DIR, state.outputDir, {
      recursive: true,
      filter: (source) => !EXCLUDED.has(basename(source)),
    });
    log.push(record("copied", `${BOILERPLATE_DIR} → ${state.outputDir}`));

    for (const file of REFERENCE_FILES) {
      await rm(join(state.outputDir, file), { force: true });
    }
    log.push(record("removed-reference-files", REFERENCE_FILES.join(", ")));

    const sandbox = await openSandbox(state.outputDir, trace);
    const install = await runCommand(sandbox, "install");
    if (install.code !== 0) {
      return failed(state, log, `npm install exited ${install.code}: ${digest(install)}`);
    }
    log.push(record("installed", `npm install exited 0`));

    const surface = await readSurface(sandbox, SOURCE_DIR);
    const exportCount = Object.values(surface).reduce(
      (total, entry) => total + entry.exports.length,
      0,
    );
    log.push(
      record(
        "surface",
        `${Object.keys(surface).length} files, ${exportCount} exports under ${SOURCE_DIR}/`,
      ),
    );

    // Recorded twice on purpose, and this is the only node that writes the
    // second copy. `surface` goes on to track what each file exports *now*;
    // `projectSurface` keeps what the project shipped, which is what the coder's
    // cached prefix carries and what tells it apart from this run's own output.
    return { surface, projectSurface: surface, log };
  } catch (error) {
    return failed(state, log, error instanceof Error ? error.message : String(error));
  }
}

function failed(
  state: AgentState,
  log: LogEntry[],
  message: string,
): Partial<AgentState> {
  return {
    log: [...log, record("failed", message)],
    errors: [
      {
        file: state.outputDir,
        line: 0,
        code: "prepare-failed",
        message,
        source: "runner",
      },
    ],
  };
}

function digest(result: { stdout: string; stderr: string }): string {
  return truncate(result.stderr === "" ? result.stdout : result.stderr);
}

function record(event: string, detail: string): LogEntry {
  return { node: "prepare", event, detail };
}
