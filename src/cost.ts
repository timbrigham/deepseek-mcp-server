/**
 * Cost Calculation Module
 * Handles pricing and cost formatting for DeepSeek API requests
 *
 * DeepSeek V3.2 unified pricing (both deepseek-chat and deepseek-reasoner):
 * - Cache hit input: $0.028/1M tokens
 * - Cache miss input: $0.28/1M tokens
 * - Output: $0.42/1M tokens
 */

/** DeepSeek V3.2 unified pricing per 1M tokens (USD) */
export const PRICING = {
  cache_hit: 0.028,
  cache_miss: 0.28,
  output: 0.42,
} as const;

/**
 * Cost breakdown for a request
 */
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  cacheHitRatio?: number;
  cacheSavings?: number;
}

/**
 * Calculate cost for a request based on token usage.
 * Supports V3.2 cache hit/miss pricing. If cache fields are absent,
 * treats all input tokens as cache miss (backward compatible).
 */
export function calculateCost(usage: {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}): CostBreakdown {
  const {
    prompt_tokens,
    completion_tokens,
    prompt_cache_hit_tokens,
    prompt_cache_miss_tokens,
  } = usage;

  let inputCost: number;
  let cacheHitRatio: number | undefined;
  let cacheSavings: number | undefined;

  if (
    prompt_cache_hit_tokens !== undefined &&
    prompt_cache_miss_tokens !== undefined
  ) {
    // V3.2 cache-aware pricing
    const hitCost =
      (prompt_cache_hit_tokens / 1_000_000) * PRICING.cache_hit;
    const missCost =
      (prompt_cache_miss_tokens / 1_000_000) * PRICING.cache_miss;
    inputCost = hitCost + missCost;

    if (prompt_tokens > 0) {
      cacheHitRatio = prompt_cache_hit_tokens / prompt_tokens;
    }

    // Savings = what all-miss would cost minus actual cost
    const allMissCost = (prompt_tokens / 1_000_000) * PRICING.cache_miss;
    cacheSavings = allMissCost - inputCost;
  } else {
    // Backward compatible: treat all input as cache miss
    inputCost = (prompt_tokens / 1_000_000) * PRICING.cache_miss;
  }

  const outputCost = (completion_tokens / 1_000_000) * PRICING.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    cacheHitRatio,
    cacheSavings,
  };
}

/**
 * Format cost as readable USD string with optional cache savings info
 */
export function formatCost(breakdown: CostBreakdown): string {
  const cost = breakdown.totalCost;
  let formatted: string;

  if (cost < 0.01) {
    formatted = `$${cost.toFixed(4)}`;
  } else {
    formatted = `$${cost.toFixed(2)}`;
  }

  if (
    breakdown.cacheHitRatio !== undefined &&
    breakdown.cacheHitRatio > 0 &&
    breakdown.cacheSavings !== undefined &&
    breakdown.cacheSavings > 0
  ) {
    const pct = Math.round(breakdown.cacheHitRatio * 100);
    formatted += ` (cache hit: ${pct}%, saved ~$${breakdown.cacheSavings.toFixed(4)})`;
  }

  return formatted;
}
