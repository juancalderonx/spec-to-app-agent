import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildGraph } from "./graph/index.ts";
import { DEFAULT_PROVIDER, PROVIDERS, requireApiKey } from "./llm/factory.ts";

const CACHE_MODES = ["read-write", "read-only", "off"] as const;

const USAGE = `Usage: npm start -- --spec <path> --output <dir> [options]

Turns a natural-language specification into a working application.

Options:
  --spec <path>      Specification file to build from. Required.
  --output <dir>     Directory the application is generated into. Required.
  --provider <name>  LLM provider: ${PROVIDERS.join(" | ")}.
                     Defaults to $LLM_PROVIDER, then anthropic.
  --model <id>       Model id, overriding the default for every role.
  --cache <mode>     Response cache: ${CACHE_MODES.join(" | ")}.
                     Defaults to read-write.
  --help             Print this message.`;

/** Narrows a flag's value to one of its allowed members, or explains why not. */
function member<T extends string>(
  value: string,
  allowed: readonly T[],
  flag: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(
      `--${flag} must be one of: ${allowed.join(", ")} — received "${value}"`,
    );
  }
  return match;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      spec: { type: "string" },
      output: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      cache: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }

  if (values.spec === undefined || values.output === undefined) {
    console.error("Both --spec and --output are required.\n");
    console.error(USAGE);
    return 1;
  }

  const provider = member(
    values.provider ?? process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER,
    PROVIDERS,
    "provider",
  );
  const cache = member(values.cache ?? "read-write", CACHE_MODES, "cache");
  const model = values.model ?? "provider default";

  // Fails here rather than mid-run: a missing credential should cost nothing.
  requireApiKey(provider);

  // Fixed at startup rather than generated mid-graph, so a replay writes to the
  // same paths as the run it replays.
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const spec = await readFile(resolve(values.spec), "utf8");
  const outputDir = resolve(values.output);

  console.log(
    `run ${runId} · provider ${provider} · model ${model} · cache ${cache}`,
  );

  const result = await buildGraph({ provider, model: values.model }).invoke({
    runId,
    spec,
    outputDir,
  });
  for (const entry of result.log) {
    console.log(`[${entry.node}] ${entry.event}: ${entry.detail}`);
  }

  // Until `report` owns the exit code (T-14), an unresolved error is what makes
  // a run non-zero.
  return result.errors.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
