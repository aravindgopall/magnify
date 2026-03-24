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

  async completeWithJSON<T>(messages: LLMMessage[], _schema?: Record<string, unknown>): Promise<T> {
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || '';
    
    // Detect what type of response is being requested based on the message content
    if (content.includes('identify logical groups') || content.includes('Analyze this PDF document')) {
      // Return mock document analysis response
      return {
        documentType: 'technical-specification',
        summary: 'A technical specification document with multiple sections.',
        groups: [
          { id: 'group-1', title: 'Introduction', startPage: 1, endPage: 5, reasoning: 'Introduction section' },
          { id: 'group-2', title: 'Technical Requirements', startPage: 6, endPage: 20, reasoning: 'Main technical content' },
          { id: 'group-3', title: 'Implementation Guide', startPage: 21, endPage: 40, reasoning: 'Implementation details' },
          { id: 'group-4', title: 'Appendix', startPage: 41, endPage: 50, reasoning: 'Additional reference material' },
        ],
        recommendedStrategy: 'heading',
        metadata: { hasTOC: false, hasHeadings: true, estimatedComplexity: 'medium' },
      } as T;
    }
    
    if (content.includes('Which sections are relevant')) {
      // Return mock routing response
      return {
        relevantGroupIds: ['group-1', 'group-2'],
        reasoning: 'These sections contain information relevant to the query.',
      } as T;
    }
    
    if (content.includes('Combine multiple partial answers') || content.includes('Synthesize')) {
      // Return mock synthesis response
      return {
        answer: 'Based on the document analysis, this is a mock synthesized answer.',
        confidence: 0.8,
      } as T;
    }
    
    if (content.includes('Section:') || content.includes('Content:')) {
      // Return mock subagent response
      return {
        answer: 'Mock answer based on document section.',
        entities: [
          { type: 'concept', name: 'Mock Entity', confidence: 0.9 },
        ],
        relevantExcerpt: 'Mock relevant excerpt from the document.',
      } as T;
    }
    
    // Default empty response
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

export interface LiteLLMConfig extends LLMClientConfig {
  apiKey: string;
  baseURL: string;
}

export class LiteLLMClient extends LLMClient {
  private apiKey: string;
  private baseURL: string;

  constructor(config: LiteLLMConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
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
      const errorText = await response.text();
      throw new Error(`LiteLLM API error: ${response.status} ${response.statusText} - ${errorText}`);
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

export function createLLMClient(config: LLMClientConfig & { provider?: 'openai' | 'litellm' | 'mock' }): LLMClient {
  const provider = config.provider || 'mock';
  
  if (provider === 'openai') {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required for OpenAI provider');
    }
    return new OpenAIClient({ ...config, apiKey: config.apiKey });
  }
  
  if (provider === 'litellm') {
    if (!config.apiKey) {
      throw new Error('LiteLLM API key is required for LiteLLM provider');
    }
    if (!config.baseURL) {
      throw new Error('LiteLLM URL is required for LiteLLM provider');
    }
    return new LiteLLMClient({ ...config, apiKey: config.apiKey, baseURL: config.baseURL });
  }
  
  return new MockLLMClient(config);
}