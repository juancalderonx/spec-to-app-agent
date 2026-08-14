import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

/**
 * Nouns belonging to the two specifications this repository ships. A prompt or
 * a knowledge pack that hardcodes one of them has memorised its example instead
 * of reading the specification it was handed, which is the failure the exercise
 * names first.
 *
 * The list is the union of the two greps `TICKETS.md` runs as acceptance
 * criteria. Matching is case-insensitive and bounded to whole words, singular
 * or plural: the packs have to be able to describe the provided project's
 * machinery, and words like "card", "carrying" and "scarce" are not domain
 * leaks. Naming the specification's entities is; describing a mechanism is not.
 *
 * This file deliberately sits outside `agent/src/prompts/`: it is the one place
 * that must spell the forbidden words out, and it scans that directory.
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

/** The directories whose every file has to stay free of the two domains. */
const SCANNED_DIRS = ["agent/knowledge", "agent/src/prompts"];

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export function assertNoDomainVocabulary(label: string, text: string): void {
  for (const term of FORBIDDEN_DOMAIN_TERMS) {
    const whole = new RegExp(`\\b${term}s?\\b`, "i");
    assert.equal(
      whole.test(text),
      false,
      `${label} contains the domain term "${term}". The domain arrives at runtime, in the specification.`,
    );
  }
}

test("the guard flags a specification's nouns, singular and plural", () => {
  for (const sample of ["cars", "Car", "the Vehicle list", "a vinyl", "sleeve notes"]) {
    assert.throws(() => assertNoDomainVocabulary("sample", sample), {
      name: "AssertionError",
    });
  }
});

test("the guard passes words that merely contain a forbidden noun", () => {
  // Every one of these is a word the packs need: the component library exposes
  // a Card, and prose about the provided project is full of the rest.
  for (const sample of ["card", "cards", "carrying", "scarce", "makeshift", "modelling"]) {
    assertNoDomainVocabulary("sample", sample);
  }
});

test("no prompt or knowledge pack carries vocabulary from either specification", () => {
  const files = SCANNED_DIRS.flatMap((directory) => {
    const absolute = join(REPO_ROOT, directory);
    return readdirSync(absolute, { encoding: "utf8", recursive: true })
      .filter((entry) => entry.endsWith(".md") || entry.endsWith(".ts"))
      .map((entry) => ({ label: `${directory}/${entry}`, path: join(absolute, entry) }));
  });

  assert.ok(files.length > 0, `${SCANNED_DIRS.join(" and ")} hold no files to scan.`);
  for (const file of files) {
    assertNoDomainVocabulary(file.label, readFileSync(file.path, "utf8"));
  }
});
