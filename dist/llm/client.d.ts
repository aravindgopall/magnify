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
export declare abstract class LLMClient {
    protected config: LLMClientConfig;
    constructor(config?: LLMClientConfig);
    abstract complete(messages: LLMMessage[]): Promise<LLMResponse>;
    abstract completeWithJSON<T>(messages: LLMMessage[], schema?: Record<string, unknown>): Promise<T>;
    protected buildSystemPrompt(basePrompt: string, additionalContext?: string): string;
}
export declare class MockLLMClient extends LLMClient {
    complete(messages: LLMMessage[]): Promise<LLMResponse>;
    completeWithJSON<T>(_messages: LLMMessage[], _schema?: Record<string, unknown>): Promise<T>;
}
export interface OpenAIConfig extends LLMClientConfig {
    apiKey: string;
}
export declare class OpenAIClient extends LLMClient {
    private apiKey;
    constructor(config: OpenAIConfig);
    complete(messages: LLMMessage[]): Promise<LLMResponse>;
    completeWithJSON<T>(messages: LLMMessage[], _schema?: Record<string, unknown>): Promise<T>;
}
export declare function createLLMClient(config: LLMClientConfig & {
    provider?: 'openai' | 'mock';
}): LLMClient;
//# sourceMappingURL=client.d.ts.map