/**
 * DeepSeek MCP Server Types
 * Type definitions for DeepSeek API integration with Model Context Protocol
 */

/**
 * Supported DeepSeek models
 */
export type DeepSeekModel = 'deepseek-chat' | 'deepseek-reasoner';

/**
 * Message role in conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  tool_call_id?: string;
}

// ─── Function Calling Types ─────────────────────────────────────

/**
 * Function definition within a tool
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  type: 'function';
  function: FunctionDefinition;
}

/**
 * Controls which tool the model calls
 */
export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

/**
 * Tool call returned by the model
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ─── Request/Response Types ─────────────────────────────────────

/**
 * Parameters for chat completion request
 */
export interface ChatCompletionParams {
  model: DeepSeekModel;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  thinking?: { type: 'enabled' | 'disabled' };
  response_format?: { type: 'json_object' };
}

/**
 * Response from DeepSeek chat completion
 */
export interface ChatCompletionResponse {
  content: string;
  reasoning_content?: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  finish_reason: string;
  tool_calls?: ToolCall[];
}

/**
 * Tool input schema for deepseek_chat tool
 */
export interface DeepSeekChatInput {
  messages: Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;
  model?: 'deepseek-chat' | 'deepseek-reasoner';
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    };
  }>;
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };
  thinking?: { type: 'enabled' | 'disabled' };
  json_mode?: boolean;
}

/**
 * Error response structure
 */
export interface DeepSeekError {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

// ─── OpenAI SDK Extension Types (DeepSeek-specific) ────────────

/**
 * DeepSeek chat completion message (extends OpenAI with reasoning_content)
 */
export interface DeepSeekChatCompletionMessage {
  content: string | null;
  role: 'assistant';
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

/**
 * DeepSeek chat completion choice
 */
export interface DeepSeekChatCompletionChoice {
  message: DeepSeekChatCompletionMessage;
  finish_reason: string;
  index: number;
}

/**
 * DeepSeek chat completion response (extends OpenAI response)
 */
export interface DeepSeekRawResponse {
  id: string;
  choices: DeepSeekChatCompletionChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

/**
 * DeepSeek stream delta
 */
export interface DeepSeekStreamDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
}

/**
 * DeepSeek stream chunk
 */
export interface DeepSeekStreamChunk {
  choices: Array<{
    delta: DeepSeekStreamDelta;
    finish_reason: string | null;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

// ─── Session Types ─────────────────────────────────────────────

/**
 * Session data for multi-turn conversations
 */
export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastAccessedAt: number;
  totalCost: number;
  requestCount: number;
}

/**
 * Session info for listing (without full message history)
 */
export interface SessionInfo {
  id: string;
  messageCount: number;
  createdAt: number;
  lastAccessedAt: number;
  totalCost: number;
  requestCount: number;
}

// ─── Circuit Breaker Types ─────────────────────────────────────

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker status info
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
}

// ─── Usage Tracking Types ──────────────────────────────────────

/**
 * Aggregated usage statistics
 */
export interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  activeSessions: number;
}

// ─── Fallback Types ────────────────────────────────────────────

/**
 * Fallback information attached to responses
 */
export interface FallbackInfo {
  originalModel: string;
  fallbackModel: string;
  reason: string;
}

// ─── Type Guards ───────────────────────────────────────────────

/**
 * Check if a message has reasoning_content (DeepSeek Reasoner)
 */
export function hasReasoningContent(
  message: unknown
): message is { reasoning_content: string } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'reasoning_content' in message &&
    typeof (message as Record<string, unknown>).reasoning_content === 'string'
  );
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
