# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-03-07

### Added
- **Remote Endpoint**: Hosted BYOK (Bring Your Own Key) endpoint at `https://deepseek-mcp.tahirl.com/mcp`. Users send their own DeepSeek API key as Bearer token — no server-side key stored.
- **Cloudflare Worker**: Stateless MCP server on Cloudflare Workers edge network. Zero cold start, global distribution, free tier (100K requests/day).
- **Remote Quick Start**: Claude Code, Cursor, Windsurf can connect to the remote endpoint with `--transport http` — no npm install or Node.js required.

### Changed
- README restructured: Remote (no install) as primary quick start, local stdio as secondary.
- server.json: Added streamableHttp transport package for remote endpoint.
- llms.txt/llms-full.txt: Updated with remote endpoint documentation.

## [1.4.3] - 2026-03-07

### Fixed
- **MCP Registry**: Shortened server.json description to meet 100-char limit

## [1.4.2] - 2026-03-07

### Added
- **Streamable HTTP Transport**: New `TRANSPORT=http` mode with Express-based Streamable HTTP server. Per-session McpServer instances with shared DeepSeekClient. Supports POST/GET/DELETE on `/mcp` endpoint and SSE streaming.
- **Health Endpoint**: `GET /health` returns server status, version, uptime, and transport type.
- **Docker Support**: Multi-stage `Dockerfile`, `docker-compose.yml`, and `.dockerignore` for containerized deployment. Default transport is HTTP in Docker.
- **Docker CI**: GitHub Actions job for Docker build smoke test with health endpoint verification.
- **New Config Variables**: `TRANSPORT` (stdio|http, default: stdio), `HTTP_PORT` (default: 3000).
- **253 Tests**: Up from 241, with 12 new tests covering HTTP transport endpoints, config transport/port parsing, and session lifecycle.

### Changed
- Entry point (`index.ts`) now branches on `config.transport` — stdio (default) or HTTP mode.
- CI dist check includes `transport-http.js`.

## [1.4.1] - 2026-03-07

### Added
- **MCP Registry**: `mcpName` for official MCP Registry (registry.modelcontextprotocol.io) publishing
- **Glama Registry**: `glama.json` for glama.ai server listing
- **Smithery Compatibility**: CJS bundler fallback in `server.ts`, `createSandboxServer()` export

### Changed
- **server.json**: Updated to official MCP Registry schema format
- **README**: Added Glama badge

## [1.4.0] - 2026-03-07

### Added
- **Model-Aware Pricing**: `MODEL_PRICING` map with per-model pricing, `getPricing(model?)` helper. `calculateCost()` now accepts optional `model` parameter for accurate per-model cost calculation.
- **Multimodal Content Types**: `TextContentPart`, `ImageContentPart`, `ContentPart` types. Message `content` now supports `string | ContentPart[]` (OpenAI-compatible format).
- **Multimodal Schema Validation**: `ContentPartSchema` (discriminated union), `ContentSchema`, `ExtendedMessageSchema` with array content support.
- **ENABLE_MULTIMODAL Config**: Feature flag (default: `false`) to enable multimodal input. Rejects array content when disabled with clear error message.
- **getTextContent() Helper**: Extracts text from `string | ContentPart[]` for validation and JSON mode checks.
- **MCP Registry Metadata**: `server.json` file for official MCP Registry submission with tools, resources, prompts, and configuration metadata.
- **241 Tests**: Up from 212, with 29 new tests covering model-aware pricing, multimodal schemas, content part validation, getTextContent, multimodal guard, and array content validation.

### Changed
- **Flexible Fallback Chain**: `FALLBACK_ORDER` (Record<string, string[]>) replaces `FALLBACK_MODEL` — supports 3+ model fallback chains for future model additions.
- **Models Resource**: `buildModelsData()` now uses `getPricing()` from cost.ts instead of static pricing constants.
- **Tool Handler**: `calculateCost()` now receives `response.model` for model-aware pricing. `validateMessageLength` uses `getTextContent()` for multimodal content.
- **Config Resource**: Exposes `enableMultimodal` field.

## [1.3.3] - 2026-03-07

### Added
- **Streaming Fallback Tests**: 4 new tests covering streaming fallback success, both-models-fail, non-retryable skip, and disabled fallback scenarios
- **Configurable Circuit Breaker**: `CIRCUIT_BREAKER_THRESHOLD` (default: 5) and `CIRCUIT_BREAKER_RESET_TIMEOUT` (default: 30000ms) environment variables
- **Session Message Limit**: `MAX_SESSION_MESSAGES` (default: 200) environment variable prevents unbounded memory growth with sliding window eviction
- **212 Tests**: Up from 208, covering streaming fallback edge cases

