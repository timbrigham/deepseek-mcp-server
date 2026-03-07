/**
 * HTTP Transport for DeepSeek MCP Server
 * Implements Streamable HTTP transport using the MCP SDK's Express middleware.
 * Each MCP session gets its own McpServer instance; DeepSeekClient is shared.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { version } from './server.js';

const transports: Record<string, StreamableHTTPServerTransport> = {};

export function createHttpApp(serverFactory: () => McpServer) {
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version,
      uptime: process.uptime(),
      transport: 'http',
      timestamp: new Date().toISOString(),
    });
  });

  // POST /mcp — handle JSON-RPC requests
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session — reuse transport
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res, req.body);
      return;
    }

    // New initialize request — create session
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
          console.error(`[DeepSeek MCP] HTTP session initialized: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
          console.error(`[DeepSeek MCP] HTTP session closed: ${transport.sessionId}`);
        }
      };

      const server = serverFactory();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid request: no valid session or not an initialize request' },
      id: null,
    });
  });

  // GET /mcp — SSE stream for existing session
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
    }
  });

  // DELETE /mcp — terminate session
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].close();
      delete transports[sessionId];
      res.status(200).json({ status: 'session terminated' });
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
    }
  });

  return app;
}

export async function startHttpTransport(serverFactory: () => McpServer, port: number): Promise<void> {
  const app = createHttpApp(serverFactory);

  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.error(`[DeepSeek MCP] HTTP transport listening on http://0.0.0.0:${port}`);
    console.error(`[DeepSeek MCP] Health check: http://localhost:${port}/health`);
    console.error(`[DeepSeek MCP] MCP endpoint: http://localhost:${port}/mcp`);
  });

  const shutdown = async () => {
    console.error('[DeepSeek MCP] Shutting down HTTP transport...');
    for (const [id, transport] of Object.entries(transports)) {
      await transport.close();
      delete transports[id];
    }
    httpServer.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
