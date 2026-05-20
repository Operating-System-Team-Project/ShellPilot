import {
  buildExplanationMessages,
  type ChatMessage,
  type ExplanationProvider,
  type ExplanationProviderMetadata,
  type ExplanationRequest,
} from "./explanation-provider.js";
import { readResponseBody, trimTrailingSlash } from "./http-stream.js";

interface OpenAiCompatibleProviderOptions {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly systemPrompt?: string;
}

type ChatCompletionDelta = {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string;
    };
  }[];
  readonly error?: {
    readonly message?: string;
  };
};

function normalizeEndpoint(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl);
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function serializeMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export class OpenAiCompatibleExplanationProvider implements ExplanationProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly systemPrompt?: string;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.model = options.model;
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.apiKey = options.apiKey;
    this.systemPrompt = options.systemPrompt;
  }

  metadata(): ExplanationProviderMetadata {
    return {
      kind: "openai-compatible",
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }

  async *explainCommand(request: ExplanationRequest): AsyncIterable<string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(normalizeEndpoint(this.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: serializeMessages(buildExplanationMessages(request, this.systemPrompt)),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`LLM request failed (${String(response.status)}): ${body || response.statusText}`);
    }

    let buffer = "";
    for await (const chunk of readResponseBody(response)) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice("data:".length).trim();
        if (payload === "[DONE]") {
          return;
        }

        const parsed = JSON.parse(payload) as ChatCompletionDelta;
        const errorMessage = parsed.error?.message;
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        const content = parsed.choices?.[0]?.delta?.content ?? "";
        if (content) {
          yield content;
        }
      }
    }
  }
}
