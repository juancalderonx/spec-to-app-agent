/**
 * Per-token rates in one table, keyed by model. Cached reads and cache writes
 * are priced apart from ordinary input because they do not cost the same —
 * collapsing them would hide the saving the prompt cache exists to produce.
 */
export interface ModelPricing {
  /** USD per million tokens. */
  input: number;
  cachedRead: number;
  cacheWrite: number;
  output: number;
}

/** Token counts for one call. `input` is the uncached remainder. */
export interface TokenCounts {
  input: number;
  cachedRead: number;
  cacheWrite: number;
  output: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Anthropic list rates: a cached read is 0.1x input, a five-minute cache
  // write is 1.25x input.
  "claude-opus-5": { input: 5, cachedRead: 0.5, cacheWrite: 6.25, output: 25 },
  "claude-sonnet-5": { input: 3, cachedRead: 0.3, cacheWrite: 3.75, output: 15 },
  // OpenAI list rates. Cache writes carry no premium there, so a write costs
  // what ordinary input costs.
  "gpt-5.6-sol": { input: 5, cachedRead: 0.5, cacheWrite: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedRead: 0.2, cacheWrite: 2, output: 12 },
};

const PER_MILLION = 1_000_000;

/**
 * A model absent from the table is priced at zero rather than guessed at. The
 * ledger records the model name beside the figure, so a zero is traceable to
 * the model that produced it instead of passing as a real cost.
 */
export function costUsd(model: string, tokens: TokenCounts): number {
  const pricing = PRICING[model];
  if (pricing === undefined) {
    return 0;
  }
  return (
    (tokens.input * pricing.input +
      tokens.cachedRead * pricing.cachedRead +
      tokens.cacheWrite * pricing.cacheWrite +
      tokens.output * pricing.output) /
    PER_MILLION
  );
}
