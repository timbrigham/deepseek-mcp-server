import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, resetConfig } from '../config.js';
import { registerChatTool } from './deepseek-chat.js';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

function createMockServer() {
  const tools = new Map<string, { config: unknown; handler: Function }>();
  return {
    registerTool: vi.fn((name: string, config: unknown, handler: Function) => {
      tools.set(name, { config, handler });
    }),
    tools,
  };
}

describe('tools/deepseek-chat', () => {
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    resetConfig();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    loadConfig();
    mockCreate.mockReset();
    mockServer = createMockServer();
  });

  it('should register deepseek_chat tool', async () => {
    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'deepseek_chat',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should return formatted response with cost info', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'Hello!', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-chat',
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7,
      },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'deepseek-chat',
    });

    expect(result.content[0].text).toContain('Hello!');
    expect(result.content[0].text).toContain('Tokens:');
    expect(result.structuredContent.content).toBe('Hello!');
    expect(result.structuredContent.cost_usd).toBeDefined();
  });

  it('should format reasoning content with thinking tags', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Answer is 42',
            reasoning_content: 'Step by step...',
          },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-reasoner',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Think' }],
      model: 'deepseek-reasoner',
    });

    expect(result.content[0].text).toContain('<thinking>');
    expect(result.content[0].text).toContain('Step by step...');
    expect(result.content[0].text).toContain('</thinking>');
  });

  it('should format tool calls in response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"NYC"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      model: 'deepseek-chat',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Weather?' }],
      model: 'deepseek-chat',
      tools: [
        { type: 'function', function: { name: 'get_weather' } },
      ],
    });

    expect(result.content[0].text).toContain('Function Calls');
    expect(result.content[0].text).toContain('get_weather');
    expect(result.content[0].text).toContain('call_123');
  });

  it('should return error response on failure', async () => {
    mockCreate.mockRejectedValue(new Error('API down'));
    const mockError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');

    mockError.mockRestore();
  });

  it('should reject message content exceeding max length', async () => {
    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const longContent = 'x'.repeat(100_001);
    const mockError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const result = await handler({
      messages: [{ role: 'user', content: longContent }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('maximum length');

    mockError.mockRestore();
  });

  it('should accept json_mode with deepseek-reasoner', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: '{"result": true}', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-reasoner',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Return json output' }],
      model: 'deepseek-reasoner',
      json_mode: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('{"result": true}');
  });

  it('should pass thinking param to client', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'Thought result', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-chat',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Think about this' }],
      model: 'deepseek-chat',
      thinking: { type: 'enabled' },
    });

    expect(result.content[0].text).toContain('Thought result');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        extra_body: { thinking: { type: 'enabled' } },
      })
    );
  });

  it('should pass json_mode as response_format to client', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: '{"key":"value"}', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-chat',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Return json output' }],
      model: 'deepseek-chat',
      json_mode: true,
    });

    expect(result.content[0].text).toContain('{"key":"value"}');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      })
    );
  });

  it('should reject multimodal content when ENABLE_MULTIMODAL is false', async () => {
    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await handler({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Multimodal content');
    expect(result.content[0].text).toContain('ENABLE_MULTIMODAL');
    mockError.mockRestore();
  });

  it('should accept multimodal content when ENABLE_MULTIMODAL is true', async () => {
    resetConfig();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.ENABLE_MULTIMODAL = 'true';
    loadConfig();

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'I see a cat', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-chat',
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
          ],
        },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('I see a cat');

    // Clean up
    delete process.env.ENABLE_MULTIMODAL;
  });

  it('should validate message length for multimodal array content', async () => {
    resetConfig();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.ENABLE_MULTIMODAL = 'true';
    loadConfig();

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await handler({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'x'.repeat(100_001) },
          ],
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('maximum length');

    mockError.mockRestore();
    delete process.env.ENABLE_MULTIMODAL;
  });

  it('should show cache info in cost display', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'Hello!', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      model: 'deepseek-chat',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
      },
    });

    const { DeepSeekClient } = await import('../deepseek-client.js');
    const client = new DeepSeekClient();
    registerChatTool(mockServer as any, client);

    const handler = mockServer.tools.get('deepseek_chat')!.handler;
    const result = await handler({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'deepseek-chat',
    });

    expect(result.content[0].text).toContain('cache hit: 80%');
  });
});
