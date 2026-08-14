import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isBaseMessage } from "@langchain/core/messages";
import { createModel } from "../factory.ts";

/**
 * Credentials for a client that is built and never invoked. Nothing here
 * reaches a provider: `createModel` resolves the key and constructs the
 * adapter, and only `invoke` would open a connection.
 */
const ORIGINAL = { anthropic: process.env["ANTHROPIC_API_KEY"], openai: process.env["OPENAI_API_KEY"] };
process.env["ANTHROPIC_API_KEY"] = "not-a-real-key";
process.env["OPENAI_API_KEY"] = "not-a-real-key";
after(() => {
  process.env["ANTHROPIC_API_KEY"] = ORIGINAL.anthropic;
  process.env["OPENAI_API_KEY"] = ORIGINAL.openai;
});

test("the native adapter carries the cache breakpoint on the block it is given", () => {
  const client = createModel({
    provider: "anthropic",
    role: "coder",
    model: "claude-opus-5",
    promptCache: true,
  });

  const message = client.cacheable("the stable prefix");

  assert.ok(isBaseMessage(message));
  // Serialised rather than indexed: what has to hold is that this key reaches
  // the request beside this text, which is what the adapter forwards.
  const serialised = JSON.stringify(message);
  assert.match(serialised, /"cache_control":\{"type":"ephemeral"\}/);
  assert.match(serialised, /the stable prefix/);
});

test("the OpenAI-compatible adapter is sent no breakpoint to misread", () => {
  const client = createModel({
    provider: "openai",
    role: "coder",
    model: "gpt-5.6-sol",
    promptCache: true,
  });

  assert.deepEqual(client.cacheable("the stable prefix"), ["human", "the stable prefix"]);
});

test("the cache flag switched off leaves the same prefix unmarked", () => {
  const client = createModel({
    provider: "anthropic",
    role: "coder",
    model: "claude-opus-5",
    promptCache: false,
  });

  // The same provider as the first test, so what changes is the flag and
  // nothing else: no breakpoint is written, and the text still goes out.
  assert.deepEqual(client.cacheable("the stable prefix"), ["human", "the stable prefix"]);
});
