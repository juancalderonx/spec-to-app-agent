import { spawn } from "node:child_process";
import type { Sandbox } from "./fs.ts";
import { SandboxError, traced, truncate } from "./trace.ts";

/**
 * The model never supplies a command string: it names one of these keys, and
 * the argv it maps to is fixed here. There is no shell involved, so nothing a
 * caller passes can be interpreted as another command.
 */
const ALLOWED_COMMANDS: Record<string, readonly [string, ...string[]]> = {
  install: ["npm", "install"],
  typecheck: ["npm", "run", "typecheck"],
  test: ["npm", "run", "test"],
};

/** Ceiling on one command. `npm install` is the slow one; nothing outlives it. */
const TIMEOUT_MS = 10 * 60_000;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(sandbox: Sandbox, name: string): Promise<CommandResult> {
  return traced(
    sandbox.trace,
    "runCommand",
    { command: name },
    async () => {
      const argv = ALLOWED_COMMANDS[name];
      if (argv === undefined) {
        throw new SandboxError(
          `Command "${name}" is not on the allowlist (${Object.keys(ALLOWED_COMMANDS).join(", ")}).`,
        );
      }
      return collectOutput(argv, sandbox.root);
    },
    // Only a digest reaches the trace. The full output goes to the caller, which
    // is where it gets parsed into structured errors.
    (result) =>
      result.code === 0
        ? "exit 0"
        : `exit ${result.code} · ${truncate(result.stderr === "" ? result.stdout : result.stderr)}`,
  );
}

function collectOutput(
  argv: readonly [string, ...string[]],
  cwd: string,
): Promise<CommandResult> {
  const [command, ...args] = argv;
  return new Promise((settle, fail) => {
    const child = spawn(command, args, { cwd, timeout: TIMEOUT_MS });
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    // A command that never starts — missing binary, unreadable cwd — must reach
    // the caller as a failure rather than as a silent empty result.
    child.on("error", fail);
    child.on("close", (code, signal) => {
      if (signal !== null) {
        fail(
          new Error(
            `Command "${argv.join(" ")}" was terminated by ${signal} after ${TIMEOUT_MS} ms.`,
          ),
        );
        return;
      }
      settle({ code: code ?? 0, stdout, stderr });
    });
  });
}
