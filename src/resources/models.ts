/**
 * Resource: deepseek://models
 * Static resource listing available DeepSeek models with capabilities and pricing
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PRICING } from '../cost.js';

const MODELS_DATA = {
  models: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek Chat (V3.2)',
      description: 'General-purpose chat model with function calling support',
      context_length: 131072,
      max_output_tokens: 8192,
      capabilities: [
        'chat',
        'function_calling',
        'json_mode',
        'thinking_mode',
      ],
      pricing_per_million_tokens: {
        input_cache_hit: PRICING.cache_hit,
        input_cache_miss: PRICING.cache_miss,
        output: PRICING.output,
      },
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner (V3.2)',
      description:
        'Advanced reasoning model with chain-of-thought explanations',
      context_length: 131072,
      max_output_tokens: 65536,
      capabilities: [
        'chat',
        'reasoning',
        'chain_of_thought',
        'json_mode',
        'thinking_mode',
      ],
      pricing_per_million_tokens: {
        input_cache_hit: PRICING.cache_hit,
        input_cache_miss: PRICING.cache_miss,
        output: PRICING.output,
      },
    },
  ],
};

export function registerModelsResource(server: McpServer): void {
  server.registerResource(
    'models',
    'deepseek://models',
    {
      title: 'DeepSeek Models',
      description:
        'List of available DeepSeek models with capabilities, context limits, and pricing information',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(MODELS_DATA, null, 2),
        },
      ],
    })
  );
}
