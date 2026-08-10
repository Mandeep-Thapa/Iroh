export type LLMProvider = 'ollama' | 'openai' | 'anthropic';

export interface LLMSettings {
  provider: LLMProvider;
  ollamaEndpoint: string;
  ollamaModel: string;
  openaiKey: string;
  openaiModel: string;
  anthropicKey: string;
  anthropicModel: string;
  telegramToken?: string;
  contextLength?: number;
}

export interface SystemStats {
  ram_used_mb: number;
  ram_total_mb: number;
  vram_used_mb: number;
  vram_total_mb: number;
}

export interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'blocked' | 'failed';
  details?: string;
}

export interface ReasoningLog {
  timestamp: string;
  thinkingText?: string;
  actionSummary?: string;
  steps: TaskStep[];
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  role: MessageRole;
  content: string;
  images?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  builtIn: boolean;
}

export interface Rule {
  id: string;
  text: string;
  enabled: boolean;
}
