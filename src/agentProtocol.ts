export const TOOL_NAMES = [
  "read_file",
  "list_dir",
  "write_file",
  "remember",
  "search_web",
  "browse_web",
  "read_image",
  "search_document",
  "search_workspace",
  "execute_command",
  "send_file",
  "mcp_call",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface AgentToolCall {
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface AgentEnvelope {
  assistantResponse: string;
  thinking?: string;
  toolCall: AgentToolCall | null;
  structured: boolean;
}

const TOOL_SET = new Set<string>(TOOL_NAMES);

function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseStructured(text: string): AgentEnvelope | null {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [withoutThinking, fenced].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const response = parsed.assistant_response ?? parsed.assistantResponse;
      const rawTool = parsed.tool_call ?? parsed.toolCall;
      if (typeof response !== "string") continue;
      if (rawTool == null) {
        return {
          assistantResponse: response.trim(),
          thinking: typeof parsed.thinking === "string" ? parsed.thinking : undefined,
          toolCall: null,
          structured: true,
        };
      }
      if (typeof rawTool !== "object" || Array.isArray(rawTool)) continue;
      const tool = rawTool as Record<string, unknown>;
      if (typeof tool.name !== "string" || !TOOL_SET.has(tool.name)) continue;
      return {
        assistantResponse: response.trim(),
        thinking: typeof parsed.thinking === "string" ? parsed.thinking : undefined,
        toolCall: {
          name: tool.name as ToolName,
          arguments: objectArguments(tool.arguments),
        },
        structured: true,
      };
    } catch {
      // A provider may not support schema-constrained output; legacy parsing remains available.
    }
  }
  return null;
}

function legacyTool(text: string): AgentToolCall | null {
  const patterns: Array<[ToolName, RegExp, (match: RegExpMatchArray) => Record<string, unknown>]> = [
    ["read_file", /<read_file\s+path=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ path: match[1] })],
    ["list_dir", /<list_dir\s+path=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ path: match[1] })],
    ["write_file", /<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/i, (match) => ({ path: match[1], content: match[2].trim() })],
    ["remember", /<remember>\s*([\s\S]*?)\s*<\/remember>/i, (match) => ({ content: match[1].trim() })],
    ["search_web", /<search_web\s+query=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ query: match[1] })],
    ["read_image", /<read_image\s+path=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ path: match[1] })],
    ["search_document", /<search_document\s+path=["']([^"']+)["']\s+query=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ path: match[1], query: match[2] })],
    ["search_workspace", /<search_workspace\s+query=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ query: match[1] })],
    ["execute_command", /<execute_command>\s*([\s\S]*?)\s*<\/execute_command>/i, (match) => ({ command: match[1].trim() })],
    ["send_file", /<send_file\s+path=["']([^"']+)["']\s*\/?\s*>/i, (match) => ({ path: match[1] })],
  ];
  for (const [name, pattern, argumentsFromMatch] of patterns) {
    const match = text.match(pattern);
    if (match) return { name, arguments: argumentsFromMatch(match) };
  }

  const browse = text.match(/<browse_web\s+action=["']([^"']+)["']\s+url=["']([^"']+)["'](?:\s+selector=["']([^"']*)["'])?(?:\s+input=["']([^"']*)["'])?\s*\/?\s*>/i);
  if (browse) {
    return { name: "browse_web", arguments: { action: browse[1], url: browse[2], selector: browse[3], input: browse[4] } };
  }
  return null;
}

export function parseAgentEnvelope(text: string): AgentEnvelope {
  const structured = parseStructured(text);
  if (structured) return structured;
  const thinking = text.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim();
  const toolCall = legacyTool(text);
  let assistantResponse = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (toolCall) {
    assistantResponse = assistantResponse
      .replace(/<(?:read_file|list_dir|search_web|read_image|search_document|search_workspace|send_file|browse_web)\b[^>]*\/?\s*>/gi, "")
      .replace(/<(?:write_file|remember|execute_command)\b[^>]*>[\s\S]*?<\/(?:write_file|remember|execute_command)>/gi, "")
      .trim();
  }
  return { assistantResponse, thinking, toolCall, structured: false };
}

export function toolRisk(name: ToolName): "read" | "network" | "write" | "execute" {
  if (["read_file", "list_dir", "read_image", "search_document", "search_workspace"].includes(name)) return "read";
  if (["search_web", "browse_web", "send_file", "mcp_call"].includes(name)) return "network";
  if (["write_file", "remember"].includes(name)) return "write";
  return "execute";
}

export function toolSummary(call: AgentToolCall): string {
  const path = typeof call.arguments.path === "string" ? call.arguments.path : "";
  const query = typeof call.arguments.query === "string" ? call.arguments.query : "";
  const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
  if (path) return `${call.name}: ${path}`;
  if (query) return `${call.name}: ${query}`;
  if (command) return `${call.name}: ${command}`;
  if (call.name === "mcp_call") return `mcp_call: ${String(call.arguments.tool || "unknown tool")}`;
  return call.name.replace(/_/g, " ");
}
export function isUnfinishedToolPromise(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || /\b(?:cannot|can't|unable to|won't|will not)\b/i.test(normalized)) return false;
  return /\b(?:let me|i(?:'ll| will)|i(?:'d| would) like to)\b.{0,220}\b(?:explor|inspect|look|check|search|read|open|review|find)\w*/i.test(normalized);
}
