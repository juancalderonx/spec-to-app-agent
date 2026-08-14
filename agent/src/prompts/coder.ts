import type { SurfaceManifest, Task } from "../graph/state.ts";

/**
 * The coder's standing instructions. Domain-free by construction: every noun
 * belonging to the application under construction arrives at runtime, in the
 * specification and in the task, and this text is the same for any of them.
 *
 * It states what an answer is and what the project refuses. It does not describe
 * the answer's envelope — that is enforced by the schema attached to the call.
 */
export const CODER_SYSTEM = `You write one file of an existing TypeScript project.

You are given, in this order: the project's standing constraints, an example of the output contract, the specification the project is built from, what the project shipped, and finally the conventions for this kind of file and the task itself with what its dependencies produced.

What the project shipped and what a dependency produced are different things and the difference matters. What the project shipped was on disk before any of this was written: import those names exactly as they are written, and never redeclare, rename or re-invent one. What a dependency produced is a file this run wrote for this task to build on, and it may be one of the project's own files, rewritten. Where the same file appears in both, the version given with the task is the one on disk now. Both are given as signatures — names and types, never bodies.

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
 * Everything the run sends unchanged on every task: the standing pack, the
 * output contract, the specification, and the surface the provided project
 * shipped.
 *
 * This is the text the cache breakpoint is placed on, so its bytes are a pure
 * function of the specification and the boilerplate. Two things are kept out of
 * it for that reason, both of which used to be in it:
 *
 * - The pack for the task's type, which changes with the task.
 * - The *current* surface of the project's files. A task that rewrites one —
 *   the wiring task always rewrites the entry point — would otherwise change the
 *   prefix mid-run, and every task after it would pay a cache write instead of a
 *   read. `project` is the frozen reading from `prepare`; the rewritten version
 *   travels with the task that produced it.
 *
 * The project's surface belongs here rather than beside the task because no task
 * produces most of those files, so no `dependsOn` edge can carry them. Left out,
 * the coder has no way to learn the names the project exports and invents them
 * instead — a query that does not exist, a second copy of a type it should have
 * imported.
 */
export function coderPrefix(
  spec: string,
  standing: string,
  project: SurfaceManifest,
): string {
  return [
    standing,
    `# The output contract\n\nAn answer looks like this — one file, whole, typed, and about something the specification below never mentions:\n\n\`\`\`tsx\n${OUTPUT_CONTRACT_EXAMPLE}\n\`\`\``,
    `# Specification\n\n${spec.trim()}`,
    `# What the project shipped\n\nThese files were on disk before this run started. Import these names as written; do not redeclare them and do not invent one that is not here. If one of them appears again below as something this run produced, that later description is the current one.\n\n${renderSignatures(project, "The project exports nothing.")}`,
  ].join("\n\n");
}

/**
 * The per-task part: the conventions for this kind of file, the task, and what
 * its dependencies produced for it. Everything here changes from one task to the
 * next, which is why all of it sits behind the cache breakpoint.
 */
export function coderRequest(
  task: Task,
  dependencies: SurfaceManifest,
  conventions: string,
): string {
  return [
    ...(conventions === "" ? [] : [conventions, ""]),
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
