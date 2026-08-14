import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TASK_TYPES } from "../graph/state.ts";

/** Where the packs live, as markdown, one file per pack. */
const KNOWLEDGE_DIR = resolve(import.meta.dirname, "../../knowledge");

/**
 * The pack injected on every task, whatever its type. It is also the first
 * block of the prompt's stable prefix, so its text has to be byte-identical
 * from one task to the next — hence the whole-file read with no interpolation.
 */
const STANDING_PACK = "rules";

export interface PackSelection {
  /** Pack names in injection order: the standing pack, then the type's own. */
  names: string[];
  /** The standing pack's text. The same bytes for every task of every run. */
  standing: string;
  /**
   * The text of the pack for this task's type, or `""` when none covers it.
   *
   * Kept apart from `standing` rather than joined to it because the two have
   * different lifetimes: this one changes with the task and so belongs behind
   * the cache breakpoint, while the standing pack opens the cached prefix.
   * Joined, the type of the first task would decide what every later task of
   * another type has to pay to re-send.
   */
  conventions: string;
  /**
   * A sentence for the log when the task type had no pack of its own, `null`
   * otherwise. The caller writes it down; degrading in silence would leave a
   * worse application with no visible cause.
   */
  fallback: string | null;
}

const loaded = new Map<string, string>();

/**
 * Resolves a task type to the packs its prompt carries.
 *
 * An unrecognised type falls back to the standing pack alone rather than
 * failing: an agent that stops because the specification asked for something
 * outside its catalogue is the failure this design exists to avoid.
 *
 * That fallback is unreachable from the planner, whose schema admits only
 * `TASK_TYPES`. It is kept as defence in depth, for the same reason the sort
 * still checks for cycles the plan validator already rejected: the guarantee
 * belongs to the function that needs it, not to its current caller.
 */
export function loadPacks(taskType: string): PackSelection {
  const known = TASK_TYPES.some((candidate) => candidate === taskType);
  const names = known ? [STANDING_PACK, taskType] : [STANDING_PACK];
  return {
    names,
    standing: readPack(STANDING_PACK),
    conventions: known ? readPack(taskType) : "",
    fallback: known
      ? null
      : `No pack covers the task type "${taskType}"; injected "${STANDING_PACK}" alone.`,
  };
}

/** Read once per pack: the same few files are re-sent on every task of a run. */
function readPack(name: string): string {
  const cached = loaded.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const text = readFileSync(join(KNOWLEDGE_DIR, `${name}.md`), "utf8").trim();
  loaded.set(name, text);
  return text;
}
