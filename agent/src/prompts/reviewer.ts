import type { SurfaceManifest, Task, TaskStatus } from "../graph/state.ts";

/**
 * A task that ended anywhere other than done, paired with how it ended.
 *
 * Paired by the caller rather than looked up here, so this module renders what
 * it is given and decides nothing about which tasks qualify.
 */
export interface UnfinishedTask {
  task: Task;
  status: TaskStatus;
}

/**
 * The reviewer's standing instructions. Domain-free by construction: every noun
 * belonging to the application under construction arrives at runtime, inside the
 * specification, and this text is the same for any specification.
 *
 * It is a second opinion on coverage, deliberately given to a different provider
 * than the one that wrote the files: whoever wrote them re-applies, when asked to
 * check them, the same assumptions that left the gap.
 *
 * It does not describe the answer's shape — that is enforced by the schema
 * attached to the call, not asked for here.
 */
export const REVIEWER_SYSTEM = `You check a finished build against the specification it was built from.

You are given the specification verbatim, and the surface of the project as it now stands: for each file, the names it exports and their signatures. You never see file bodies. Your question is coverage — is every stated requirement represented — and not style, structure or taste.

What counts as a gap:

- A requirement the specification states that nothing in the surface represents.
- A requirement whose file is named below as unfinished, so what is on disk is not what the task was asked for.

What is not a gap:

- Anything about how a file is written. You cannot see the bodies, so an opinion about them is a guess dressed as a finding.
- A requirement a signature plausibly satisfies. A signature is not proof the behaviour is right, and absence of proof is not absence of the behaviour.
- Anything the specification does not ask for. An improvement you would like is not a gap.

For each gap, name the single file that closes it: the path to rewrite when one already exists for that concern, or the path to add when none does. Each gap becomes one task that writes exactly one file, so two files is two gaps, and a gap that names no file cannot be acted on.

Answer with no gaps at all when the specification is covered. An empty list is what a finished build deserves, and invented work costs a build round that corrects nothing.`;

/**
 * The specification, the surface as it stands, and the tasks that did not
 * finish.
 *
 * **Signatures only.** No body reaches this prompt, which is what keeps the
 * review cheap enough to give a different provider and honest about what it can
 * conclude. It is also the reason the unfinished tasks are listed: a file whose
 * task was rolled back still exports whatever it exported before the run, and
 * from the surface alone that is indistinguishable from a requirement met.
 */
export function reviewerRequest(
  spec: string,
  surface: SurfaceManifest,
  unfinished: readonly UnfinishedTask[],
): string {
  return [
    `# Specification\n\n${spec.trim()}`,
    `# What the project exposes now\n\n${renderSurface(surface)}`,
    `# Tasks that did not finish\n\n${renderUnfinished(unfinished)}`,
  ].join("\n\n");
}

function renderSurface(surface: SurfaceManifest): string {
  const entries = Object.entries(surface);
  if (entries.length === 0) {
    return "Nothing. The build produced no files at all.";
  }
  return entries
    .map(([path, entry]) => {
      const exported = entry.exports
        .map((exported) => `- ${exported.name}: ${exported.signature}`)
        .join("\n");
      return `### ${path}\n${exported === "" ? "(no exports)" : exported}`;
    })
    .join("\n\n");
}

/**
 * The tasks that ended anywhere other than done, and what each was supposed to
 * produce. A task still marked pending here was attempted and never came back
 * clean, which the reviewer has to be able to tell apart from one that was
 * rolled back.
 */
function renderUnfinished(unfinished: readonly UnfinishedTask[]): string {
  if (unfinished.length === 0) {
    return "None. Every task finished and was validated.";
  }
  return unfinished
    .map(({ task, status }) => {
      const outcome =
        status === "failed" ? "given up on, its file put back" : "never validated clean";
      return `- \`${task.targetPath}\` — ${outcome} — was to: ${task.description}`;
    })
    .join("\n");
}
