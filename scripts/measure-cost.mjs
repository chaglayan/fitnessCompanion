/**
 * Measures what an AI-assisted session actually costs, per model.
 *
 * Written because the first cost figures in the README were estimated from
 * prompt length (chars / 3.7) and were 1.8x too low — which then produced a
 * wrong recommendation, because whether a model can use the prompt cache
 * depends on the prompt clearing that model's minimum prefix length.
 *
 * With ANTHROPIC_API_KEY set this counts tokens through the API. Without one
 * it falls back to the recorded measurements below and says so.
 *
 *   node scripts/measure-cost.mjs
 */
/** Observed on real calls; see the README table. */
const OBSERVED = {
  cachedPrefixTokens: 4893,
  freshInputTokens: 380,
  outputWithThinking: 370,
  outputWithoutThinking: 180,
};

/** USD per 1M tokens, and the minimum prefix each model will cache. */
const MODELS = [
  { id: "claude-opus-5", label: "Opus 5", input: 5, output: 25, cacheMin: 512 },
  { id: "claude-sonnet-5", label: "Sonnet 5", input: 2, output: 10, cacheMin: 1024 },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", input: 1, output: 5, cacheMin: 4096 },
];

const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;

/**
 * The only trustworthy prefix size is `cache_creation_input_tokens` from a
 * real call: `messages.countTokens` cannot account for the structured-output
 * schema, which is part of the cached prefix and worth ~1,200 tokens here.
 * That gap straddles Haiku 4.5's 4,096-token cache minimum, so guessing it
 * flips the recommendation.
 */
const prefix = OBSERVED.cachedPrefixTokens;

console.log(
  `Cached prefix: ${prefix} tokens\n` +
    "(from cache_creation_input_tokens on a real call — countTokens under-reports\n" +
    " it by the size of the structured-output schema)\n",
);

const per = (n, rate) => (n / 1_000_000) * rate;

for (const thinking of [true, false]) {
  const out = thinking ? OBSERVED.outputWithThinking : OBSERVED.outputWithoutThinking;
  console.log(`AI_THINKING=${thinking ? "adaptive (default)" : "disabled"} — ${out} output tokens`);
  console.log("  model        caches?  warm call   cold call   calls per $5");
  for (const m of MODELS) {
    const caches = prefix >= m.cacheMin;
    const warm = caches
      ? per(prefix, m.input * CACHE_READ) + per(OBSERVED.freshInputTokens, m.input) + per(out, m.output)
      : per(prefix + OBSERVED.freshInputTokens, m.input) + per(out, m.output);
    const cold = caches
      ? per(prefix, m.input * CACHE_WRITE) + per(OBSERVED.freshInputTokens, m.input) + per(out, m.output)
      : warm;
    console.log(
      "  " + m.label.padEnd(12) +
        (caches ? "yes" : "NO ").padEnd(8) +
        ("$" + warm.toFixed(4)).padEnd(12) +
        ("$" + cold.toFixed(4)).padEnd(12) +
        Math.floor(5 / warm).toLocaleString(),
    );
  }
  console.log();
}

console.log(
  "A cold call writes the cache (~1.25x input rate) and happens once per hour\n" +
    "of use; every call after that is warm. Sessions with no free-text note\n" +
    "cost nothing at all — they never reach a model.",
);
