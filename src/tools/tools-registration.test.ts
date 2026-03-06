import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, resetConfig } from '../config.js';
import { SessionStore } from '../session.js';
import { registerAllTools } from './index.js';

function createMockServer() {
  const tools = new Map<string, unknown>();
  return {
    registerTool: vi.fn(
      (name: string, meta: unknown, handler: Function) => {
        tools.set(name, { meta, handler });
      }
    ),
    tools,
  };
}

function createMockClient() {
  return {} as any;
}

describe('registerAllTools', () => {
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    resetConfig();
    process.env.DEEPSEEK_API_KEY = 'sk-test1234567890abcdef';
    loadConfig();
    SessionStore.resetInstance();
    mockServer = createMockServer();
  });

  afterEach(() => {
    resetConfig();
    SessionStore.resetInstance();
  });

  it('should register exactly 2 tools', () => {
    registerAllTools(mockServer as any, createMockClient());
    expect(mockServer.registerTool).toHaveBeenCalledTimes(2);
  });

  it('should register deepseek_chat and deepseek_sessions', () => {
    registerAllTools(mockServer as any, createMockClient());
    expect(mockServer.tools.has('deepseek_chat')).toBe(true);
    expect(mockServer.tools.has('deepseek_sessions')).toBe(true);
  });
});
