/**
 * DeepSeek API Client
 * Wrapper around OpenAI SDK for DeepSeek API
 * Features: circuit breaker protection, automatic model fallback
 */

import OpenAI from 'openai';
import { getConfig } from './config.js';
import {
  ApiError,
  CircuitBreakerOpenError,
  FallbackExhaustedError,
} from './errors.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type {
  ChatCompletionParams,
  ChatCompletionResponse,
  DeepSeekModel,
  DeepSeekRawResponse,
  DeepSeekStreamChunk,
  FallbackInfo,
  ToolCall,
} from './types.js';
import { hasReasoningContent, getErrorMessage } from './types.js';

/** Parameters that are incompatible with thinking mode */
const THINKING_INCOMPATIBLE_PARAMS = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
] as const;

/** Fallback model mapping */
const FALLBACK_MODEL: Record<DeepSeekModel, DeepSeekModel> = {
  'deepseek-reasoner': 'deepseek-chat',
  'deepseek-chat': 'deepseek-reasoner',
};

/** Extended response with optional fallback info */
export interface ChatCompletionResponseWithFallback extends ChatCompletionResponse {
  fallback?: FallbackInfo;
}

/**
 * Check if an error is retryable / should trigger fallback
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof CircuitBreakerOpenError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit, server errors, timeouts
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('503') || msg.includes('service unavailable')) return true;
    if (msg.includes('502') || msg.includes('bad gateway')) return true;
    if (msg.includes('timeout') || msg.includes('timed out')) return true;
    if (msg.includes('econnrefused') || msg.includes('econnreset')) return true;
  }
  // OpenAI SDK errors with status code
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 429 || status === 502 || status === 503) return true;
  }
  return false;
}

export class DeepSeekClient {
  private client: OpenAI;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    const config = getConfig();

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.requestTimeout,
      maxRetries: config.maxRetries,
    });

    this.circuitBreaker = new CircuitBreaker(5, 30000);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }

  /**
   * Build request params shared between streaming and non-streaming
   */
  private buildRequestParams(
    params: ChatCompletionParams,
    stream: boolean
  ): OpenAI.ChatCompletionCreateParams & { extra_body?: Record<string, unknown> } {
    const isThinkingEnabled = params.thinking?.type === 'enabled';

    // Filter incompatible params when thinking mode is active
    if (isThinkingEnabled) {
      const filtered: string[] = [];
      for (const key of THINKING_INCOMPATIBLE_PARAMS) {
        if (params[key] !== undefined) {
          filtered.push(key);
        }
      }
      if (filtered.length > 0) {
        console.error(
          `[DeepSeek MCP] Warning: Thinking mode active, ignoring incompatible params: ${filtered.join(', ')}`
        );
      }
    }

    const requestParams: OpenAI.ChatCompletionCreateParams & { extra_body?: Record<string, unknown> } = {
      model: params.model,
      messages: params.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: isThinkingEnabled ? undefined : (params.temperature ?? 1.0),
      max_tokens: params.max_tokens,
      top_p: isThinkingEnabled ? undefined : params.top_p,
      frequency_penalty: isThinkingEnabled ? undefined : params.frequency_penalty,
      presence_penalty: isThinkingEnabled ? undefined : params.presence_penalty,
      stop: params.stop,
      stream,
    };

    // Pass thinking config via extra_body (DeepSeek extension)
    if (params.thinking) {
      requestParams.extra_body = {
        ...requestParams.extra_body,
        thinking: params.thinking,
      };
    }

    // Pass response_format for JSON mode
    if (params.response_format) {
      requestParams.response_format = params.response_format as OpenAI.ChatCompletionCreateParams['response_format'];
    }

    if (params.tools?.length) {
      requestParams.tools = params.tools as OpenAI.ChatCompletionTool[];
    }
    if (params.tool_choice !== undefined) {
      requestParams.tool_choice =
        params.tool_choice as OpenAI.ChatCompletionToolChoiceOption;
    }

    return requestParams;
  }

  /**
   * Wrap caught errors with appropriate custom error class
   */
  private wrapError(error: unknown, context: string): never {
    if (error instanceof ApiError) throw error;
    if (error instanceof FallbackExhaustedError) throw error;
    if (error instanceof CircuitBreakerOpenError) throw error;
    const message = getErrorMessage(error);
    const cause = error instanceof Error ? error : undefined;
    throw new ApiError(`${context}: ${message}`, { cause });
  }

  /**
   * Parse raw API response into ChatCompletionResponse
   */
  private parseResponse(response: DeepSeekRawResponse): ChatCompletionResponse {
    const choice = response.choices[0];
    if (!choice) {
      throw new ApiError('No response from DeepSeek API');
    }

    const reasoning_content = hasReasoningContent(choice.message)
      ? choice.message.reasoning_content
      : undefined;

    const tool_calls: ToolCall[] | undefined = choice.message.tool_calls
      ?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice.message.content || '',
      reasoning_content,
      model: response.model,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
        prompt_cache_hit_tokens: response.usage?.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens: response.usage?.prompt_cache_miss_tokens,
      },
      finish_reason: choice.finish_reason || 'stop',
      tool_calls: tool_calls?.length ? tool_calls : undefined,
    };
  }

  /**
   * Create a chat completion (non-streaming) with circuit breaker and fallback
   */
  async createChatCompletion(
    params: ChatCompletionParams
  ): Promise<ChatCompletionResponseWithFallback> {
    const config = getConfig();

    try {
      // Primary attempt through circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        const requestParams = this.buildRequestParams(params, false);
        const rawResponse = await this.client.chat.completions.create(requestParams);
        return this.parseResponse(rawResponse as unknown as DeepSeekRawResponse);
      });
      return result;
    } catch (error: unknown) {
      // Try fallback if enabled and error is retryable
      if (config.fallbackEnabled && isRetryableError(error)) {
        const fallbackModel = FALLBACK_MODEL[params.model];
        const reason = getErrorMessage(error);
        console.error(
          `[DeepSeek MCP] Primary model ${params.model} failed (${reason}), falling back to ${fallbackModel}`
        );

        try {
          const fallbackParams = { ...params, model: fallbackModel };
          // Fallback bypasses circuit breaker (it's a different attempt)
          const requestParams = this.buildRequestParams(fallbackParams, false);
          const rawResponse = await this.client.chat.completions.create(requestParams);
          const result = this.parseResponse(rawResponse as unknown as DeepSeekRawResponse);
          return {
            ...result,
            fallback: {
              originalModel: params.model,
              fallbackModel,
              reason,
            },
          };
        } catch (fallbackError: unknown) {
          console.error(
            `[DeepSeek MCP] Fallback model ${fallbackModel} also failed:`,
            fallbackError
          );
          throw new FallbackExhaustedError(
            `All models failed. Primary (${params.model}): ${reason}. Fallback (${fallbackModel}): ${getErrorMessage(fallbackError)}`,
            [params.model, fallbackModel]
          );
        }
      }

      // Not retryable or fallback disabled
      console.error('DeepSeek API Error:', error);
      this.wrapError(error, 'DeepSeek API Error');
    }
  }

  /**
   * Create a streaming chat completion with circuit breaker and fallback
   * Returns the full text after streaming completes (buffered)
   */
  async createStreamingChatCompletion(
    params: ChatCompletionParams
  ): Promise<ChatCompletionResponseWithFallback> {
    const config = getConfig();

    try {
      const result = await this.circuitBreaker.execute(async () => {
        return this.streamInternal(params);
      });
      return result;
    } catch (error: unknown) {
      if (config.fallbackEnabled && isRetryableError(error)) {
        const fallbackModel = FALLBACK_MODEL[params.model];
        const reason = getErrorMessage(error);
        console.error(
          `[DeepSeek MCP] Streaming primary ${params.model} failed (${reason}), falling back to ${fallbackModel}`
        );

        try {
          const fallbackParams = { ...params, model: fallbackModel };
          const result = await this.streamInternal(fallbackParams);
          return {
            ...result,
            fallback: {
              originalModel: params.model,
              fallbackModel,
              reason,
            },
          };
        } catch (fallbackError: unknown) {
          throw new FallbackExhaustedError(
            `All models failed (streaming). Primary (${params.model}): ${reason}. Fallback (${fallbackModel}): ${getErrorMessage(fallbackError)}`,
            [params.model, fallbackModel]
          );
        }
      }

      console.error('DeepSeek Streaming API Error:', error);
      this.wrapError(error, 'DeepSeek Streaming API Error');
    }
  }

  /**
   * Internal streaming implementation
   */
  private async streamInternal(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
    const requestParams = this.buildRequestParams(params, true);
    const stream = await this.client.chat.completions.create(requestParams);

    let fullContent = '';
    let reasoningContent = '';
    let modelName: string = params.model;
    let finishReason = 'stop';
    let usage: ChatCompletionResponse['usage'] = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    const toolCallsMap = new Map<
      number,
      {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }
    >();

    for await (const rawChunk of stream as AsyncIterable<unknown>) {
      const chunk = rawChunk as DeepSeekStreamChunk;
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        fullContent += choice.delta.content;
      }

      if (choice.delta && hasReasoningContent(choice.delta)) {
        reasoningContent += choice.delta.reasoning_content;
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index);
          if (existing) {
            if (tc.function?.name) existing.function.name += tc.function.name;
            if (tc.function?.arguments)
              existing.function.arguments += tc.function.arguments;
          } else {
            toolCallsMap.set(tc.index, {
              id: tc.id || '',
              type: 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            });
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (chunk.model) {
        modelName = chunk.model;
      }

      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
          prompt_cache_hit_tokens: chunk.usage.prompt_cache_hit_tokens,
          prompt_cache_miss_tokens: chunk.usage.prompt_cache_miss_tokens,
        };
      }
    }

    const toolCalls =
      toolCallsMap.size > 0
        ? Array.from(toolCallsMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => tc)
        : undefined;

    return {
      content: fullContent,
      reasoning_content: reasoningContent || undefined,
      model: modelName as DeepSeekModel,
      usage,
      finish_reason: finishReason,
      tool_calls: toolCalls,
    };
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.createChatCompletion({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });
      return !!response.content;
    } catch (error: unknown) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}
