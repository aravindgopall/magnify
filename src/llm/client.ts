export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  model?: string;
  finishReason?: string;
}

export interface LLMClientConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  apiKey?: string;
}

export abstract class LLMClient {
  protected config: LLMClientConfig;

  constructor(config: LLMClientConfig = {}) {
    this.config = {
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 4096,
      ...config,
    };
  }

  abstract complete(messages: LLMMessage[]): Promise<LLMResponse>;
  abstract completeWithJSON<T>(messages: LLMMessage[], schema?: Record<string, unknown>): Promise<T>;

  protected buildSystemPrompt(basePrompt: string, additionalContext?: string): string {
    if (additionalContext) {
      return `${basePrompt}\n\n${additionalContext}`;
    }
    return basePrompt;
  }
}

export class MockLLMClient extends LLMClient {
  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1];
    return {
      content: `Mock response for: ${lastMessage.content.substring(0, 100)}...`,
      tokensUsed: { prompt: 100, completion: 50, total: 150 },
      model: 'mock-model',
      finishReason: 'stop',
    };
  }

  async completeWithJSON<T>(_messages: LLMMessage[], _schema?: Record<string, unknown>): Promise<T> {
    return {} as T;
  }
}

export interface OpenAIConfig extends LLMClientConfig {
  apiKey: string;
}

export class OpenAIClient extends LLMClient {
  private apiKey: string;

  constructor(config: OpenAIConfig) {
    super(config);
    this.apiKey = config.apiKey;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseURL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content || '',
      tokensUsed: data.usage ? {
        prompt: data.usage.prompt_tokens,
        completion: data.usage.completion_tokens,
        total: data.usage.total_tokens,
      } : undefined,
      model: data.model,
      finishReason: data.choices[0]?.finish_reason,
    };
  }

  async completeWithJSON<T>(messages: LLMMessage[], _schema?: Record<string, unknown>): Promise<T> {
    const enhancedMessages: LLMMessage[] = [
      ...messages,
      {
        role: 'system',
        content: 'Respond with valid JSON only. No markdown, no explanation, just the JSON object.',
      },
    ];

    const response = await this.complete(enhancedMessages);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      return JSON.parse(response.content) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export function createLLMClient(config: LLMClientConfig & { provider?: 'openai' | 'mock' }): LLMClient {
  const provider = config.provider || 'mock';
  
  if (provider === 'openai') {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required for OpenAI provider');
    }
    return new OpenAIClient({ ...config, apiKey: config.apiKey });
  }
  
  return new MockLLMClient(config);
}