### Fixed
- **Session Tool Calls**: `ChatMessage` interface now includes `tool_calls` field — multi-turn function calling no longer loses tool context between requests
- **Default Model Config**: `DEFAULT_MODEL` env variable now correctly applies to the `deepseek_chat` tool schema default value
- **Double Config Load**: Removed redundant `loadConfig()` call in `index.ts` — config is now loaded once and retrieved with `getConfig()`
- **Circuit Breaker Hardcoded Params**: Circuit breaker threshold and reset timeout are now read from config instead of being hardcoded (5, 30000)
- **Config Resource**: `deepseek://config` resource now exposes `circuitBreakerThreshold`, `circuitBreakerResetTimeout`, and `maxSessionMessages` fields

## [1.3.2] - 2026-03-06

### Changed
- **OpenAI SDK v6**: Upgraded from v4.104.0 to v6.27.0. No breaking changes for our usage — `chat.completions.create()` API unchanged.
- **Zod v4**: Upgraded from v3.25.76 to v4.3.6. Fixed `z.record()` call for v4 compatibility.
- **New Config**: `DEFAULT_MODEL` env variable (default: `deepseek-chat`) for configurable default model.
- **Keywords**: Added `gemini-cli`, `mcp-server` to npm package keywords.

## [1.3.1] - 2026-03-06

### Added
- **Test Coverage**: `deepseek_sessions` tool tests (8 tests, 0% → 90%+ coverage)
- **Test Coverage**: Tool registration aggregator tests (2 tests)
- **208 Tests**: Up from 198, covering session tool actions and tool registration

### Fixed
- **Security**: Updated transitive dependencies via `npm audit fix` — resolved 5 vulnerabilities (3 high) in hono, @hono/node-server, rollup, ajv, qs

## [1.3.0] - 2026-03-04

### Added
- **Multi-Turn Sessions**: `session_id` parameter on `deepseek_chat` for multi-turn conversations. Session history is stored in memory and automatically prepended to requests. Sessions have configurable TTL and max count.
- **Session Management Tool**: `deepseek_sessions` tool with `list`, `delete`, and `clear` actions for managing active sessions.
- **Circuit Breaker**: Protects against cascading API failures. After 5 consecutive failures, fast-fails for 30 seconds, then probes for recovery.
- **Model Fallback**: Automatic fallback between `deepseek-chat` and `deepseek-reasoner` on retryable errors (429, 503, timeout). Configurable via `FALLBACK_ENABLED`.
- **MCP Resources**: 3 read-only resources following MCP Resources spec:
  - `deepseek://models`: Model list with capabilities, context limits, and pricing
  - `deepseek://config`: Current server configuration (API key masked)
  - `deepseek://usage`: Real-time usage statistics (requests, tokens, costs, sessions)
- **Usage Tracker**: Global usage statistics tracking across all requests.
- **New Error Classes**: `FallbackExhaustedError`, `CircuitBreakerOpenError` for resilience error handling.
- **New Config**: `SESSION_TTL_MINUTES` (default: 30), `MAX_SESSIONS` (default: 100), `FALLBACK_ENABLED` (default: true).
- **198 Tests**: Up from 150, covering sessions, circuit breaker, fallback, and MCP resources.

### Changed
- `deepseek-client.ts` now wraps API calls in circuit breaker and supports automatic model fallback.
- `deepseek_chat` tool description updated to mention sessions, fallback, and circuit breaker.
- `tools/index.ts` now registers both `deepseek_chat` and `deepseek_sessions` tools.
- `index.ts` now registers MCP resources via `registerAllResources()`.

## [1.2.0] - 2026-02-26

### Added
- **Thinking Mode**: Enable thinking on deepseek-chat with `thinking: {type: "enabled"}` parameter. Automatically filters incompatible params (temperature, top_p, etc.) with logged warnings.
- **JSON Output Mode**: Structured JSON responses with `json_mode: true`. Supported by both models. Warns if "json" word missing from prompt.
- **Cache-Aware Cost Tracking**: V3.2 API returns `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`. Cost display now shows cache hit ratio and savings.
- **CostBreakdown Interface**: `calculateCost()` returns structured `{inputCost, outputCost, totalCost, cacheHitRatio?, cacheSavings?}` instead of flat number.

