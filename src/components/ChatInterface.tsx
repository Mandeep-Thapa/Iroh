import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Cpu, ChevronDown, Copy, RefreshCcw, Check, Sparkles, Globe, Terminal, BrainCircuit, Eye, Wrench, Maximize2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LLMSettings, ReasoningLog, TaskStep, Message, Skill, Rule } from "../types";

const getModelCapabilities = (modelName: string | undefined | null) => {
  if (!modelName) return null;
  const name = modelName.toLowerCase();
  return {
    vision: name.includes('gpt-4o') || name.includes('claude-3-5') || name.includes('llava') || name.includes('gemini-1.5') || name.includes('vision'),
    reasoning: name.includes('o1') || name.includes('o3') || name.includes('r1') || name.includes('deepseek-reasoner') || name.includes('thinking'),
    tools: !name.includes('o1') && !name.includes('deepseek-r1') && !name.includes('r1'), 
    context: (name.includes('claude') || name.includes('gpt-4o') || name.includes('gemini')) ? '128k+' : 
             name.includes('32k') ? '32k+' : '8k+'
  };
};

interface ChatInterfaceProps {
  isInitialized: boolean; workspace: string; username: string; password: string;
  llmSettings: LLMSettings; setLlmSettings: React.Dispatch<React.SetStateAction<LLMSettings>>;
  availableModels: string[]; messages: Message[]; onMessagesChange: (msgs: Message[]) => void;
  onCommandExecuted: (cmd: string) => void; onUpdateReasoningLog: (log: ReasoningLog) => void;
  skills: Skill[]; rules: Rule[]; activeSkillId: string;
  onActiveSkillChange: (id: string) => void;
}

export interface ChatInterfaceHandle {
  handleExternalMessage: (text: string | null | undefined, chatId: number, fileId?: string, fileName?: string) => Promise<void>;
}

