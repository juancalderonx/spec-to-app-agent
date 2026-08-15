import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BOLD, GREEN, GREY, RESET, VIOLET } from "./ansi.ts";
import { DEFAULT_PROVIDER, PROVIDERS, type Provider } from "../llm/factory.ts";
import {
  runScreen,
  type KeyInput,
  type MenuOutput,
  type Screen,
  type Section,
} from "./menu.ts";


/** Where specifications are looked for, and where a run writes when nobody says. */
const SPEC_DIR = "specs";
const OUTPUT_ROOT = "runs";

const TITLE = "spec-to-app-agent";
const SUBTITLE = "A specification becomes a working application.";

/** Single-cell glyphs. Nothing from a patched font: an unpatched terminal draws a box. */
const SPEC_GLYPH = "▤";
const PROVIDER_GLYPH = "◆";

export interface Environment {
  /** From npm, which sets it for every script it runs. Absent under a bare `node`. */
  version: string | undefined;
  node: string;
  envLoaded: boolean;
}

export function readEnvironment(): Environment {
  return {
    version: process.env.npm_package_version,
    node: process.version,
    // The run starts with `--env-file-if-exists`, which says nothing when the
    // file is missing. A splash claiming a credential file was loaded when it
    // was not is worse than one that says nothing.
    envLoaded: existsSync(".env"),
  };
}

/** The welcome box, sized to its longest line so the frame closes whatever the text says. */
export function banner(colour: boolean, environment: Environment): string {
  const footer = [
    environment.version === undefined ? undefined : `v${environment.version}`,
    `Node ${environment.node}`,
    environment.envLoaded ? ".env loaded" : "no .env",
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  const rows = [TITLE, SUBTITLE, footer];
  const inner = Math.max(...rows.map((row) => [...row].length)) + 3;
  const line = (row: string, paint: string): string => {
    const padded = ` ${row}${" ".repeat(inner - [...row].length - 1)}`;
    return `│${colour && paint !== "" ? `${paint}${padded}${RESET}` : padded}│`;
  };
  return [
    `╭${"─".repeat(inner)}╮`,
    line(TITLE, `${BOLD}${VIOLET}`),
    line(SUBTITLE, ""),
    line(footer, environment.envLoaded ? GREEN : GREY),
    `╰${"─".repeat(inner)}╯`,
  ].join("\n");
}

export interface Flags {
  spec?: string | undefined;
  output?: string | undefined;
  provider?: string | undefined;
}

/**
 * Whether to ask instead of failing.
 *
 * Only when a specification was not named **and** both ends of the terminal are
 * interactive. A flag that was passed is an answer already given, and a run
 * inside a pipe or a CI job has nobody to ask: it keeps the usage error it has
 * always printed, because a prompt nobody can answer is a hang.
 */
export function needsLauncher(flags: Flags, interactive: boolean): boolean {
  return interactive && flags.spec === undefined;
}

/** `runs/app-2026-08-15T05-55-09-788Z`. Fresh per run, so no output is built on top of another. */
export function defaultOutput(startedAt: Date): string {
  return join(OUTPUT_ROOT, `app-${startedAt.toISOString().replace(/[:.]/g, "-")}`);
}

/**
 * What a specification calls itself: its first heading.
 *
 * Read from the file rather than written into a table here, so a specification
 * added tomorrow describes itself and nothing in the agent has to learn its
 * domain.
 */
export function specTitle(markdown: string): string {
  const heading = markdown.split("\n").find((line) => line.startsWith("# "));
  return heading === undefined ? "" : heading.slice(2).trim();
}

interface SpecChoice {
  path: string;
  title: string;
}

async function specs(directory: string): Promise<SpecChoice[]> {
  const entries = await readdir(directory);
  const paths = entries
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => join(directory, entry));
  return Promise.all(
    paths.map(async (path) => ({ path, title: specTitle(await readFile(path, "utf8")) })),
  );
}

export interface Choices {
  spec: string;
  output: string;
  provider: Provider;
}

/**
 * The interactive start: a welcome, a specification and a provider, on one
 * screen that keeps both answers visible.
 *
 * `null` means the reader quit, and the caller must return without spending
 * anything.
 *
 * The output directory is chosen rather than asked for. A list cannot offer a
 * path that does not exist yet, and free text is the one answer here that can
 * silently destroy work — `prepare` merges into a directory that is not empty.
 * A fresh directory per run cannot collide; `--output` is still the way to name
 * one.
 */
export async function launch(
  input: KeyInput,
  output: MenuOutput,
  startedAt: Date,
): Promise<Choices | null> {
  const colour = output.isTTY === true;
  output.write(`${banner(colour, readEnvironment())}\n\n`);

  const available = await specs(SPEC_DIR);
  if (available.length === 0) {
    output.write(`No specification found under ${SPEC_DIR}/. Pass --spec instead.\n`);
    return null;
  }

  const chosenOutput = defaultOutput(startedAt);
  const sections: Section[] = [
    {
      title: "Specification",
      rows: available.map((spec) => ({ glyph: SPEC_GLYPH, label: spec.path, note: spec.title })),
    },
    {
      title: "Provider",
      rows: PROVIDERS.map((provider) => ({
        glyph: PROVIDER_GLYPH,
        label: provider,
        note: provider === DEFAULT_PROVIDER ? "default" : "",
      })),
    },
  ];

  /** What the choices amount to so far, kept under the screen as it moves. */
  const ready = (screen: Screen): string[] => {
    const spec = available[screen.choices[0] ?? 0]?.path ?? "";
    const provider = PROVIDERS[screen.choices[1] ?? 0] ?? DEFAULT_PROVIDER;
    const line = `❯ ${spec} · ${provider} → ${chosenOutput}`;
    return ["", colour ? `${GREY}${line}${RESET}` : line];
  };

  const answers = await runScreen(sections, input, output, ready);
  if (answers === null) {
    return null;
  }

  const spec = available[answers[0] ?? 0];
  const provider = PROVIDERS[answers[1] ?? 0];
  if (spec === undefined || provider === undefined) {
    return null;
  }
  return { spec: spec.path, output: chosenOutput, provider };
}
