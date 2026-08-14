/** The shape the provider is made to answer in, rather than asked for in prose. */
export const FILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["contents"],
  properties: {
    contents: {
      type: "string",
      description: "The complete contents of the file this task writes.",
    },
  },
};

export type FileAnswer = { ok: true; contents: string } | { ok: false; error: string };

/**
 * Checks an answer before a byte of it reaches the disk. The schema guarantees
 * the field is there; what it cannot state is that the field holds a file
 * rather than a paragraph about one.
 *
 * Every failure comes back as a sentence, because the sentence is what the
 * retry sends back.
 */
export function readContents(value: unknown): FileAnswer {
  if (typeof value !== "object" || value === null || !("contents" in value)) {
    return { ok: false, error: 'the answer carried no "contents" field.' };
  }
  const contents = value.contents;
  if (typeof contents !== "string" || contents.trim() === "") {
    return { ok: false, error: '"contents" must be the file\'s text, and it was empty.' };
  }
  if (contents.trimStart().startsWith("```")) {
    return {
      ok: false,
      error: '"contents" was wrapped in a fenced block. It has to be the file\'s text alone.',
    };
  }
  return { ok: true, contents };
}
