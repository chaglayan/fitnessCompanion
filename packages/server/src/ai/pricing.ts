/**
 * USD per 1M tokens. Anthropic rates as published for first-party API access.
 * Update if Anthropic changes pricing — nothing else reads these numbers.
 */
export interface Rate {
  input: number;
  output: number;
}

const ANTHROPIC_RATES: Record<string, Rate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads bill at roughly 10% of the input rate. */
const CACHE_READ_MULTIPLIER = 0.1;
/** Writing to the cache costs roughly 25% more than a normal input token. */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Falls back to Opus-tier pricing so an unknown model over-estimates rather than under-estimates. */
const FALLBACK_RATE: Rate = { input: 5, output: 25 };

export function rateFor(provider: string, model: string): Rate {
  if (provider === "gemini") {
    // Gemini rates are not bundled — set them from your current Google pricing
    // page. Left at zero, Gemini calls are logged with a cost of 0 rather than
    // a fabricated number.
    return {
      input: Number(process.env["GEMINI_INPUT_USD_PER_MTOK"] ?? 0),
      output: Number(process.env["GEMINI_OUTPUT_USD_PER_MTOK"] ?? 0),
    };
  }
  return ANTHROPIC_RATES[model] ?? FALLBACK_RATE;
}

export interface TokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export function computeCostUsd(
  provider: string,
  model: string,
  tokens: TokenCounts,
): number {
  const rate = rateFor(provider, model);
  const perToken = (n: number, usdPerMillion: number) => (n / 1_000_000) * usdPerMillion;
  return (
    perToken(tokens.inputTokens, rate.input) +
    perToken(tokens.cachedInputTokens, rate.input * CACHE_READ_MULTIPLIER) +
    perToken(tokens.cacheWriteTokens, rate.input * CACHE_WRITE_MULTIPLIER) +
    perToken(tokens.outputTokens, rate.output)
  );
}

/** What the same call would have cost with no cache hits — used to show savings. */
export function costWithoutCache(
  provider: string,
  model: string,
  tokens: TokenCounts,
): number {
  const rate = rateFor(provider, model);
  const totalInput = tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens;
  return (
    (totalInput / 1_000_000) * rate.input + (tokens.outputTokens / 1_000_000) * rate.output
  );
}