const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(({ 
  isInitialized, workspace, username, password, llmSettings, setLlmSettings, 
  availableModels, messages, onMessagesChange, onCommandExecuted, onUpdateReasoningLog,
  skills, rules, activeSkillId, onActiveSkillChange
}, ref) => {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  
  // Feature Toggles
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [executeCommandEnabled, setExecuteCommandEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [lastTelegramChatId, setLastTelegramChatId] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    handleExternalMessage: async (text: string | null | undefined, chatId: number, fileId?: string, fileName?: string) => {
      if (!isInitialized) return;
      setLastTelegramChatId(chatId);
      
      let systemFileMessage = "";
      if (fileId && fileName && llmSettings.telegramToken) {
        try {
          await invoke<string>("download_telegram_file", { 
            token: llmSettings.telegramToken, 
            fileId: fileId, 
            fileName: fileName, 
            workspace 
          });
          systemFileMessage = `\n[System] User attached a file: ${fileName}. It has been downloaded successfully to the workspace. You can read it using <read_file path="...\\\\${fileName}">`;
        } catch (e: any) {
          systemFileMessage = `\n[System] User attempted to attach a file (${fileName}), but the download failed: ${e}`;
        }
      }
      
      const cmdText = (text || "").trim().toLowerCase();
      
      if (cmdText === '/newchat') {
        onMessagesChange([]);
        if (llmSettings.telegramToken) {
          try {
            await invoke("send_telegram_message", { token: llmSettings.telegramToken, chatId, text: "Chat history cleared. Starting fresh!" });
          } catch (e) { console.error("Failed to send telegram reply:", e); }
        }
        return;
      }
      
      if (cmdText.startsWith('/change model ')) {
        const modelName = (text || "").trim().substring(14).trim();
        
        if (llmSettings.provider === 'ollama') {
          setLlmSettings(prev => ({ ...prev, ollamaModel: modelName }));
        } else if (llmSettings.provider === 'openai') {
          setLlmSettings(prev => ({ ...prev, openaiModel: modelName }));
        } else {
          setLlmSettings(prev => ({ ...prev, anthropicModel: modelName }));
        }
        
        if (llmSettings.telegramToken) {
          try {
            await invoke("send_telegram_message", { token: llmSettings.telegramToken, chatId, text: `Model changed to: ${modelName}` });
          } catch (e) { console.error("Failed to send telegram reply:", e); }
        }
        return;
      }

      const finalContent = `${text || ""}${systemFileMessage}`.trim();
      if (!finalContent) return; // ignore empty messages with no file

      const newHistory = [...messages, { role: "user" as const, content: finalContent }];
      onMessagesChange(newHistory);
      setIsTyping(true);
      const finalHistory = await runAgentLoop(newHistory, 5);
      setIsTyping(false);
      
      // Get the last assistant message
      const lastMsg = finalHistory[finalHistory.length - 1];
      let responseText = "Done.";
      if (lastMsg && lastMsg.role === 'assistant') {
        responseText = lastMsg.content;
      } else if (lastMsg && lastMsg.role === 'system') {
        responseText = lastMsg.content.slice(0, 1000); // truncate if too long
      }

      if (llmSettings.telegramToken) {
        try {
          await invoke("send_telegram_message", {
            token: llmSettings.telegramToken,
            chatId: chatId,
            text: responseText
          });
        } catch (e) {
          console.error("Failed to send telegram reply:", e);
        }
      }
    }
  }));

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) setShowModelPicker(false);
      if (skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) setShowSkillPicker(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);

  const extractThinkingText = (text: string) => text.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim() || "Generated structured response.";

  const executeExtractedCommand = async (text: string, currentSteps: TaskStep[]): Promise<string | null> => {
    // 1. Check for <read_file>
    const readFileMatch = text.match(/<read_file\s+path=["']([^"']+)["']/);
    if (readFileMatch) {
      const path = readFileMatch[1];
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Read File', status: 'running', details: path }
      ]});
      try {
        const out = await invoke<string>("read_file_safe", { path, workspace });
        return `Read file ${path} successfully.\nContent:\n${out}`;
      } catch (err: any) {
        return `[ERROR] Failed to read ${path}: ${err}`;
      }
    }

    // 2. Check for <list_dir>
    const listDirMatch = text.match(/<list_dir\s+path=["']([^"']+)["']/);
    if (listDirMatch) {
      const path = listDirMatch[1];
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'List Dir', status: 'running', details: path }
      ]});
      try {
        const res = await invoke<string>("list_dir_safe", { path, workspace });
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
          ...currentSteps, { id: String(currentSteps.length + 1), title: 'List Dir', status: 'completed', details: `${res.length} bytes` }
        ]});
        return res;
      } catch (err: any) {
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
          ...currentSteps, { id: String(currentSteps.length + 1), title: 'List Dir', status: 'failed', details: err.toString() }
        ]});
        return `[ERROR]: ${err.toString()}`;
      }
    }

    // 3. Check for <write_file>
    const writeFileMatch = text.match(/<write_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/write_file>/);
    if (writeFileMatch) {
      const path = writeFileMatch[1];
      const content = writeFileMatch[2].trim();
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Snapshot', status: 'completed', details: 'Backup created' },
        { id: String(currentSteps.length + 2), title: 'Write File', status: 'running', details: path }
      ]});
      try {
        await invoke("create_snapshot", { workspace });
        const out = await invoke<string>("write_file_safe", { path, content, workspace });
        return out;
      } catch (err: any) {
        return `[ERROR] Failed to write ${path}: ${err}`;
      }
    }

    // 4. Check for <remember>
    const rememberMatch = text.match(/<remember>\n?([\s\S]*?)\n?<\/remember>/);
    if (rememberMatch) {
      const content = rememberMatch[1].trim();
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Remember', status: 'running', details: 'Saving to Brain' }
      ]});
      try {
        const out = await invoke<string>("remember_safe", { content, workspace });
        return out;
      } catch (err: any) {
        return `[ERROR] Failed to save memory: ${err}`;
      }
    }

    // 5. Check for <search_web>
    const searchWebMatch = text.match(/<search_web\s+query=["']([^"']+)["']/);
    if (searchWebMatch) {
      const query = searchWebMatch[1];
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Search Web', status: 'running', details: query }
      ]});
      try {
        const out = await invoke<string>("search_web", { query });
        return out;
      } catch (err: any) {
        return `[ERROR] Search failed: ${err}`;
      }
    }

    // 5.5 Check for <send_file>
    const sendFileMatch = text.match(/<send_file\s+path=["']([^"']+)["']/);
    if (sendFileMatch && llmSettings.telegramToken) {
      const path = sendFileMatch[1];
      if (!lastTelegramChatId) {
        return `[ERROR] Cannot send file. No Telegram chat is currently active. User must message the bot first.`;
      }
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Send File', status: 'running', details: path }
      ]});
      try {
        const out = await invoke<string>("send_telegram_file", { 
          token: llmSettings.telegramToken,
          chatId: lastTelegramChatId,
          filePath: path
        });
        return out;
      } catch (err: any) {
        return `[ERROR] Failed to send file: ${err}`;
      }
    }

    // 5.6 Check for <browse_web>
    const browseWebMatch = text.match(/<browse_web\s+action=["']([^"']+)["']\s+url=["']([^"']+)["'](?:\s+selector=["']([^"']+)["'])?(?:\s+input=["']([^"']+)["'])?/);
    if (browseWebMatch) {
      const action = browseWebMatch[1];
      const url = browseWebMatch[2];
      const selector = browseWebMatch[3] || null;
      const inputStr = browseWebMatch[4] || null;
      
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Browser', status: 'running', details: `${action}: ${url}` }
      ]});
      try {
        const out = await invoke<string>("browse_web_action", { url, action, selector, input: inputStr });
        if (action === "screenshot_base64") {
          return `[IMAGE_DATA_SUCCESS:${out}]`;
        }
        return out;
      } catch (err: any) {
        return `[ERROR] Browser failed: ${err}`;
      }
    }

    // 5.7 Check for <read_image>
    const readImageMatch = text.match(/<read_image\s+path=["']([^"']+)["']/);
    if (readImageMatch) {
      const path = readImageMatch[1];
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Read Image', status: 'running', details: path }
      ]});
      try {
        const b64 = await invoke<string>("read_image_base64", { path, workspace });
        return `[IMAGE_DATA_SUCCESS:${b64}]`;
      } catch (err: any) {
        return `[ERROR] Failed to read image: ${err}`;
      }
    }

    // 5.8 Check for <search_document>
    const searchDocMatch = text.match(/<search_document\s+path=["']([^"']+)["']\s+query=["']([^"']+)["']/);
    if (searchDocMatch) {
      const path = searchDocMatch[1];
      const query = searchDocMatch[2];
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'RAG Search', status: 'running', details: query }
      ]});
      try {
        const out = await invoke<string>("search_document", { path, query, workspace });
        return out;
      } catch (err: any) {
        return `[ERROR] RAG Search failed: ${err}`;
      }
    }

    // 6. Fallback to <execute_command> or ```powershell
    const runCmdMatch = text.match(/<execute_command>\n([\s\S]*?)\n<\/execute_command>/) || text.match(/```(?:bash|cmd|powershell)?\n([\s\S]*?)```/);
    if (runCmdMatch?.[1]) {
      const cmd = runCmdMatch[1].trim();
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
        ...currentSteps, { id: String(currentSteps.length + 1), title: 'Snapshot', status: 'completed', details: 'Backup created' },
        { id: String(currentSteps.length + 2), title: 'Run Command', status: 'completed', details: cmd },
        { id: String(currentSteps.length + 3), title: `Executing as ${username}`, status: 'running', details: `Working dir: ${workspace.split(',')[0]?.trim()}` }
      ]});
      onCommandExecuted(cmd);
      try {
        await invoke("create_snapshot", { workspace });
        const out = await invoke<string>("execute_sandboxed_cmd", { command: cmd, username, password, workspace });
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
          ...currentSteps, { id: String(currentSteps.length + 1), title: 'Run Command', status: 'completed', details: cmd },
          { id: String(currentSteps.length + 2), title: 'Sandbox Execution', status: 'completed', details: `${out.length} bytes returned` },
        ]});
        return out;
      } catch (err: any) {
        const isBlocked = err.toString().includes("Security Enforcer Block");
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(text), steps: [
          ...currentSteps, { id: String(currentSteps.length + 1), title: 'Run Command', status: 'completed', details: cmd },
          { id: String(currentSteps.length + 2), title: 'Sandbox Execution', status: isBlocked ? 'blocked' : 'failed', details: err.toString() },
        ]});
        return `[ERROR]: ${err.toString()}`;
      }
    }
    return null;
  };

  const getActiveModelName = () => {
    if (llmSettings.provider === 'ollama') return llmSettings.ollamaModel || '(select model)';
    if (llmSettings.provider === 'openai') return llmSettings.openaiModel || '(select model)';
    return llmSettings.anthropicModel || '(select model)';
  };

  const setActiveModel = (model: string) => {
    if (llmSettings.provider === 'ollama') setLlmSettings(prev => ({ ...prev, ollamaModel: model }));
    else if (llmSettings.provider === 'openai') setLlmSettings(prev => ({ ...prev, openaiModel: model }));
    else setLlmSettings(prev => ({ ...prev, anthropicModel: model }));
    setShowModelPicker(false);
  };

  const activeSkill = skills.find(s => s.id === activeSkillId) || skills[0];

  const buildSystemPrompt = async (): Promise<string> => {
    const primaryWorkspace = workspace.split(',').map(s => s.trim()).filter(Boolean)[0] || '';
    
    let workspaceTree = "";
    let brainKnowledge = "";
    try {
      if (primaryWorkspace) {
        workspaceTree = await invoke<string>("get_workspace_tree", { path: primaryWorkspace });
        brainKnowledge = await invoke<string>("read_knowledge_safe", { workspace });
      }
    } catch (e) {
      console.warn("Failed to get workspace context:", e);
    }

    const baseContext = `You are an agentic desktop AI coding assistant running in a sandboxed Windows environment.
WORKSPACE: ${primaryWorkspace}

WORKSPACE FILE TREE:
${workspaceTree || "(No files found or unable to read workspace)"}

PERSISTENT KNOWLEDGE (The Brain):
${brainKnowledge || "(Brain is currently empty)"}

You have access to the following native XML tools. Use them to interact with the environment instead of raw PowerShell whenever possible:

<read_file path="absolute/path/to/file.txt" />
Reads the content of a text file.

<read_image path="absolute/path/to/image.png" />
Reads the content of an image file and injects it directly into your vision context (only use if you support vision!).

<write_file path="absolute/path/to/file.txt">
content to write
</write_file>
Writes or overwrites a file with the exact content provided.

<list_dir path="absolute/path/to/dir" />
Lists contents of a directory.

<remember>
some fact or preference to save to your persistent Brain memory
</remember>
Use this to save preferences, project gotchas, or long-term context.

${webSearchEnabled ? `<search_web query="your search query" />\nSearches DuckDuckGo and returns web snippets and links.\n` : ''}
${executeCommandEnabled ? `<execute_command>\nnpm install package\n</execute_command>\nRuns a sandboxed shell command in the workspace. Use this to run scripts, start servers, or manage dependencies.\n` : ''}
<send_file path="absolute/path/to/file.pdf" />
Sends a generated or existing file from the workspace back to the user via Telegram.

<browse_web action="read|click|type|screenshot_base64" url="https://example.com" selector="#my-button" input="text to type" />
Provides true browser automation. Use action="read" to extract text. Use action="screenshot_base64" to view the page visually. selector and input are optional depending on the action.

<search_document path="absolute/path/to/file.pdf" query="your keywords" />
Uses a local Vector/RAG approach to quickly extract the most relevant paragraphs from a massive PDF or text document without blowing up your context limit.

IMPORTANT RULES:
1. Always use absolute paths within the workspace for file operations.
2. Only output ONE tool call at a time. Wait for the result before proceeding.
3. Never try to write files outside the workspace boundary.
${!thinkingEnabled ? "4. DO NOT output <think> tags. Respond directly without thinking." : ""}`;
    const skillSection = activeSkill ? `\n\n--- ACTIVE SKILL: ${activeSkill.name} ---\n${activeSkill.systemPrompt}` : '';
    const enabledRules = rules.filter(r => r.enabled);
    const rulesSection = enabledRules.length > 0
      ? `\n\n--- USER RULES ---\n${enabledRules.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}`
      : '';
    return baseContext + skillSection + rulesSection;
  };

  const fetchLLMResponse = async (history: Message[], signal: AbortSignal): Promise<string> => {
    const systemPrompt = await buildSystemPrompt();
    
    // Combine consecutive messages of the same role to prevent LLM template crashing
    const collapsedHistory: Message[] = [];
    for (const m of history) {
      const role = m.role === 'system' ? 'user' : m.role;
      const content = m.role === 'system' ? `[System Log]: ${m.content}` : m.content;
      
      const last = collapsedHistory[collapsedHistory.length - 1];
      if (last && last.role === role) {
        last.content += `\n\n${content}`;
        if (m.images && m.images.length > 0) {
          last.images = [...(last.images || []), ...m.images];
        }
      } else {
        collapsedHistory.push({ role: role as MessageRole, content, images: m.images ? [...m.images] : undefined });
      }
    }

    const apiMessages = collapsedHistory.map(m => {
      const textContent = m.content;
      if (!m.images || m.images.length === 0) return { role: m.role, content: textContent };

      if (llmSettings.provider === 'ollama') {
        const strippedImages = m.images.map(img => img.split(',')[1] || img);
        return { role: m.role, content: textContent, images: strippedImages };
      } else if (llmSettings.provider === 'openai') {
        return {
          role: m.role,
          content: [
            { type: "text", text: textContent },
            ...m.images.map(img => ({ type: "image_url", image_url: { url: img } }))
          ]
        };
      } else {
        return {
          role: m.role,
          content: [
            { type: "text", text: textContent },
            ...m.images.map(img => {
              const [prefix, data] = img.split(',');
              const media_type = prefix.split(':')[1].split(';')[0];
              return { type: "image", source: { type: "base64", media_type, data } };
            })
          ]
        };
      }
    });
    if (llmSettings.provider === 'ollama') {
      const endpoint = llmSettings.ollamaEndpoint || "http://localhost:11434";
      const res = await fetch(`${endpoint}/api/chat`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ 
          model: llmSettings.ollamaModel, 
          messages: [{ role: "system", content: systemPrompt }, ...apiMessages], 
          stream: false, 
          options: { num_ctx: llmSettings.contextLength || 32768 } 
        }), 
        signal 
      });
      if (!res.ok) throw new Error(`Ollama error (${res.status})`);
      const data = await res.json();
      if (!data.message?.content) {
        throw new Error("Ollama returned an empty response. This usually means the Context Length (slider) is set too high for your available VRAM, causing an out-of-memory error in Ollama.");
      }
      return data.message.content;
    } 
    else if (llmSettings.provider === 'openai') {
      if (!llmSettings.openaiKey) throw new Error("OpenAI API Key missing.");
      const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${llmSettings.openaiKey}` }, body: JSON.stringify({ model: llmSettings.openaiModel, messages: [{ role: "system", content: systemPrompt }, ...apiMessages] }), signal });
      if (!res.ok) throw new Error(`OpenAI error (${res.status})`);
      return (await res.json()).choices[0]?.message?.content || "";
    }
    else {
      if (!llmSettings.anthropicKey) throw new Error("Anthropic API Key missing.");
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": llmSettings.anthropicKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: llmSettings.anthropicModel, max_tokens: 4096, system: systemPrompt, messages: apiMessages }), signal });
      if (!res.ok) throw new Error(`Anthropic error (${res.status})`);
      return (await res.json()).content[0]?.text || "";
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsTyping(false);
      onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: "Generation stopped.", steps: [{ id: '1', title: 'Stopped', status: 'blocked', details: 'User cancelled.' }] });
    }
  };

  const runAgentLoop = async (initialHistory: Message[], maxDepth = 5): Promise<Message[]> => {
    let currentHistory = [...initialHistory];
    let depth = 0;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    while (depth < maxDepth) {
      if (controller.signal.aborted) break;
      depth++;
      try {
        const charCount = currentHistory.reduce((acc, msg) => acc + msg.content.length, 0);
        if (charCount > 20000 && currentHistory.length > 5) {
          onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: `Context size (${charCount} chars) exceeds limit. Compressing history...`, steps: [{ id: 'compress', title: `Context Compression`, status: 'running', details: `Compressing ${currentHistory.length - 3} messages` }] });
          const messagesToCompress = currentHistory.slice(0, currentHistory.length - 3);
          const recentMessages = currentHistory.slice(currentHistory.length - 3);
          const summaryPrompt: Message[] = [...messagesToCompress, { role: "user", content: "Summarize our conversation and actions above concisely, focusing on what was built, what tools were used, and any important context." }];
          const summary = await fetchLLMResponse(summaryPrompt, controller.signal);
          currentHistory = [{ role: "assistant", content: `[SYSTEM: Context compressed due to length]\nPrevious context summary:\n${summary.replace(/<think>[\s\S]*?<\/think>/, '').trim()}` }, ...recentMessages];
          onMessagesChange(currentHistory);
        }

        const stepNum = (depth - 1) * 3;
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: `Iteration ${depth}/${maxDepth} — Calling ${llmSettings.provider}...`, steps: [{ id: String(stepNum + 1), title: `LLM Call #${depth}`, status: 'running', details: `Model: ${getActiveModelName()}` }] });
        const reply = await fetchLLMResponse(currentHistory, controller.signal);
        const completedSteps: TaskStep[] = [{ id: String(stepNum + 1), title: `LLM Call #${depth}`, status: 'completed', details: `${reply.length} chars` }];
        const cleanReply = reply.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        currentHistory = [...currentHistory, { role: "assistant", content: cleanReply || reply }];
        onMessagesChange(currentHistory);
        const cmdOutput = await executeExtractedCommand(reply, completedSteps);
        if (cmdOutput) {
          if (cmdOutput.startsWith('[IMAGE_DATA_SUCCESS:')) {
            const b64 = cmdOutput.slice(20, -1);
            currentHistory = [...currentHistory, { role: "system", content: `Image loaded successfully.`, images: [b64] }];
            onMessagesChange(currentHistory);
          } else {
            currentHistory = [...currentHistory, { role: "system", content: `Output:\n${cmdOutput}` }];
            onMessagesChange(currentHistory);
          }
        } else {
          onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: extractThinkingText(reply), steps: [...completedSteps, { id: String(stepNum + 2), title: 'Done', status: 'completed', details: 'No further commands.' }] });
          break; 
        }
      } catch (e: any) {
        if (e.name === 'AbortError') break;
        onUpdateReasoningLog({ timestamp: new Date().toLocaleTimeString(), thinkingText: `Error: ${e.message}`, steps: [{ id: '1', title: 'Error', status: 'failed', details: e.message }] });
        currentHistory = [...currentHistory, { role: "system", content: `❌ ${e.message}` }];
        onMessagesChange(currentHistory);
        break;
      }
    }
    abortControllerRef.current = null;
    return currentHistory;
  };

  const handleSend = async () => {
    if (!input.trim() || !isInitialized) return;
    const userMsg = input.trim();
    setInput("");
    const newHistory = [...messages, { role: "user" as const, content: userMsg }];
    onMessagesChange(newHistory);
    setIsTyping(true);
    await runAgentLoop(newHistory, 5);
    setIsTyping(false);
  };

  const handleRetry = async (text: string) => {
    if (!isInitialized || isTyping) return;
    const newHistory = [...messages, { role: "user" as const, content: text }];
    onMessagesChange(newHistory);
    setIsTyping(true);
    await runAgentLoop(newHistory, 5);
    setIsTyping(false);
  };

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) { console.error("Failed to copy", err); }
  };

  const hasModel = getActiveModelName() && !getActiveModelName().includes('select model');
  const caps = hasModel ? getModelCapabilities(getActiveModelName()) : null;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-hidden relative h-full font-sans">
      {/* Toolbar */}
      <div className="h-10 border-b-[2px] border-border bg-surface flex items-center justify-between px-4 z-10 shrink-0">
        <div className="flex items-center">
          {/* Skill Picker */}
          <div className="relative mr-4 border-r-[2px] border-border pr-4" ref={skillPickerRef}>
            <button onClick={() => setShowSkillPicker(!showSkillPicker)}
              className="flex items-center space-x-1.5 px-3 py-1 bg-brutalYellow text-accentText border-[2px] border-border text-[11px] font-display font-black uppercase hover:brightness-110 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{activeSkill?.name || 'General'}</span>
              <ChevronDown className={`w-3 h-3 stroke-[3] transition-transform ${showSkillPicker ? 'rotate-180' : ''}`} />
            </button>
            {showSkillPicker && skills.length > 0 && (
              <div className="absolute left-0 top-full mt-1 bg-surface border-[2px] border-border shadow-brutal z-50 max-h-60 overflow-y-auto min-w-[240px] custom-scrollbar">
                {skills.map(skill => (
                  <button key={skill.id} onClick={() => { onActiveSkillChange(skill.id); setShowSkillPicker(false); }}
                    className={`w-full text-left px-4 py-3 border-b border-border last:border-b-0 transition-colors ${
                      skill.id === activeSkillId ? 'bg-brutalBlue text-cream' : 'hover:bg-surfaceAlt text-primary'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-base">{skill.icon}</span>
                      <div>
                        <div className="text-xs font-bold">{skill.name}</div>
                        <div className={`text-[10px] ${skill.id === activeSkillId ? 'text-cream/70' : 'text-textMuted'}`}>{skill.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Capabilities Badges */}
          {caps && (
            <div className="flex items-center space-x-2 mr-3 opacity-90 hidden sm:flex">
              <span className={`flex items-center space-x-1 ${caps.vision ? 'text-brutalYellow drop-shadow-sm' : 'text-textMuted/40'}`} title={`Vision: ${caps.vision ? 'Supported' : 'Not Supported'}`}>
                <Eye className="w-4 h-4 stroke-[2.5]" />
              </span>
              <span className={`flex items-center space-x-1 ${caps.reasoning ? 'text-brutalBlue drop-shadow-sm' : 'text-textMuted/40'}`} title={`Thinking/Reasoning: ${caps.reasoning ? 'Supported' : 'Not Supported'}`}>
                <BrainCircuit className="w-4 h-4 stroke-[2.5]" />
              </span>
              <span className={`flex items-center space-x-1 ${caps.tools ? 'text-green-500 drop-shadow-sm' : 'text-textMuted/40'}`} title={`Tool Calling: ${caps.tools ? 'Supported' : 'Not Supported'}`}>
                <Wrench className="w-4 h-4 stroke-[2.5]" />
              </span>
              <span className="flex items-center text-primary text-[10px] font-black tracking-widest ml-1 bg-surfaceAlt px-1.5 py-0.5 rounded border border-border" title="Context Window Size">
                <Maximize2 className="w-3 h-3 stroke-[3] mr-1" />
                {caps.context}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Toggles */}
          <div className="flex space-x-1 mr-2 border-r-[2px] border-border pr-3">
            <button onClick={() => setWebSearchEnabled(!webSearchEnabled)} className={`p-1 border-[2px] border-border transition-colors ${webSearchEnabled ? 'bg-brutalBlue text-cream' : 'bg-surface text-textMuted hover:bg-surfaceAlt'}`} title="Web Search">
              <Globe className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
            <button onClick={() => setExecuteCommandEnabled(!executeCommandEnabled)} className={`p-1 border-[2px] border-border transition-colors ${executeCommandEnabled ? 'bg-brutalBlue text-cream' : 'bg-surface text-textMuted hover:bg-surfaceAlt'}`} title="Execute Commands">
              <Terminal className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
            <button onClick={() => setThinkingEnabled(!thinkingEnabled)} className={`p-1 border-[2px] border-border transition-colors ${thinkingEnabled ? 'bg-brutalBlue text-cream' : 'bg-surface text-textMuted hover:bg-surfaceAlt'}`} title="Thinking">
              <BrainCircuit className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>

          <span className="text-textMuted text-[10px] font-display font-black uppercase tracking-widest flex items-center space-x-1">
            <Cpu className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{llmSettings.provider}</span>
          </span>
          <div className="relative" ref={modelPickerRef}>
            <button onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center space-x-1.5 px-3 py-1 bg-primary text-cream border-[2px] border-border text-[11px] font-display font-black uppercase hover:bg-brutalBlue transition-colors"
            >
              <span>{getActiveModelName()}</span>
              <ChevronDown className={`w-3 h-3 stroke-[3] transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
            </button>
            {showModelPicker && availableModels.length > 0 && (
              <div className="absolute right-0 top-full mt-1 bg-surface border-[2px] border-border shadow-brutal z-50 max-h-60 overflow-y-auto min-w-[220px] custom-scrollbar">
                {availableModels.map(model => (
                  <button key={model} onClick={() => setActiveModel(model)}
                    className={`w-full text-left px-4 py-2.5 text-sm font-bold border-b border-border last:border-b-0 transition-colors ${
                      model === getActiveModelName() ? 'bg-brutalBlue text-cream' : 'hover:bg-surfaceAlt text-primary'
                    }`}
                  >
                    {model}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-cream custom-scrollbar">
        {/* Empty State */}
        {messages.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-textMuted pointer-events-none opacity-50 z-0">
            <Cpu className="w-20 h-20 mb-4" strokeWidth={1} />
            <h2 className="font-display font-black tracking-widest uppercase text-xl text-primary">Antigravity Sandbox</h2>
            <p className="font-sans text-sm mt-2 text-center max-w-sm">Use the tools panel on the right to interact safely with your local files.</p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex space-x-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role !== 'user' && (
              <div className={`w-8 h-8 border-[2px] border-border flex items-center justify-center shrink-0 text-[9px] font-display font-black uppercase ${
                msg.role === 'system' ? 'bg-brutalYellow text-accentText' : 'bg-primary text-cream'
              }`}>
                {msg.role === 'system' ? 'SYS' : 'AI'}
              </div>
            )}
            
            <div className="max-w-[80%] flex flex-col group">
              <div className={`p-3 text-sm rounded max-w-[85%] border-[2px] border-border shadow-brutal-sm ${
                msg.role === 'user' 
                  ? 'bg-brutalBlue text-cream font-bold' 
                  : msg.role === 'system' 
                    ? 'bg-surfaceAlt text-primary font-mono text-xs font-bold' 
                    : 'bg-surface text-primary'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed font-sans text-primary">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content
                        .replace(/<think>/g, '&lt;think&gt;').replace(/<\/think>/g, '&lt;/think&gt;')
                        .replace(/<list_dir/g, '&lt;list_dir').replace(/<\/list_dir>/g, '&lt;/list_dir&gt;')
                        .replace(/<read_file/g, '&lt;read_file').replace(/<\/read_file>/g, '&lt;/read_file&gt;')
                        .replace(/<write_file/g, '&lt;write_file').replace(/<\/write_file>/g, '&lt;/write_file&gt;')
                        .replace(/<search_web/g, '&lt;search_web').replace(/<\/search_web>/g, '&lt;/search_web&gt;')
                        .replace(/<execute_command>/g, '&lt;execute_command&gt;').replace(/<\/execute_command>/g, '&lt;/execute_command&gt;')
                        .replace(/<remember>/g, '&lt;remember&gt;').replace(/<\/remember>/g, '&lt;/remember&gt;')
                        || "*(Received empty response from the AI model)*"}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
              
              {/* Action Bar */}
              <div className={`flex space-x-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <button onClick={() => handleCopy(msg.content, idx)} title="Copy"
                  className="w-6 h-6 bg-surfaceAlt text-textMuted border border-border flex items-center justify-center hover:bg-brutalYellow hover:text-accentText transition-colors text-[10px]">
                  {copiedIndex === idx ? <Check className="w-3 h-3 stroke-[3] text-brutalBlue" /> : <Copy className="w-3 h-3 stroke-[2]" />}
                </button>
                {msg.role === 'user' && (
                  <button onClick={() => handleRetry(msg.content)} title="Retry"
                    className="w-6 h-6 bg-surfaceAlt text-textMuted border border-border flex items-center justify-center hover:bg-brutalBlue hover:text-cream transition-colors">
                    <RefreshCcw className="w-3 h-3 stroke-[2]" />
                  </button>
                )}
              </div>
            </div>

            {msg.role === 'user' && (
              <div className="w-8 h-8 border-[2px] border-border flex items-center justify-center shrink-0 bg-brutalYellow text-accentText font-display font-black text-[9px] uppercase">
                YOU
              </div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="flex space-x-3 items-center">
            <div className="w-8 h-8 border-[2px] border-border flex items-center justify-center shrink-0 bg-primary text-cream font-display font-black text-[9px] uppercase animate-pulse">AI</div>
            <div className="bg-surface border-[2px] border-border p-3 flex space-x-2">
              <div className="w-2.5 h-2.5 bg-textMuted animate-bounce"></div>
              <div className="w-2.5 h-2.5 bg-textMuted animate-bounce [animation-delay:0.15s]"></div>
              <div className="w-2.5 h-2.5 bg-textMuted animate-bounce [animation-delay:0.3s]"></div>
            </div>
          </div>
        )}
        <div ref={endOfMessagesRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-surface border-t-[2px] border-border shrink-0">
        <div className="relative flex items-center space-x-3">
          <input 
            type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !isTyping && handleSend()}
            disabled={!isInitialized || !hasModel}
            placeholder={!isInitialized ? "Initializing..." : !hasModel ? "Select model" : `Message ${getActiveModelName()}...`}
            className="flex-1 bg-cream border-[2px] border-border text-primary px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-brutalBlue disabled:opacity-50 placeholder:text-textMuted transition-colors rounded-none"
          />
          {isTyping ? (
            <button onClick={stopGeneration} className="px-5 py-2.5 bg-brutalRed text-cream border-[2px] border-border active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:brightness-110 transition-all shrink-0 font-display font-black uppercase text-xs shadow-brutal-sm">
              Stop
            </button>
          ) : (
            <button onClick={handleSend} disabled={!isInitialized || !input.trim() || !hasModel}
              className="px-5 py-2.5 bg-primary text-cream border-[2px] border-border active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:bg-brutalBlue transition-colors disabled:opacity-30 shrink-0 font-display font-black uppercase text-xs shadow-brutal-sm">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatInterface;
