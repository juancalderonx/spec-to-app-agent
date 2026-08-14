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

You are given, in this order: the project's standing constraints, the conventions for this kind of file, an example of the output contract, the specification the project is built from, and finally the task itself with the signatures of the files it depends on.

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

export default function ElapsedLabel({ since, now = new Date() }: ElapsedLabelProps) {
  const minutes = Math.floor((now.getTime() - Date.parse(since)) / 60_000);
  return (
    <Typography variant="body2" color="text.secondary">
      {minutes < 1 ? "moments ago" : \`\${minutes} min ago\`}
    </Typography>
  );
}`;

/**
 * The part of the prompt that does not change while a run is in flight: the
 * packs, the output contract, and the specification.
 *
 * The specification sits here rather than beside the task because it is the same
 * bytes on every task of a run. Anything constant belongs ahead of the
 * breakpoint; anything per-task belongs behind it, or the prefix is not stable
 * and there is nothing to cache.
 */
export function coderPrefix(spec: string, packs: PackSelection): string {
  return [
    packs.text,
    `# The output contract\n\nAn answer looks like this — one file, whole, typed, and about something the specification below never mentions:\n\n\`\`\`tsx\n${OUTPUT_CONTRACT_EXAMPLE}\n\`\`\``,
    `# Specification\n\n${spec.trim()}`,
  ].join("\n\n");
}

/** The per-task part: this task, and the signatures it may import from. */
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
    "# What it may import",
    "",
    renderDependencies(dependencies),
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

function renderDependencies(dependencies: SurfaceManifest): string {
  const entries = Object.entries(dependencies);
  if (entries.length === 0) {
    return "Nothing: this task depends on no other file's exports.";
  }
  return entries
    .map(([path, entry]) => {
      const exported = entry.exports
        .map((exportedName) => `- ${exportedName.name}: ${exportedName.signature}`)
        .join("\n");
      return `### ${path}\n${exported === "" ? "(no exports)" : exported}`;
    })
    .join("\n\n");
}
