#!/usr/bin/env node

/**
 * DeepSeek MCP Server
 * Model Context Protocol server for DeepSeek API integration
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ConfigError } from './errors.js';
import { DeepSeekClient } from './deepseek-client.js';
import { createServer, version } from './server.js';
import { registerAllTools } from './tools/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { registerAllResources } from './resources/index.js';

async function main() {
  // Load and validate configuration
  try {
    loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error('Error: ' + error.message);
      for (const issue of error.issues) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
    }
    process.exit(1);
  }

  const config = loadConfig();
  const deepseek = new DeepSeekClient();
  const server = createServer();

  // Register tools, prompts, and resources
  registerAllTools(server, deepseek);
  registerAllPrompts(server);
  registerAllResources(server);

  console.error(`[DeepSeek MCP] Starting server v${version}...`);

  // Optional connection test (controlled by SKIP_CONNECTION_TEST env)
  if (!config.skipConnectionTest) {
    console.error('[DeepSeek MCP] Testing API connection...');
    const isConnected = await deepseek.testConnection();

    if (!isConnected) {
      console.error('[DeepSeek MCP] Warning: Failed to connect to DeepSeek API');
      console.error(
        '[DeepSeek MCP] Please check your API key and internet connection'
      );
    } else {
      console.error('[DeepSeek MCP] API connection successful');
    }
  }

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[DeepSeek MCP] Server running on stdio');
  console.error(
    '[DeepSeek MCP] Available tools: deepseek_chat (sessions, fallback), deepseek_sessions'
  );
  console.error('[DeepSeek MCP] Available prompts: 12 reasoning templates');
  console.error('[DeepSeek MCP] Available resources: deepseek://models, deepseek://config, deepseek://usage');
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('[DeepSeek MCP] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(
    '[DeepSeek MCP] Unhandled rejection at:',
    promise,
    'reason:',
    reason
  );
  process.exit(1);
});

// Start the server
main().catch((error) => {
  console.error('[DeepSeek MCP] Fatal error:', error);
  process.exit(1);
});
