import {
  type ExplanationProvider,
  type ExplanationProviderConfig,
  type ExplanationProviderKind,
} from "./explanation-provider.js";
import { MockExplanationProvider } from "./mock-explanation-provider.js";
import { OllamaExplanationProvider } from "./ollama-provider.js";
import { OpenAiCompatibleExplanationProvider } from "./openai-compatible-provider.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function resolveProviderKind(config?: ExplanationProviderConfig): ExplanationProviderKind {
  return config?.provider ?? "ollama";
}

export function createExplanationProvider(config?: ExplanationProviderConfig): ExplanationProvider {
  const provider = resolveProviderKind(config);

  if (provider === "mock") {
    return new MockExplanationProvider(config?.model);
  }

  if (provider === "openai-compatible") {
    return new OpenAiCompatibleExplanationProvider({
      model: config?.model ?? DEFAULT_OPENAI_MODEL,
      baseUrl: config?.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      apiKey: config?.apiKey,
      systemPrompt: config?.systemPrompt,
    });
  }

  return new OllamaExplanationProvider({
    model: config?.model ?? DEFAULT_OLLAMA_MODEL,
    baseUrl: config?.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_BASE_URL,
    systemPrompt: config?.systemPrompt,
  });
}
