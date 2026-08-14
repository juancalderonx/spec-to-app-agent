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

/**
 * How much of an unusable answer is written down. Enough to tell a truncation
 * from a refusal from a wrong shape, and short enough that a log kept as a
 * committed artifact does not grow a file body per rejected answer.
 */
const DIGEST_CHARS = 200;

/**
 * A bounded description of an answer that could not be used, for the log.
 *
 * A rejection sentence alone says which check failed, not what arrived, and the
 * three ways an answer goes wrong are indistinguishable from it: a response cut
 * off mid-generation, a refusal written as prose, and a well-formed object under
 * the wrong key all reach `readContents` as "no contents field". This says which
 * one it was — the shape, the size, and the beginning of the thing itself.
 *
 * A digest and not the answer, because the log is committed. Known ceiling: it
 * describes what the adapter parsed, so an answer the adapter could not parse at
 * all digests as `undefined` — that the provider returned nothing in the shape
 * of a tool call, which is itself the diagnosis. The unparsed text is not in
 * this node's reach.
 */
export function digestAnswer(value: unknown): string {
  if (value === null || value === undefined) {
    return value === null ? "null" : "undefined";
  }

  const isArray = Array.isArray(value);
  const shape = isArray ? "array" : typeof value;
  // The keys are what separate a refusal under some other field from an answer
  // whose one field came back empty, so they are named even when the body below
  // is clipped away.
  const keys = !isArray && typeof value === "object" ? ` keys [${Object.keys(value).join(", ")}]` : "";

  const text = typeof value === "string" ? value : stringify(value);
  const clipped = text.length > DIGEST_CHARS ? `${text.slice(0, DIGEST_CHARS)}…` : text;
  return `${shape}${keys}, ${text.length} chars: ${clipped}`;
}

/** Never throws: an answer that cannot be serialised still has to be describable. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    return `unserialisable (${error instanceof Error ? error.message : String(error)})`;
  }
}
