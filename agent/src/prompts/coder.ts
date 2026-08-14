import type { SurfaceManifest, Task } from "../graph/state.ts";
import type { PackSelection } from "./packs.ts";

/**
 * The coder's standing instructions. Domain-free by construction: every noun
 * belonging to the application under construction arrives at runtime, in the
 * specification and in the task, and this text is the same for any of them.
 *
 * It states what an answer is and what the project refuses. It does not describe
 * the answer's envelope — that is enforced by the schema attached to the call.
 */
export const CODER_SYSTEM = `You write one file of an existing TypeScript project.

You are given, in this order: the project's standing constraints, the conventions for this kind of file, an example of the output contract, the specification the project is built from, what the project already exposes, and finally the task itself with what its dependencies produced.

Those last two are different things and the difference matters. What the project already exposes is on disk right now: import those names exactly as they are written, and never redeclare, rename or re-invent one. What a dependency produced is a file this run wrote for this task to build on. Both are given as signatures — names and types, never bodies.

A name you were not given does not exist. If the task seems to need one, use the closest thing you were given rather than inventing the name you expected to find.

What an answer is:

- The complete contents of exactly one file — the one the task names. Not a patch, not a fragment, not two files joined together.
- Everything that file needs to compile on its own: every import it uses, every type it declares.
- Code alone. No commentary around it, no fenced block, no account of what you did.

What the project refuses:

- \`any\`, an assertion written to silence the compiler, or a directive that suppresses a diagnostic. A type that does not fit is a design that does not fit.
- A new dependency, and a relaxed compiler option. The options are the definition of correct code here.
- Work that belongs to another task. Every other file has an owner, including the one that will import this one.

You never see the bodies of the files you depend on, only their signatures. Import what they export by name and trust the signature.`;

/**
 * Teaches the output contract on a shape no specification asks for: what a
 * complete answer looks like, not what to build.
 *
 * Deliberately not a form, a list or a filter. An example resembling a feature
 * a specification could ask for invites copying, and leaves a reader unable to
 * tell which of the two wrote the finished file.
 */
const OUTPUT_CONTRACT_EXAMPLE = `import Typography from "@mui/material/Typography";

export interface ElapsedLabelProps {
  /** Start of the measured interval, as an ISO 8601 timestamp. */
  since: string;
  /** Injected so a test can pin it. Defaults to the current instant. */
  now?: Date;
}

export function ElapsedLabel({ since, now = new Date() }: ElapsedLabelProps) {
  const minutes = Math.floor((now.getTime() - Date.parse(since)) / 60_000);
  return (
    <Typography variant="body2" color="text.secondary">
      {minutes < 1 ? "moments ago" : \`\${minutes} min ago\`}
    </Typography>
  );
}`;

/**
 * The part of the prompt that does not change from one task to the next: the
 * packs, the output contract, the specification, and the surface of the files
 * the project already ships.
 *
 * The project's surface belongs here rather than beside the task because no task
 * produces those files, so no `dependsOn` edge can ever carry them. Left out,
 * the coder has no way to learn the names the project exports and invents them
 * instead — a query that does not exist, a second copy of a type it should have
 * imported. It is the same set for every task of a run, so it is sized once, not
 * once per task.
 *
 * Anything constant belongs ahead of the cache breakpoint; anything per-task
 * belongs behind it, or the prefix is not stable and there is nothing to cache.
 */
export function coderPrefix(
  spec: string,
  packs: PackSelection,
  project: SurfaceManifest,
): string {
  return [
    packs.text,
    `# The output contract\n\nAn answer looks like this — one file, whole, typed, and about something the specification below never mentions:\n\n\`\`\`tsx\n${OUTPUT_CONTRACT_EXAMPLE}\n\`\`\``,
    `# Specification\n\n${spec.trim()}`,
    `# What the project already exposes\n\nThese files are on disk. Import these names as written; do not redeclare them and do not invent one that is not here.\n\n${renderSignatures(project, "The project exports nothing.")}`,
  ].join("\n\n");
}

/** The per-task part: this task, and what its dependencies produced for it. */
export function coderRequest(task: Task, dependencies: SurfaceManifest): string {
  return [
    `# The task: ${task.id}`,
    "",
    `Write \`${task.targetPath}\`, a ${task.taskType} file.`,
    "",
    task.description,
    "",
    "It is finished when:",
    ...task.acceptance.map((statement) => `- ${statement}`),
    "",
    "# What this run produced for it",
    "",
    renderSignatures(
      dependencies,
      "Nothing: everything this task builds on is already in the project above.",
    ),
  ].join("\n");
}

/**
 * The one retry, spent only on an answer this code could not use. A path the
 * sandbox refused is not sent back here: the prompt would be identical and so
 * would the refusal.
 */
export function coderCorrection(problem: string): string {
  return `That answer could not be written: ${problem}\n\nAnswer again with the whole file, corrected.`;
}

/**
 * Each export as the import that reaches it, then its signature.
 *
 * The import line is written out rather than left to be inferred: a name and a
 * signature do not say whether the export is the default one or a named one, and
 * a coder that guesses wrong produces a file that compiles nowhere. It is also
 * where the project's path alias is shown instead of described.
 */
function renderSignatures(manifest: SurfaceManifest, empty: string): string {
  const entries = Object.entries(manifest);
  if (entries.length === 0) {
    return empty;
  }
  return entries
    .map(([path, entry]) => {
      const specifier = moduleSpecifier(path);
      const exported = entry.exports
        .map(
          (exportedName) =>
            `- \`${importForm(exportedName.name, specifier)}\` — ${exportedName.signature}`,
        )
        .join("\n");
      return `### ${path}\n${exported === "" ? "(no exports)" : exported}`;
    })
    .join("\n\n");
}

function importForm(name: string, specifier: string): string {
  return name === "default"
    ? `import <a name of your choosing> from "${specifier}"`
    : `import { ${name} } from "${specifier}"`;
}

/** `src/hooks/useThing.ts` → `@/hooks/useThing`, the alias the project resolves. */
function moduleSpecifier(path: string): string {
  const withoutExtension = path.replace(/\.tsx?$/, "");
  return withoutExtension.startsWith("src/")
    ? `@/${withoutExtension.slice("src/".length)}`
    : withoutExtension;
}
