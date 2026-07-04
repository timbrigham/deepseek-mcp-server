/**
 * Tool: deepseek_chat
 * Chat completion with DeepSeek AI models
 * Supports multi-turn conversations via session_id
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
  ReasoningEffortSchema,
  ContentSchema,
} from '../schemas.js';
import type { DeepSeekClient } from '../deepseek-client.js';
import type { ChatMessage, DeepSeekChatInput } from '../types.js';
import { getErrorMessage, getTextContent } from '../types.js';
import type { SessionStore } from '../session.js';
import { UsageTracker } from '../usage-tracker.js';
import { extractJson } from '../json-extract.js';

/** Input type extended with session_id */
interface DeepSeekChatInputWithSession extends DeepSeekChatInput {
  session_id?: string;
}

/** Maximum allowed message content length (from config) */
function validateMessageLength(input: DeepSeekChatInput): void {
  const maxLen = getConfig().maxMessageLength;
  for (const msg of input.messages) {
    const textLen = getTextContent(msg.content).length;
    if (textLen > maxLen) {
      throw new Error(
        `Message content exceeds maximum length of ${maxLen} characters`
      );
    }
  }
}

export function registerChatTool(
  server: McpServer,
  client: DeepSeekClient,
  sessionStore: SessionStore
): void {
  // Use config's defaultModel if it's a recognized model name, else v4-flash
  const cfg = getConfig();
  const KNOWN_MODELS = [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'deepseek-chat',
    'deepseek-reasoner',
  ] as const;
  type KnownModel = (typeof KNOWN_MODELS)[number];
  const modelDefault: KnownModel = (KNOWN_MODELS as readonly string[]).includes(
    cfg.defaultModel
  )
    ? (cfg.defaultModel as KnownModel)
    : 'deepseek-v4-flash';

  server.registerTool(
    'deepseek_chat',
    {
      title: 'DeepSeek Chat Completion',
      description:
        'Chat with DeepSeek V4 models. deepseek-v4-flash (fast, economical) and deepseek-v4-pro (most capable), ' +
        'both 1M context with optional chain-of-thought thinking mode. deepseek-chat and deepseek-reasoner are ' +
        'accepted as backward-compatible aliases (resolve to v4-flash). ' +
        'Features: multi-turn sessions (session_id), function calling (tools parameter), thinking mode, ' +
        'JSON output mode, multimodal input (when enabled), automatic cost tracking, and model fallback with circuit breaker resilience.',
      inputSchema: {
        messages: z
          .array(ExtendedMessageSchema)
          .min(1)
          .describe(
            'Array of conversation messages. Each message has role (system/user/assistant/tool) and content (string or array of content parts for multimodal). Tool messages require tool_call_id.'
          ),
        model: z
          .enum([
            'deepseek-v4-flash',
            'deepseek-v4-pro',
            'deepseek-chat',
            'deepseek-reasoner',
          ])
          .default(modelDefault)
          .describe(
            'Model to use. deepseek-v4-flash (default, fast/economical) or deepseek-v4-pro (most capable), both 1M context, up to 384K output. ' +
            'Non-thinking by default for speed; pass thinking:{type:"enabled"} to reason. ' +
            'Aliases: deepseek-chat -> v4-flash non-thinking, deepseek-reasoner -> v4-flash thinking.'
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
          .max(384000)
          .optional()
          .describe('Maximum tokens to generate. V4 models support up to 384000 output tokens.'),
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
          'Toggle chain-of-thought thinking mode. Use {type: "enabled"} to reason, {type: "disabled"} for a fast direct answer (the default here). When enabled, temperature/top_p are ignored.'
        ),
        reasoning_effort: ReasoningEffortSchema.describe(
          'Reasoning effort while thinking mode is active: "high" (default) or "max". Only applies when thinking is enabled.'
        ),
        json_mode: z
          .boolean()
          .optional()
          .describe(
            'Enable JSON output mode. The model will output valid JSON. Include the word "json" in your prompt for best results. Supported by both models.'
          ),
        session_id: z
          .string()
          .optional()
          .describe(
            'Session ID for multi-turn conversations. When provided, previous messages from this session are prepended to the current messages. ' +
            'If the session does not exist, it is created automatically. Omit for stateless single-turn requests.'
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
        // Self-contained per-request usage + cost summary (P3). Everything a
        // consumer needs for cost accounting in one object, so it never has to
        // reassemble scattered siblings or scrape the human-readable text.
        request: z.object({
          model: z.string(),
          wire_model: z.string(),
          thinking: z.boolean(),
          temperature: z.number().optional(),
          fallback_used: z.boolean(),
          finish_reason: z.string(),
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
          cache_hit_tokens: z.number(),
          cache_miss_tokens: z.number(),
          cost_usd: z.number(),
        }),
        // Present only when a model fallback fired (P5): surfaces the silent
        // switch so a gate run can flag or discard it.
        fallback: z
          .object({
            originalModel: z.string(),
            fallbackModel: z.string(),
            reason: z.string(),
          })
          .optional(),
        // Raw effective request the client actually sent (P5 audit).
        effective: z
          .object({
            model: z.string(),
            thinking: z.boolean(),
            temperature: z.number().optional(),
          })
          .optional(),
        finish_reason: z.string(),
        // Set only when json_mode was requested but the content could not be
        // recovered as valid JSON; carries the JSON.parse error message.
        json_parse_error: z.string().optional(),
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
        cost_usd: z.number().optional(),
        routed_from: z.string().optional(),
        session_id: z.string().optional(),
      },
    },
    async (input: DeepSeekChatInputWithSession) => {
      try {
        // Validate message content length
        validateMessageLength(input);

        // Validate input with extended schema (supports tools + session_id)
        const validated = ChatInputWithToolsSchema.parse(input);

        // Multimodal guard: reject array content when multimodal is disabled
        if (!getConfig().enableMultimodal) {
          for (const msg of validated.messages) {
            if (Array.isArray(msg.content)) {
              throw new Error(
                'Multimodal content (image/array) is not enabled. Set ENABLE_MULTIMODAL=true to use multimodal input.'
              );
            }
          }
        }

        // JSON mode guard: warn if "json" word is not in any message content
        if (validated.json_mode) {
          const hasJsonWord = validated.messages.some((m) =>
            getTextContent(m.content).toLowerCase().includes('json')
          );
          if (!hasJsonWord) {
            console.error(
              '[DeepSeek MCP] Warning: json_mode enabled but no "json" word found in messages. Results may be unreliable.'
            );
          }
        }

        // Session management: build full message list
        let allMessages: ChatMessage[] = validated.messages;

        if (validated.session_id) {
          // Create or get session
          const session = sessionStore.create(validated.session_id);
          // Prepend previous session messages to current messages
          const previousMessages = sessionStore.getMessages(validated.session_id);
          allMessages = [...previousMessages, ...validated.messages];

          console.error(
            `[DeepSeek MCP] Session: id=${validated.session_id}, previous_messages=${previousMessages.length}, total_messages=${allMessages.length}`
          );
        }

        // Track if reasoner was selected (routing happens in deepseek-client)
        const isReasonerRouted = validated.model === 'deepseek-reasoner';

        console.error(
          `[DeepSeek MCP] Request: model=${validated.model}, messages=${allMessages.length}, stream=${validated.stream}${validated.tools ? `, tools=${validated.tools.length}` : ''}${validated.thinking ? `, thinking=${validated.thinking.type}` : ''}${validated.json_mode ? ', json_mode=true' : ''}${validated.session_id ? `, session=${validated.session_id}` : ''}`
        );

        // Build params for client
        const clientParams = {
          model: validated.model,
          messages: allMessages,
          temperature: validated.temperature,
          max_tokens: validated.max_tokens,
          tools: validated.tools,
          tool_choice: validated.tool_choice,
          thinking: validated.thinking,
          reasoning_effort: validated.reasoning_effort,
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

        // Calculate cost (model-aware pricing)
        const costBreakdown = calculateCost(response.usage, response.model);

        // JSON mode (P1): recover a clean JSON value from content. Handles
        // fenced/prefixed/trailing output that leaks in under thinking mode,
        // where the API's own reasoning/content split isn't enough. Purely
        // local — no extra API call — so temp=0 reproducibility is preserved.
        let jsonParseError: string | undefined;
        let effectiveContent = response.content;
        if (validated.json_mode) {
          const extracted = extractJson(response.content);
          if (extracted.ok) {
            effectiveContent = extracted.text;
          } else {
            jsonParseError = extracted.error;
            console.error(
              `[DeepSeek MCP] json_mode: could not recover valid JSON from content (${extracted.error})`
            );
          }
        }

        // Self-contained per-request usage + cost summary (P3). Cache split is
        // derived the same way cost.ts does it: absent hit/miss fields mean the
        // whole prompt was billed as a cache miss.
        const cacheHitTokens = response.usage.prompt_cache_hit_tokens ?? 0;
        const cacheMissTokens =
          response.usage.prompt_cache_miss_tokens ??
          response.usage.prompt_tokens - cacheHitTokens;
        const requestInfo = {
          model: response.model,
          // Audit fields (P5): exactly what answered, so a gate can detect a
          // silent fallback to a weaker model or a thinking-mode mismatch.
          wire_model: response.effective?.model ?? response.model,
          thinking: response.effective?.thinking ?? false,
          temperature: response.effective?.temperature,
          fallback_used: response.fallback !== undefined,
          finish_reason: response.finish_reason,
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
          cache_hit_tokens: cacheHitTokens,
          cache_miss_tokens: cacheMissTokens,
          cost_usd: parseFloat(costBreakdown.totalCost.toFixed(6)),
        };

        // Update session with new messages and response
        if (validated.session_id) {
          const session = sessionStore.get(validated.session_id);
          if (session) {
            // Add the new user messages to session
            sessionStore.addMessages(validated.session_id, validated.messages);
            // Add assistant response to session (include tool_calls for multi-turn function calling)
            sessionStore.addMessages(validated.session_id, [
              {
                role: 'assistant',
                content: effectiveContent,
                ...(response.tool_calls ? { tool_calls: response.tool_calls } : {}),
              },
            ]);
            session.totalCost += costBreakdown.totalCost;
            session.requestCount++;
          }
        }

        // Track usage globally
        UsageTracker.getInstance().trackRequest(response.usage, costBreakdown.totalCost);

        // Format response
        let responseText = '';

        // Add reasoning content if available (for deepseek-reasoner)
        if (response.reasoning_content) {
          responseText += `<thinking>\n${response.reasoning_content}\n</thinking>\n\n`;
        }

        responseText += effectiveContent;

        // Format tool calls if present
        if (response.tool_calls?.length) {
          responseText += '\n\n**Function Calls:**\n';
          for (const tc of response.tool_calls) {
            responseText += `\`${tc.function.name}\`\n`;
            responseText += `- Call ID: ${tc.id}\n`;
            responseText += `- Arguments: ${tc.function.arguments}\n\n`;
          }
        }

        // Add usage stats with cost information (controlled by config)
        if (getConfig().showCostInfo) {
          responseText += `\n---\n**Request Information:**\n`;
          responseText += `- **Tokens:** ${response.usage.total_tokens} (${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion)\n`;
          responseText += `- **Model:** ${response.model}\n`;
          responseText += `- **Cost:** ${formatCost(costBreakdown)}`;
          if (isReasonerRouted) {
            responseText += `\n- **Routed:** deepseek-reasoner -> deepseek-v4-flash + thinking`;
          }
          if (response.fallback) {
            responseText += `\n- **Fallback:** ${response.fallback.originalModel} -> ${response.fallback.fallbackModel} (${response.fallback.reason})`;
          }
          if (response.tool_calls?.length) {
            responseText += `\n- **Tool Calls:** ${response.tool_calls.length}`;
          }
          if (validated.session_id) {
            const session = sessionStore.get(validated.session_id);
            if (session) {
              responseText += `\n- **Session:** ${validated.session_id} (${session.messages.length} messages, ${session.requestCount} requests, $${session.totalCost.toFixed(4)} total)`;
            }
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
            content: effectiveContent,
            request: requestInfo,
            ...(isReasonerRouted ? { routed_from: 'deepseek-reasoner' } : {}),
            cost_usd: requestInfo.cost_usd,
            ...(jsonParseError ? { json_parse_error: jsonParseError } : {}),
            ...(validated.session_id ? { session_id: validated.session_id } : {}),
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
