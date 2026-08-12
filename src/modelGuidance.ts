import type { LLMProvider, SystemStats } from "./types";

export const CONTEXT_OPTIONS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144] as const;

export interface StarterModel {
  id: string;
  name: string;
  hardware: "4 GB friendly" | "8 GB target";
  downloadSize: string;
  advertisedContext: number;
  note: string;
}

export const OLLAMA_STARTER_MODELS: StarterModel[] = [
  { id: "qwen3:0.6b", name: "Qwen 3 0.6B", hardware: "4 GB friendly", downloadSize: "523 MB", advertisedContext: 40960, note: "Smallest reasoning and tool-capable starter." },
  { id: "gemma3:1b", name: "Gemma 3 1B", hardware: "4 GB friendly", downloadSize: "815 MB", advertisedContext: 32768, note: "Compact multilingual text model." },
  { id: "llama3.2:1b", name: "Llama 3.2 1B", hardware: "4 GB friendly", downloadSize: "1.3 GB", advertisedContext: 131072, note: "Lightweight instruction and summarization model." },
  { id: "llama3.2:3b", name: "Llama 3.2 3B", hardware: "8 GB target", downloadSize: "2.0 GB", advertisedContext: 131072, note: "Balanced local assistant with tool support." },
  { id: "qwen3:4b", name: "Qwen 3 4B", hardware: "8 GB target", downloadSize: "2.5 GB", advertisedContext: 262144, note: "Stronger reasoning while remaining laptop-sized." },
  { id: "gemma3:4b", name: "Gemma 3 4B", hardware: "8 GB target", downloadSize: "3.3 GB", advertisedContext: 131072, note: "Text and image input on supported Ollama versions." },
];

export function formatTokens(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}k`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

export function formatModelSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "Size unknown";
  const gibibytes = bytes / 1024 / 1024 / 1024;
  return gibibytes >= 1 ? `${gibibytes.toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function findAdvertisedContext(modelInfo?: Record<string, unknown>): number | null {
  if (!modelInfo) return null;
  const values = Object.entries(modelInfo)
    .filter(([key, value]) => key.endsWith(".context_length") && typeof value === "number")
    .map(([, value]) => value as number)
    .filter((value) => Number.isFinite(value) && value >= 2048);
  return values.length ? Math.max(...values) : null;
}

interface RecommendationInput {
  provider: LLMProvider;
  systemStats: SystemStats | null;
  modelSizeBytes?: number;
  advertisedMax?: number | null;
}

export interface ContextRecommendation {
  tokens: number;
  explanation: string;
}

function contextOptionAtOrBelow(value: number): number {
  return [...CONTEXT_OPTIONS].reverse().find((option) => option <= value) || CONTEXT_OPTIONS[0];
}

export function recommendContext({ provider, systemStats, modelSizeBytes, advertisedMax }: RecommendationInput): ContextRecommendation {
  const totalRamGb = systemStats ? systemStats.ram_total_mb / 1024 : null;
  let target = 8192;
  let explanation = "A conservative local default until hardware details are available.";

  if (provider === "openai" || provider === "anthropic") {
    target = 32768;
    explanation = "Cloud inference is not limited by laptop RAM; 32k is a cautious latency and usage starting point.";
  } else if (provider === "airllm") {
    target = totalRamGb && totalRamGb > 8.5 ? 4096 : 2048;
    explanation = totalRamGb
      ? `AirLLM is disk- and memory-intensive; this starts cautiously on ${totalRamGb.toFixed(0)} GB RAM.`
      : "AirLLM is disk- and memory-intensive, so Iroh starts with a small context.";
  } else if (totalRamGb) {
    if (totalRamGb <= 4.5) target = 2048;
    else if (totalRamGb <= 8.5) target = 4096;
    else if (totalRamGb <= 16.5) target = 8192;
    else if (totalRamGb <= 32.5) target = 16384;
    else target = 32768;

    if (modelSizeBytes) {
      const modelSizeGb = modelSizeBytes / 1024 / 1024 / 1024;
      const remainingGb = totalRamGb - modelSizeGb;
      if (remainingGb < 2.5) target = Math.min(target, 2048);
      else if (remainingGb < 4) target = Math.min(target, 4096);
      else if (remainingGb < 7) target = Math.min(target, 8192);
      explanation = `Based on ${totalRamGb.toFixed(0)} GB RAM and an approximately ${modelSizeGb.toFixed(1)} GB model.`;
    } else {
      explanation = `Based on ${totalRamGb.toFixed(0)} GB total RAM; model memory use is not yet known.`;
    }
  }

  if (advertisedMax && advertisedMax > 0) {
    if (target > advertisedMax) explanation += " Capped by the model's advertised context window.";
    target = Math.min(target, advertisedMax);
  }

  return { tokens: contextOptionAtOrBelow(target), explanation };
}
