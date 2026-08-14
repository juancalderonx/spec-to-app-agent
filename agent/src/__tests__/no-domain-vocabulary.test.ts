import assert from "node:assert/strict";
import { test } from "node:test";
import { PLANNER_SYSTEM } from "../prompts/planner.ts";

/**
 * Nouns belonging to the two specifications this repository ships. A prompt
 * that hardcodes one of them has memorised its example instead of reading the
 * specification it was handed, which is the failure the exercise names first.
 *
 * The list is the union of the two greps `TICKETS.md` runs as acceptance
 * criteria, so a build that is green here is green there too. Matching is
 * case-insensitive substring, exactly as those greps are.
 *
 * This file deliberately sits outside `agent/src/prompts/`: it is the one place
 * that must spell the forbidden words out, and those greps scan that directory.
 * Later prompts — the coder's, the reviewer's, the repair one — add a case here
 * rather than restating the list.
 */
export const FORBIDDEN_DOMAIN_TERMS = [
  "car",
  "vehicle",
  "make",
  "model",
  "dealership",
  "vinyl",
  "record",
  "artist",
  "sleeve",
] as const;

export function assertNoDomainVocabulary(label: string, prompt: string): void {
  const lowered = prompt.toLowerCase();
  for (const term of FORBIDDEN_DOMAIN_TERMS) {
    assert.equal(
      lowered.includes(term),
      false,
      `${label} contains the domain term "${term}". The domain arrives at runtime, in the specification.`,
    );
  }
}

test("the planner's standing prompt carries no vocabulary from either specification", () => {
  assertNoDomainVocabulary("PLANNER_SYSTEM", PLANNER_SYSTEM);
});
