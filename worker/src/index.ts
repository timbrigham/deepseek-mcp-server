/**
 * DeepSeek MCP Server — Cloudflare Worker
 * Stateless Streamable HTTP transport with BYOK (Bring Your Own Key)
 *
 * Users send their own DeepSeek API key as Bearer token.
 * The worker proxies MCP requests to DeepSeek API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const VERSION = '1.5.0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// Pricing per 1M tokens (DeepSeek V3.2 unified)
const PRICING = {
  cacheHit: 0.028,
  cacheMiss: 0.28,
  output: 0.42,
};

interface Env {}

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function calculateCost(usage: Record<string, number>): { totalCost: number; formatted: string } {
  const cacheHit = usage.prompt_cache_hit_tokens || 0;
  const cacheMiss = usage.prompt_cache_miss_tokens || usage.prompt_tokens || 0;
  const output = usage.completion_tokens || 0;

  const totalCost =
    (cacheHit * PRICING.cacheHit) / 1_000_000 +
    (cacheMiss * PRICING.cacheMiss) / 1_000_000 +
    (output * PRICING.output) / 1_000_000;

  let formatted = `$${totalCost.toFixed(6)}`;
  if (cacheHit > 0) {
    const ratio = ((cacheHit / (cacheHit + cacheMiss)) * 100).toFixed(0);
    formatted += ` (cache hit: ${ratio}%)`;
  }
  return { totalCost, formatted };
}

function createMcpServer(apiKey: string): McpServer {
  const server = new McpServer({ name: 'deepseek-mcp-server', version: VERSION });

  server.tool(
    'deepseek_chat',
    'Chat with DeepSeek AI models (Chat + Reasoner). Supports function calling, thinking mode, JSON output, cost tracking.',
    {
      messages: z
        .array(
          z.object({
            role: z.enum(['system', 'user', 'assistant', 'tool']),
            content: z.string(),
            tool_call_id: z.string().optional(),
          })
        )
        .min(1)
        .describe('Conversation messages'),
      model: z
        .enum(['deepseek-chat', 'deepseek-reasoner'])
        .default('deepseek-chat')
        .describe('Model to use'),
      temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2)'),
      max_tokens: z.number().min(1).max(65536).optional().describe('Max tokens to generate'),
      stream: z.boolean().default(false).describe('Enable streaming (accumulated response returned)'),
      tools: z
        .array(
          z.object({
            type: z.literal('function'),
            function: z.object({
              name: z.string().min(1),
              description: z.string().optional(),
              parameters: z.record(z.string(), z.unknown()).optional(),
            }),
          })
        )
        .max(128)
        .optional()
        .describe('Tool definitions for function calling'),
      tool_choice: z
        .union([
          z.enum(['auto', 'none', 'required']),
          z.object({
            type: z.literal('function'),
            function: z.object({ name: z.string().min(1) }),
          }),
        ])
        .optional()
        .describe('Tool choice control'),
      thinking: z
        .object({ type: z.enum(['enabled', 'disabled']) })
        .optional()
        .describe('Enable thinking mode'),
      json_mode: z.boolean().optional().describe('Enable JSON output mode'),
    },
    async (params) => {
      try {
        // Build DeepSeek API request body
        const body: Record<string, unknown> = {
          model: params.model,
          messages: params.messages,
          stream: false,
        };
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.max_tokens !== undefined) body.max_tokens = params.max_tokens;
        if (params.tools) body.tools = params.tools;
        if (params.tool_choice) body.tool_choice = params.tool_choice;
        if (params.thinking) body.thinking = params.thinking;
        if (params.json_mode) body.response_format = { type: 'json_object' };

        const apiResponse = await fetch(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!apiResponse.ok) {
          const errText = await apiResponse.text();
          return {
            content: [{ type: 'text' as const, text: `DeepSeek API Error (${apiResponse.status}): ${errText}` }],
            isError: true,
          };
        }

        const data = (await apiResponse.json()) as Record<string, any>;
        const choice = data.choices?.[0];
        const message = choice?.message;
        const usage = data.usage || {};
        const cost = calculateCost(usage);

        // Format response text
        let text = '';
        if (message?.reasoning_content) {
          text += `<thinking>\n${message.reasoning_content}\n</thinking>\n\n`;
        }
        text += message?.content || '';

        if (message?.tool_calls?.length) {
          text += '\n\n**Function Calls:**\n';
          for (const tc of message.tool_calls) {
            text += `\`${tc.function.name}\`\n`;
            text += `- Call ID: ${tc.id}\n`;
            text += `- Arguments: ${tc.function.arguments}\n\n`;
          }
        }

        text += `\n---\n**Request Info:**\n`;
        text += `- **Tokens:** ${usage.total_tokens || 0} (${usage.prompt_tokens || 0} prompt + ${usage.completion_tokens || 0} completion)\n`;
        text += `- **Model:** ${data.model}\n`;
        text += `- **Cost:** ${cost.formatted}`;

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            content: message?.content || '',
            reasoning_content: message?.reasoning_content,
            model: data.model,
            usage,
            finish_reason: choice?.finish_reason,
            tool_calls: message?.tool_calls,
            cost_usd: parseFloat(cost.totalCost.toFixed(6)),
          } as unknown as Record<string, unknown>,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
        },
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        version: VERSION,
        transport: 'cloudflare-workers',
        timestamp: new Date().toISOString(),
      });
    }

    // Root — info page
    if (url.pathname === '/' && request.method === 'GET') {
      return Response.json({
        name: 'deepseek-mcp-server',
        version: VERSION,
        description: 'MCP server for DeepSeek AI models — BYOK (Bring Your Own Key)',
        endpoints: { mcp: '/mcp', health: '/health' },
        auth: 'Send your DeepSeek API key as Authorization: Bearer <key>',
        docs: 'https://github.com/arikusi/deepseek-mcp-server',
      });
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      // BYOK: require API key
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          { error: 'Authorization required. Send your DeepSeek API key as: Authorization: Bearer <key>' },
          { status: 401 }
        );
      }

      // Stateless: create fresh server + transport per request
      const server = createMcpServer(apiKey);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);

      const response = await transport.handleRequest(request);

      // Add CORS headers
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  },
};