### Changed
- **DeepSeek V3.2 Pricing**: Unified pricing for both models — cache hit $0.028/1M, cache miss $0.28/1M, output $0.42/1M (replaces old per-model pricing).
- **max_tokens Limit**: Updated from 32768 to 65536 (reasoner max). Model-specific warnings: deepseek-chat warns above 8192, deepseek-reasoner warns above 65536.
- **Tool Description**: Updated to mention V3.2, thinking mode, JSON mode, and cache-aware cost tracking.
- **150 Tests**: Up from 126, covering thinking mode, JSON mode, cache tokens, and cost breakdown.

### Fixed
- **Incorrect Cost Reports**: Old flat pricing ($0.14/$0.28 chat, $0.55/$2.19 reasoner) replaced with accurate V3.2 unified pricing.

## [1.1.1] - 2026-02-11

### Added
- **Custom Error Classes** (`src/errors.ts`): `BaseError`, `ConfigError`, `ApiError`, `RateLimitError`, `AuthenticationError`, `ValidationError`, `ConnectionError` with error cause chaining
- **DeepSeek Type Extensions** (`src/types.ts`): `DeepSeekRawResponse`, `DeepSeekStreamChunk`, `DeepSeekStreamDelta` types and `hasReasoningContent()`, `getErrorMessage()` type guards
- **Message Content Length Limit**: `MAX_MESSAGE_LENGTH` config (default: 100K chars) prevents excessive API costs
- **Optional Connection Test**: `SKIP_CONNECTION_TEST=true` env skips startup API call for faster boot
- **AI Discoverability**: `llms.txt` and `llms-full.txt` for LLM/AI agent consumption
- **New Tests**: 126 tests (up from 85) covering errors, server factory, tool handlers, prompt registration

### Changed
- **Modular Architecture**: Monolithic `index.ts` (783 lines) split into focused modules:
  - `src/server.ts`: McpServer factory with auto-version from package.json
  - `src/tools/deepseek-chat.ts`: Tool handler (extracted from index.ts)
  - `src/tools/index.ts`: Tool registration aggregator
  - `src/prompts/core.ts`: 5 core reasoning prompts
  - `src/prompts/advanced.ts`: 5 advanced prompts
  - `src/prompts/function-calling.ts`: 2 function calling prompts
  - `src/prompts/index.ts`: Prompt registration aggregator
  - `src/index.ts`: Slim bootstrap (~80 lines)
- **DRY Refactoring** (`deepseek-client.ts`): Extracted `buildRequestParams()` and `wrapError()` methods (eliminated code duplication)
- **Type Safety**: Replaced 16 `any` casts with proper DeepSeek type extensions and type guards (`error: unknown` pattern)
- **Config**: `process.exit(1)` replaced with `throw ConfigError` for testability
- **Version**: Single source of truth from `package.json` via `createRequire` (no more manual sync)

### Fixed
- **Security**: Updated `@modelcontextprotocol/sdk` to fix cross-client data leak (GHSA-345p-7cg4-v4c7)
- **Security**: Fixed `hono` transitive dependency vulnerabilities (XSS, cache deception, IP spoofing)
- CI dist check updated for new file structure

## [1.1.0] - 2026-02-10

### Added
- **Function Calling Support**: Full OpenAI-compatible function calling via `tools` and `tool_choice` parameters
  - Define up to 128 tool definitions with JSON Schema parameters
  - Control tool behavior with `tool_choice`: auto, none, required, or specific function
  - Tool call results formatted in response with call IDs and arguments
  - Streaming + function calling works together (delta accumulation)
  - `tool` message role for sending tool results back
- **Centralized Config System** (`src/config.ts`)
  - Zod-validated configuration from environment variables
  - `DEEPSEEK_BASE_URL`: Custom API endpoint (default: `https://api.deepseek.com`)
  - `SHOW_COST_INFO`: Toggle cost display in responses (default: true)
  - `REQUEST_TIMEOUT`: API request timeout in ms (default: 60000)
  - `MAX_RETRIES`: Maximum API retry count (default: 2)
- **Test Suite**: 85 tests with Vitest
  - Config, Cost, Schemas, Client, and Function Calling tests
  - 80%+ code coverage with v8 provider
  - `npm test`, `npm run test:watch`, `npm run test:coverage` scripts
- **2 New Prompt Templates** (total: 12)
  - `function_call_debug`: Debug function calling issues
  - `create_function_schema`: Generate JSON Schema from natural language
- CI coverage job in GitHub Actions

### Changed
- **Project Structure**: Modularized codebase
  - `src/config.ts`: Centralized configuration
  - `src/cost.ts`: Cost calculation (extracted from index.ts)
  - `src/schemas.ts`: Zod validation schemas (extracted from index.ts)
- `DeepSeekClient` constructor now uses centralized config (no manual apiKey passing)
- Server version bumped to 1.1.0
- Updated `deepseek_chat` tool description to mention function calling

