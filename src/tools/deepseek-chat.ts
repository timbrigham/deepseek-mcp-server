/**
 * Tool: deepseek_chat
 * Chat completion with DeepSeek models (V3.2)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { calculateCost, formatCost } from '../cost.js';
import {
  ExtendedMessageSchema,
  ChatInputWithToolsSchema,
  ToolDefinitionSchema,
  ToolChoiceSchema,
  ThinkingSchema,
} from '../schemas.js';
import type { DeepSeekClient } from '../deepseek-client.js';
import type { DeepSeekChatInput } from '../types.js';
import { getErrorMessage } from '../types.js';

/** Maximum allowed message content length (from config) */
function validateMessageLength(input: DeepSeekChatInput): void {
  const maxLen = getConfig().maxMessageLength;
  for (const msg of input.messages) {
    if (msg.content.length > maxLen) {
      throw new Error(
        `Message content exceeds maximum length of ${maxLen} characters`
      );
    }
  }
}

export function registerChatTool(server: McpServer, client: DeepSeekClient): void {
  server.registerTool(
    'deepseek_chat',
    {
      title: 'DeepSeek Chat Completion',
      description:
        'Chat with DeepSeek V3.2 AI models. Supports deepseek-chat for general conversations and ' +
        'deepseek-reasoner for complex reasoning tasks with chain-of-thought explanations. ' +
        'Features: function calling (tools parameter), thinking mode for enhanced reasoning, ' +
        'JSON output mode, and automatic cost tracking with cache hit/miss breakdown.',
      inputSchema: {
        messages: z
          .array(ExtendedMessageSchema)
          .min(1)
          .describe(
            'Array of conversation messages. Each message has role (system/user/assistant/tool) and content. Tool messages require tool_call_id.'
          ),
        model: z
          .enum(['deepseek-chat', 'deepseek-reasoner'])
          .default('deepseek-chat')
          .describe(
            'Model to use. Both run DeepSeek V3.2 (128K context). deepseek-chat: non-thinking mode (max 8K output), deepseek-reasoner: thinking mode (max 64K output)'
          ),
        temperature: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe('Sampling temperature (0-2). Higher = more random. Default: 1.0. Ignored when thinking mode is enabled.'),
        max_tokens: z
          .number()
          .min(1)
          .max(65536)
          .optional()
          .describe('Maximum tokens to generate. deepseek-chat: max 8192, deepseek-reasoner: max 65536'),
        stream: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Enable streaming mode. Returns full response after streaming completes.'
          ),
        tools: z
          .array(ToolDefinitionSchema)
          .max(128)
          .optional()
          .describe(
            'Array of tool definitions for function calling. Each tool has type "function" and a function object with name, description, and parameters (JSON Schema).'
          ),
        tool_choice: ToolChoiceSchema.optional().describe(
          'Controls which tool the model calls. "auto" (default), "none", "required", or {type:"function",function:{name:"..."}}'
        ),
        thinking: ThinkingSchema.describe(
          'Enable thinking mode for enhanced reasoning. When enabled, temperature/top_p/frequency_penalty/presence_penalty are automatically ignored. Use {type: "enabled"} to activate.'
        ),
        json_mode: z
          .boolean()
          .optional()
          .describe(
            'Enable JSON output mode. The model will output valid JSON. Include the word "json" in your prompt for best results. Supported by both models.'
          ),
      },
      outputSchema: {
        content: z.string(),
        reasoning_content: z.string().optional(),
        model: z.string(),
        usage: z.object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
          prompt_cache_hit_tokens: z.number().optional(),
          prompt_cache_miss_tokens: z.number().optional(),
        }),
        finish_reason: z.string(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              type: z.literal('function'),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            })
          )
          .optional(),
      },
    },
    async (input: DeepSeekChatInput) => {
      try {
        // Validate message content length
        validateMessageLength(input);

        // Validate input with extended schema (supports tools)
        const validated = ChatInputWithToolsSchema.parse(input);

        // JSON mode guard: warn if "json" word is not in any message content
        if (validated.json_mode) {
          const hasJsonWord = validated.messages.some((m) =>
            m.content.toLowerCase().includes('json')
          );
          if (!hasJsonWord) {
            console.error(
              '[DeepSeek MCP] Warning: json_mode enabled but no "json" word found in messages. Results may be unreliable.'
            );
          }
        }

        // Model-aware max_tokens warnings
        if (validated.max_tokens) {
          if (validated.model === 'deepseek-chat' && validated.max_tokens > 8192) {
            console.error(
              `[DeepSeek MCP] Warning: deepseek-chat max output is 8192 tokens, requested ${validated.max_tokens}. API may truncate.`
            );
          }
          if (validated.model === 'deepseek-reasoner' && validated.max_tokens > 65536) {
            console.error(
              `[DeepSeek MCP] Warning: deepseek-reasoner max output is 65536 tokens, requested ${validated.max_tokens}. API may truncate.`
            );
          }
        }

        console.error(
          `[DeepSeek MCP] Request: model=${validated.model}, messages=${validated.messages.length}, stream=${validated.stream}${validated.tools ? `, tools=${validated.tools.length}` : ''}${validated.thinking ? `, thinking=${validated.thinking.type}` : ''}${validated.json_mode ? ', json_mode=true' : ''}`
        );

        // Build params for client
        const clientParams = {
          model: validated.model,
          messages: validated.messages,
          temperature: validated.temperature,
          max_tokens: validated.max_tokens,
          tools: validated.tools,
          tool_choice: validated.tool_choice,
          thinking: validated.thinking,
          response_format: validated.json_mode
            ? ({ type: 'json_object' } as const)
            : undefined,
        };

        // Call appropriate method based on stream parameter
        const response = validated.stream
          ? await client.createStreamingChatCompletion(clientParams)
          : await client.createChatCompletion(clientParams);

        console.error(
          `[DeepSeek MCP] Response: tokens=${response.usage.total_tokens}, finish_reason=${response.finish_reason}${response.tool_calls ? `, tool_calls=${response.tool_calls.length}` : ''}`
        );

        // Format response
        let responseText = '';

        // Add reasoning content if available (for deepseek-reasoner)
        if (response.reasoning_content) {
          responseText += `<thinking>\n${response.reasoning_content}\n</thinking>\n\n`;
        }

        responseText += response.content;

        // Format tool calls if present
        if (response.tool_calls?.length) {
          responseText += '\n\n**Function Calls:**\n';
          for (const tc of response.tool_calls) {
            responseText += `\`${tc.function.name}\`\n`;
            responseText += `- Call ID: ${tc.id}\n`;
            responseText += `- Arguments: ${tc.function.arguments}\n\n`;
          }
        }

        // Calculate cost
        const costBreakdown = calculateCost(response.usage);

        // Add usage stats with cost information (controlled by config)
        if (getConfig().showCostInfo) {
          responseText += `\n---\n**Request Information:**\n`;
          responseText += `- **Tokens:** ${response.usage.total_tokens} (${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion)\n`;
          responseText += `- **Model:** ${response.model}\n`;
          responseText += `- **Cost:** ${formatCost(costBreakdown)}`;
          if (response.tool_calls?.length) {
            responseText += `\n- **Tool Calls:** ${response.tool_calls.length}`;
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
          structuredContent: {
            ...response,
            cost_usd: parseFloat(costBreakdown.totalCost.toFixed(6)),
          } as unknown as Record<string, unknown>,
        };
      } catch (error: unknown) {
        console.error('[DeepSeek MCP] Error:', error);
        const errorMessage = getErrorMessage(error);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
