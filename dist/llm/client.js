"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIClient = exports.MockLLMClient = exports.LLMClient = void 0;
exports.createLLMClient = createLLMClient;
class LLMClient {
    config;
    constructor(config = {}) {
        this.config = {
            model: 'gpt-4',
            temperature: 0.3,
            maxTokens: 4096,
            ...config,
        };
    }
    buildSystemPrompt(basePrompt, additionalContext) {
        if (additionalContext) {
            return `${basePrompt}\n\n${additionalContext}`;
        }
        return basePrompt;
    }
}
exports.LLMClient = LLMClient;
class MockLLMClient extends LLMClient {
    async complete(messages) {
        const lastMessage = messages[messages.length - 1];
        return {
            content: `Mock response for: ${lastMessage.content.substring(0, 100)}...`,
            tokensUsed: { prompt: 100, completion: 50, total: 150 },
            model: 'mock-model',
            finishReason: 'stop',
        };
    }
    async completeWithJSON(_messages, _schema) {
        return {};
    }
}
exports.MockLLMClient = MockLLMClient;
class OpenAIClient extends LLMClient {
    apiKey;
    constructor(config) {
        super(config);
        this.apiKey = config.apiKey;
    }
    async complete(messages) {
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
        const data = await response.json();
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
    async completeWithJSON(messages, _schema) {
        const enhancedMessages = [
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
                return JSON.parse(jsonMatch[0]);
            }
            return JSON.parse(response.content);
        }
        catch (error) {
            throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
exports.OpenAIClient = OpenAIClient;
function createLLMClient(config) {
    const provider = config.provider || 'mock';
    if (provider === 'openai') {
        if (!config.apiKey) {
            throw new Error('OpenAI API key is required for OpenAI provider');
        }
        return new OpenAIClient({ ...config, apiKey: config.apiKey });
    }
    return new MockLLMClient(config);
}
//# sourceMappingURL=client.js.map