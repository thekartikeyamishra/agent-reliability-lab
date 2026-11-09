/** Copyright (c) 2026 Kartikeya Mishra. MIT License. */
export interface AgentReply {
  text: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentSession {
  send(message: string): Promise<AgentReply>;
}

/**
 * Anything that can hold a conversation. Swapping providers means writing one small class — the test set,
 * graders and reports never change. That is the "no hard dependency on any vendor" guarantee.
 */
export interface AgentAdapter {
  readonly name: string;
  readonly model?: string;
  startSession(caseId: string): Promise<AgentSession>;
}
