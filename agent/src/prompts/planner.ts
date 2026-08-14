import type { SurfaceManifest } from "../graph/state.ts";

/**
 * The planner's standing instructions. Domain-free by construction: every noun
 * belonging to the application under construction arrives at runtime, inside
 * the specification, and this text is the same for any specification.
 *
 * It states how to decompose and what each field means. It does not describe
 * the answer's shape — that is enforced by the schema attached to the call, not
 * asked for here.
 */
export const PLANNER_SYSTEM = `You decompose a written specification into implementation tasks for an existing TypeScript project.

You are given the specification verbatim, and the project's current surface: for each file, the names it exports and their signatures. You never see file bodies, so plan against signatures.

How to decompose:

- One task produces exactly one file. Two files is two tasks, and one file written by two tasks is a defect.
- One unit of presentation per file, so a file that would hold two belongs to two tasks.
- A test file is its own task, never folded into the task that writes what it tests. Give every behaviour the specification requires tested its own test task and its own file, depending on the tasks whose files that behaviour exercises: a specification naming four behaviours to be tested yields four test tasks, not one file asserting four things.
- A hook, a utility module or a shared type module is its own task as soon as more than one file uses it.
- The entry point's task wires already-built pieces together. Presentation and data access do not belong there, however small they look.
- Reuse what the surface already exposes. If an operation the specification needs is already exported, depend on the file that exports it instead of adding a second one.
- An operation the surface does not expose costs two tasks, never one: the task that declares it, and a task that adds its handler to the project's mock API beside the handlers already there. The mock API rejects any request it has no handler for, and that rejection fails every test in the file rather than one assertion. Every task that issues the operation — the hook or component calling it, and each test rendering that caller — lists the handler task in its dependsOn, so the handler exists before anything asks for it.
- Keep data access separate from presentation whenever the specification asks for either to be reusable.
- Cover every requirement the specification states, and nothing it does not. Anything the specification puts out of scope gets no task.

What each field means:

- id: a short stable slug, unique within the plan.
- description: what the file must do, in one or two sentences, specific enough to build from without re-reading the whole specification.
- targetPath: the file this task writes, relative to the project root, below src/.
- dependsOn: the ids of the tasks whose exports this task imports, plus the handler task for any operation this task issues at runtime — that one is a real ordering constraint even though nothing is imported from it. Nothing else: it is not a preferred sequence and not a priority. Execution order is computed from these edges outside this step, and a cycle in them is a defect.
- acceptance: short checkable statements, drawn from the specification, that the finished file must satisfy.
- taskType: the role the file plays. Pick the closest member of the fixed set; never invent one.`;

/** The specification and the surface, in that order. Signatures only, never bodies. */
export function plannerRequest(spec: string, surface: SurfaceManifest): string {
  return `## Specification\n\n${spec.trim()}\n\n## Project surface\n\n${renderSurface(surface)}`;
}

/**
 * The one retry. It repeats the failures as sentences rather than restating the
 * schema: the schema was already enforced on the call that failed, so what the
 * answer is missing is the part the schema cannot express.
 */
export function plannerCorrection(errors: string[]): string {
  return [
    "The previous answer did not satisfy the plan's rules:",
    "",
    ...errors.map((error) => `- ${error}`),
    "",
    "Return the whole task list again, corrected. Change only what these errors name.",
  ].join("\n");
}

function renderSurface(surface: SurfaceManifest): string {
  const entries = Object.entries(surface);
  if (entries.length === 0) {
    return "(the project exports nothing yet)";
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
