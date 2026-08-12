export type LLMProvider = "ollama" | "openai" | "anthropic" | "airllm";

export interface LLMSettings {
  provider: LLMProvider;
  ollamaEndpoint: string;
  ollamaModel: string;
  openaiModel: string;
  anthropicModel: string;
  airllmEndpoint: string;
  airllmModel: string;
  airllmPythonPath: string;
  airllmCacheDir: string;
  airllmCompression: "none" | "4bit" | "8bit";
  cloudApiEnabled: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
  contextLength?: number;
  benchmarkHistory?: BenchmarkResult[];
}

export interface BenchmarkResult {
  id: string;
  provider: LLMProvider;
  model: string;
  contextLength: number;
  durationMs: number;
  outputChars: number;
  createdAt: number;
}

export interface McpToolSummary {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerProfile {
  id: string;
  name: string;
  endpoint: string;
  enabled: boolean;
  tools: McpToolSummary[];
  status: string;
}

export interface TaskRecipe {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtIn: boolean;
}

export interface AccessibilitySettings {
  uiScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export interface SecretStatus {
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  telegramConfigured: boolean;
  workerPasswordConfigured: boolean;
  huggingfaceConfigured: boolean;
}

export interface AirLlmStatus {
  running: boolean;
  ready: boolean;
  detail: string;
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
  status: "pending" | "running" | "completed" | "blocked" | "failed";
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
