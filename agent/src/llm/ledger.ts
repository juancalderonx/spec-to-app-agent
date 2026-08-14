import type { UsageMetadata } from "@langchain/core/messages";
import type { ModelRole, UsageEntry } from "../graph/state.ts";
import { costUsd } from "./pricing.ts";

/** A run's spend, with the three kinds of input token kept apart. */
export interface UsageTotals {
  /** Input tokens billed at full price: neither read from nor written to cache. */
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Adds up a run's ledger entries.
 *
 * The three input figures stay separate here for the same reason the pricing
 * table keeps three input rates: collapsing them into one number would hide
 * whether the prompt cache worked. A run whose cached reads are zero across
 * consecutive tasks has a defect, and this is where it becomes visible.
 */
export function totalUsage(entries: readonly UsageEntry[]): UsageTotals {
  return entries.reduce<UsageTotals>(
    (total, entry) => ({
      inputTokens: total.inputTokens + entry.inputTokens,
      cachedReadTokens: total.cachedReadTokens + entry.cachedReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + entry.cacheWriteTokens,
      outputTokens: total.outputTokens + entry.outputTokens,
      costUsd: total.costUsd + entry.costUsd,
    }),
    { inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}

export interface CallRecord {
  node: string;
  role: ModelRole;
  model: string;
  usage: UsageMetadata | undefined;
}

/**
 * Turns one model call's reported usage into a priced ledger entry.
 *
 * The subtraction below was verified against both adapters with a real cached
 * prefix rather than read off the type: `input_tokens` is the total and the
 * cache figures are subsets of it (anthropic reported 10017 = 10003 written +
 * 14 uncached; openai reported 5617 = 5614 read + 3 uncached). Billing the
 * total as uncached input would count the cached tokens twice. The clamp
 * guards the providers reached through the OpenAI-compatible adapter, whose
 * figures have not been measured here.
 */
export function toUsageEntry(call: CallRecord): UsageEntry {
  const cachedReadTokens = call.usage?.input_token_details?.cache_read ?? 0;
  const cacheWriteTokens = call.usage?.input_token_details?.cache_creation ?? 0;
  const inputTokens = Math.max(
    (call.usage?.input_tokens ?? 0) - cachedReadTokens - cacheWriteTokens,
    0,
  );
  const outputTokens = call.usage?.output_tokens ?? 0;

  return {
    node: call.node,
    role: call.role,
    model: call.model,
    inputTokens,
    cachedReadTokens,
    cacheWriteTokens,
    outputTokens,
    costUsd: costUsd(call.model, {
      input: inputTokens,
      cachedRead: cachedReadTokens,
      cacheWrite: cacheWriteTokens,
      output: outputTokens,
    }),
  };
}