## [1.0.3] - 2025-02-07

### Added
- Cost tracking for API requests
  - Automatic cost calculation based on token usage
  - USD cost included in response output
  - Cost data available in `structuredContent.cost_usd`
- 10 MCP prompt templates for common reasoning tasks
  - `debug_with_reasoning`: Debug code with step-by-step analysis
  - `code_review_deep`: Comprehensive code review
  - `research_synthesis`: Research and synthesize information
  - `strategic_planning`: Create strategic plans with reasoning
  - `explain_like_im_five`: Explain complex topics simply
  - `mathematical_proof`: Prove mathematical statements
  - `argument_validation`: Analyze arguments for logical fallacies
  - `creative_ideation`: Generate creative ideas with feasibility analysis
  - `cost_comparison`: Compare LLM costs
  - `pair_programming`: Interactive coding assistant
- Enhanced response format with request information section
  - Token breakdown (prompt + completion)
  - Model name
  - Cost in USD

### Changed
- Updated DeepSeek Reasoner pricing to current rates ($0.55/$2.19 per 1M tokens)

## [1.0.0] - 2025-01-13

### Added
- Initial release of DeepSeek MCP Server
- Support for `deepseek-chat` model
- Support for `deepseek-reasoner` (R1) model with reasoning traces
- Streaming mode support
- Full TypeScript implementation with type safety
- OpenAI-compatible API client
- Comprehensive error handling
- MCP protocol compliance via stdio transport
- Tool: `deepseek_chat` for chat completions
- Environment variable configuration for API key
- Detailed documentation and examples
- MIT License

### Features
- **Models**:
  - deepseek-chat: Fast general-purpose model
  - deepseek-reasoner: Advanced reasoning with chain-of-thought
- **Parameters**:
  - temperature: Control randomness (0-2)
  - max_tokens: Limit response length
  - stream: Enable streaming mode
- **Output**:
  - Text content with formatting
  - Reasoning traces for R1 model
  - Token usage statistics
  - Structured response data

### Technical
- Built with @modelcontextprotocol/sdk v1.0.4
- Uses OpenAI SDK v4.77.3 for API compatibility
- Zod v3.24.1 for schema validation
- TypeScript v5.7.3
- Node.js 18+ required
- Stdio-based transport for process communication

## [0.1.0] - Development

### Added
- Initial project setup
- Basic MCP server structure
- DeepSeek API integration prototype

---

## Version History

- **1.5.0** (2026-03-07): Cloudflare Workers remote endpoint (BYOK), deepseek-mcp.tahirl.com
- **1.4.3** (2026-03-07): MCP Registry description fix
- **1.4.2** (2026-03-07): Streamable HTTP transport, Docker support, health endpoint, 253 tests
- **1.4.1** (2026-03-07): MCP Registry, Glama registry, Smithery compatibility
- **1.4.0** (2026-03-07): Model-aware pricing, multimodal content types, flexible fallback chain, MCP Registry, 241 tests
- **1.3.3** (2026-03-07): Streaming fallback tests, session tool_calls fix, configurable circuit breaker, session message limit, 212 tests
- **1.3.2** (2026-03-06): OpenAI SDK v6, Zod v4, DEFAULT_MODEL config
- **1.3.1** (2026-03-06): Security fixes, session tool tests, 208 tests
- **1.3.0** (2026-03-04): Sessions, circuit breaker, model fallback, MCP resources, 198 tests
- **1.2.0** (2026-02-26): DeepSeek V3.2 support — thinking mode, JSON mode, cache-aware pricing, 150 tests
- **1.1.1** (2026-02-11): Modular architecture, type safety, security fixes, 126 tests
- **1.1.0** (2026-02-10): Function calling, config system, test suite
- **1.0.3** (2025-02-07): Cost tracking and prompt templates
- **1.0.0** (2025-01-13): Initial public release
- **0.1.0** (Development): Internal development version

## Links

- [npm package](https://www.npmjs.com/package/@arikusi/deepseek-mcp-server)
- [GitHub repository](https://github.com/arikusi/deepseek-mcp-server)
- [Issue tracker](https://github.com/arikusi/deepseek-mcp-server/issues)

[Unreleased]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.4.3...v1.5.0
[1.4.3]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/arikusi/deepseek-mcp-server/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/arikusi/deepseek-mcp-server/releases/tag/v1.0.3
[1.0.0]: https://github.com/arikusi/deepseek-mcp-server/releases/tag/v1.0.0
[0.1.0]: https://github.com/arikusi/deepseek-mcp-server/releases/tag/v0.1.0
