import { config } from 'dotenv';
// Load .env file with override=true to override system environment variables
config({ override: true });
import { startServer } from './api/index.js';

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

// Determine LLM provider from environment
const llmProvider = (process.env.LLM_PROVIDER || 'mock') as 'openai' | 'litellm' | 'mock';

// Configure LLM based on provider
const llmConfig: {
  provider: 'openai' | 'litellm' | 'mock';
  apiKey?: string;
  model?: string;
  baseURL?: string;
} = {
  provider: llmProvider,
};

if (llmProvider === 'litellm') {
  // Use LITE_LLM configuration
  llmConfig.apiKey = process.env.LITE_LLM_API_KEY;
  llmConfig.model = process.env.LITE_LLM_MODEL || 'glm-latest';
  llmConfig.baseURL = process.env.LITE_LLM_URL;
  console.log(`LiteLLM Config - Model: ${llmConfig.model}, URL: ${llmConfig.baseURL}`);
} else if (llmProvider === 'openai') {
  // Use OpenAI configuration
  llmConfig.apiKey = process.env.OPENAI_API_KEY;
  llmConfig.model = process.env.LLM_MODEL || 'gpt-4';
}

// Start server with persistent storage
startServer({
  port,
  host,
  llm: llmConfig,
}).then(({ server }) => {
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});