import {
  buildExplanationMessages,
  type ChatMessage,
  type ExplanationProvider,
  type ExplanationProviderMetadata,
  type ExplanationRequest,
} from "./explanation-provider.js";
import { readResponseBody, trimTrailingSlash } from "./http-stream.js";

interface OllamaProviderOptions {
  readonly model: string;
  readonly baseUrl: string;
  readonly systemPrompt?: string;
}

type OllamaStreamChunk = {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
  readonly done?: boolean;
  readonly error?: string;
};

function serializeMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export class OllamaExplanationProvider implements ExplanationProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly systemPrompt?: string;

  constructor(options: OllamaProviderOptions) {
    this.model = options.model;
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.systemPrompt = options.systemPrompt;
  }

  metadata(): ExplanationProviderMetadata {
    return {
      kind: "ollama",
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }

  async *explainCommand(request: ExplanationRequest): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: serializeMessages(buildExplanationMessages(request, this.systemPrompt)),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${String(response.status)}): ${body || response.statusText}`);
    }

    let buffer = "";
    for await (const chunk of readResponseBody(response)) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const parsed = JSON.parse(trimmed) as OllamaStreamChunk;
        if (parsed.error) {
          throw new Error(parsed.error);
        }

        const content = parsed.message?.content ?? parsed.response ?? "";
        if (content) {
          yield content;
        }
      }
    }
  }
}
