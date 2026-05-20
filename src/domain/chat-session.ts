import type { Message } from "./message.js";

export class ChatSession {
  private readonly messagesStore: Message[] = [];

  get messages(): readonly Message[] {
    return this.messagesStore;
  }

  addUser(content: string): Message {
    const message: Message = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    this.messagesStore.push(message);
    return message;
  }

  addAssistant(content: string): Message {
    const message: Message = {
      role: "assistant",
      content,
      timestamp: new Date(),
    };
    this.messagesStore.push(message);
    return message;
  }

  clear(): void {
    this.messagesStore.length = 0;
  }

  tail(count = 8): readonly Message[] {
    if (count <= 0) {
      return [];
    }
    return this.messagesStore.slice(-count);
  }
}
