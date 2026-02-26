import { describe, it, expect } from 'vitest';
import { calculateCost, formatCost, PRICING } from './cost.js';

describe('cost', () => {
  describe('PRICING', () => {
    it('should have V3.2 unified pricing', () => {
      expect(PRICING.cache_hit).toBe(0.028);
      expect(PRICING.cache_miss).toBe(0.28);
      expect(PRICING.output).toBe(0.42);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost without cache fields (backward compat)', () => {
      const result = calculateCost({
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
      });
      // 1M input * $0.28/1M + 1M output * $0.42/1M = $0.70
      expect(result.inputCost).toBeCloseTo(0.28);
      expect(result.outputCost).toBeCloseTo(0.42);
      expect(result.totalCost).toBeCloseTo(0.70);
      expect(result.cacheHitRatio).toBeUndefined();
      expect(result.cacheSavings).toBeUndefined();
    });

    it('should calculate cost with cache hit/miss fields', () => {
      const result = calculateCost({
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        prompt_cache_hit_tokens: 800_000,
        prompt_cache_miss_tokens: 200_000,
      });
      // Hit: 800K * $0.028/1M = $0.0224
      // Miss: 200K * $0.28/1M = $0.056
      // Input: $0.0784
      // Output: 1M * $0.42/1M = $0.42
      expect(result.inputCost).toBeCloseTo(0.0784);
      expect(result.outputCost).toBeCloseTo(0.42);
      expect(result.totalCost).toBeCloseTo(0.4984);
      expect(result.cacheHitRatio).toBeCloseTo(0.8);
      // Savings: all-miss ($0.28) - actual ($0.0784) = $0.2016
      expect(result.cacheSavings).toBeCloseTo(0.2016);
    });

    it('should calculate cost for smaller token counts', () => {
      const result = calculateCost({
        prompt_tokens: 1000,
        completion_tokens: 500,
      });
      const expectedInput = (1000 / 1_000_000) * 0.28;
      const expectedOutput = (500 / 1_000_000) * 0.42;
      expect(result.totalCost).toBeCloseTo(expectedInput + expectedOutput);
    });

    it('should return 0 for zero tokens', () => {
      const result = calculateCost({
        prompt_tokens: 0,
        completion_tokens: 0,
      });
      expect(result.totalCost).toBe(0);
    });

    it('should handle only prompt tokens', () => {
      const result = calculateCost({
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
      });
      expect(result.totalCost).toBeCloseTo(0.28);
    });

    it('should handle only completion tokens', () => {
      const result = calculateCost({
        prompt_tokens: 0,
        completion_tokens: 1_000_000,
      });
      expect(result.totalCost).toBeCloseTo(0.42);
    });

    it('should handle 100% cache hit', () => {
      const result = calculateCost({
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        prompt_cache_hit_tokens: 1_000_000,
        prompt_cache_miss_tokens: 0,
      });
      // All cache hit: 1M * $0.028/1M = $0.028
      expect(result.inputCost).toBeCloseTo(0.028);
      expect(result.cacheHitRatio).toBeCloseTo(1.0);
      // Savings: $0.28 - $0.028 = $0.252
      expect(result.cacheSavings).toBeCloseTo(0.252);
    });

    it('should handle 0% cache hit', () => {
      const result = calculateCost({
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1_000_000,
      });
      // All cache miss: 1M * $0.28/1M = $0.28
      expect(result.inputCost).toBeCloseTo(0.28);
      expect(result.cacheHitRatio).toBeCloseTo(0);
      expect(result.cacheSavings).toBeCloseTo(0);
    });

    it('should handle zero prompt tokens with cache fields', () => {
      const result = calculateCost({
        prompt_tokens: 0,
        completion_tokens: 500,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 0,
      });
      expect(result.inputCost).toBe(0);
      expect(result.cacheHitRatio).toBeUndefined();
    });
  });

  describe('formatCost', () => {
    it('should format small values with 4 decimal places', () => {
      expect(formatCost({ inputCost: 0, outputCost: 0.001, totalCost: 0.001 })).toBe('$0.0010');
      expect(formatCost({ inputCost: 0, outputCost: 0.0001, totalCost: 0.0001 })).toBe('$0.0001');
    });

    it('should format large values with 2 decimal places', () => {
      expect(formatCost({ inputCost: 0.5, outputCost: 1.0, totalCost: 1.5 })).toBe('$1.50');
      expect(formatCost({ inputCost: 0.28, outputCost: 0.42, totalCost: 0.70 })).toBe('$0.70');
    });

    it('should format zero as small value', () => {
      expect(formatCost({ inputCost: 0, outputCost: 0, totalCost: 0 })).toBe('$0.0000');
    });

    it('should format boundary value (0.01) with 2 decimals', () => {
      expect(formatCost({ inputCost: 0, outputCost: 0.01, totalCost: 0.01 })).toBe('$0.01');
    });

    it('should format values just below boundary with 4 decimals', () => {
      expect(formatCost({ inputCost: 0, outputCost: 0.0099, totalCost: 0.0099 })).toBe('$0.0099');
    });

    it('should show cache savings when available', () => {
      const result = formatCost({
        inputCost: 0.0784,
        outputCost: 0.42,
        totalCost: 0.4984,
        cacheHitRatio: 0.8,
        cacheSavings: 0.2016,
      });
      expect(result).toBe('$0.50 (cache hit: 80%, saved ~$0.2016)');
    });

    it('should not show cache info when ratio is 0', () => {
      const result = formatCost({
        inputCost: 0.28,
        outputCost: 0.42,
        totalCost: 0.70,
        cacheHitRatio: 0,
        cacheSavings: 0,
      });
      expect(result).toBe('$0.70');
    });

    it('should not show cache info when fields are undefined', () => {
      const result = formatCost({
        inputCost: 0.28,
        outputCost: 0.42,
        totalCost: 0.70,
      });
      expect(result).toBe('$0.70');
    });
  });
});
