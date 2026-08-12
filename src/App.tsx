import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { 
  Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Plus, Trash2, MessageCircle,
  Moon, Sun
} from "lucide-react";
import ChatInterface, { ChatInterfaceHandle } from "./components/ChatInterface";
import TerminalBridge from "./components/TerminalBridge";
import TaskInspector from "./components/TaskInspector";
import SettingsPage from "./components/SettingsPage";
import { AccessibilitySettings, LLMSettings, McpServerProfile, ReasoningLog, ChatSession, Message, Skill, Rule, SecretStatus, TaskRecipe } from "./types";
import "./index.css";

const DEFAULT_LLM_SETTINGS: LLMSettings = {
  provider: "ollama",
  ollamaEndpoint: "http://127.0.0.1:11434",
  ollamaModel: "",
  openaiModel: "",
  anthropicModel: "",
  airllmEndpoint: "http://127.0.0.1:11435",
  airllmModel: "Qwen/Qwen3-8B",
  airllmPythonPath: "python",
  airllmCacheDir: "",
  airllmCompression: "4bit",
  cloudApiEnabled: false,
  telegramEnabled: false,
  telegramChatId: "",
  contextLength: 32768,
  benchmarkHistory: [],
};

const EMPTY_SECRET_STATUS: SecretStatus = {
  openaiConfigured: false,
  anthropicConfigured: false,
  telegramConfigured: false,
  workerPasswordConfigured: false,
  huggingfaceConfigured: false,
};

const DEFAULT_SKILLS: Skill[] = [
  {
    id: 'skill_general', name: 'General Assistant', icon: '🤖', builtIn: true,
    description: 'Balanced coding helper for any task',
    systemPrompt: 'You are a versatile coding assistant. Write clean, well-documented code. Explain your reasoning clearly. When modifying files, always show the complete result.'
  },
  {
    id: 'skill_review', name: 'Code Review', icon: '🔍', builtIn: true,
    description: 'Focus on bugs, security, performance',
    systemPrompt: 'You are a senior code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and style violations. Provide specific line-level feedback with severity ratings (Critical/Warning/Info). Suggest concrete fixes.'
  },
  {
    id: 'skill_tests', name: 'Test Writer', icon: '🧪', builtIn: true,
    description: 'Generate unit and integration tests',
    systemPrompt: 'You are a testing specialist. Write comprehensive unit tests and integration tests. Cover edge cases, error paths, and boundary conditions. Use appropriate testing frameworks for the language. Aim for high coverage.'
  },
  {
    id: 'skill_devops', name: 'DevOps', icon: '🚀', builtIn: true,
    description: 'CI/CD, Docker, deployment, infra',
    systemPrompt: 'You are a DevOps engineer. Help with CI/CD pipelines, Docker containers, Kubernetes configs, deployment scripts, infrastructure as code, and monitoring. Always consider security best practices and cost optimization.'
  },
  {
    id: 'skill_research', name: 'Research', icon: '📚', builtIn: true,
    description: 'Explain concepts, find docs, teach',
    systemPrompt: 'You are a technical researcher and educator. Explain concepts clearly with examples. Compare alternatives with pros/cons. Cite best practices. When asked about libraries or tools, provide usage examples and gotchas.'
  },
];

const DEFAULT_RECIPES: TaskRecipe[] = [
  { id: "recipe_review", name: "Review this repository", description: "Find correctness, security, and maintainability problems.", prompt: "Review this repository. First inspect the README and project structure, then propose a prioritized plan. Do not change files until I approve the plan.", builtIn: true },
  { id: "recipe_explain", name: "Explain this workspace", description: "Build a cited mental model of the project.", prompt: "Explain this workspace using file-and-line citations. Cover architecture, data flow, setup, and the three most important risks.", builtIn: true },
  { id: "recipe_tests", name: "Repair failing tests", description: "Diagnose locally before making targeted fixes.", prompt: "Run the existing test suite, diagnose failures, show the proposed edits, and wait for approval before writing files.", builtIn: true },
  { id: "recipe_docs", name: "Make it runnable", description: "Validate setup and improve the onboarding path.", prompt: "Read the README, verify the documented setup locally, and propose the smallest changes needed to make this project reliably runnable on a clean machine.", builtIn: true },
];

const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  uiScale: 100,
  reducedMotion: false,
  highContrast: false,
};

function App() {
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [ollamaReady, setOllamaReady] = useState(false);
  const [accessibility, setAccessibility] = useState<AccessibilitySettings>(DEFAULT_ACCESSIBILITY);
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${accessibility.uiScale}%`;
    document.documentElement.classList.toggle("reduce-motion", accessibility.reducedMotion);
    document.documentElement.classList.toggle("high-contrast", accessibility.highContrast);
  }, [accessibility]);

  const [workspace, setWorkspace] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userAlreadyExists, setUserAlreadyExists] = useState(false);
  
  const [secretStatus, setSecretStatus] = useState<SecretStatus>(EMPTY_SECRET_STATUS);
  const [llmSettings, setLlmSettings] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS);

  const [isInitialized, setIsInitialized] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [reasoningLog, setReasoningLog] = useState<ReasoningLog | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

  const [skills, setSkills] = useState<Skill[]>(DEFAULT_SKILLS);
  const [rules, setRules] = useState<Rule[]>([]);
  const [recipes, setRecipes] = useState<TaskRecipe[]>(DEFAULT_RECIPES);
  const [mcpServers, setMcpServers] = useState<McpServerProfile[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string>('skill_general');

  const generateId = () => `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const deriveTitle = (messages: Message[]): string => {
    const firstUser = messages.find(m => m.role === 'user');
    if (firstUser) return firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '...' : '');
    return 'NEW CHAT';
  };

  const refreshSecretStatus = useCallback(async () => {
    try {
      setSecretStatus(await invoke<SecretStatus>("get_secret_status"));
    } catch (error) {
      console.error("Failed to read secret status:", error);
    }
  }, []);

  const loadSessionList = useCallback(async () => {
    try {
      const data: any = await invoke("list_chat_sessions");
      setChatSessions(data || []);
    } catch (e) { console.error("Failed to load chat sessions:", e); }
  }, []);

  const saveCurrentSession = useCallback(async (messages: Message[], sessionId?: string) => {
    const id = sessionId || activeSessionId;
    if (!id || messages.length === 0) return;
    const session: ChatSession = {
      id, title: deriveTitle(messages), messages,
      createdAt: chatSessions.find(s => s.id === id)?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await invoke("save_chat_session", { sessionId: id, data: session });
      await loadSessionList();
    } catch (e) { console.error("Failed to save session:", e); }
  }, [activeSessionId, chatSessions, loadSessionList]);

  const createNewChat = () => {
    const id = generateId();
    setActiveSessionId(id);
    setCurrentMessages([]);
    setActiveView('chat');
  };

  const loadSession = async (id: string) => {
    try {
      const data: any = await invoke("load_chat_session", { sessionId: id });
      setActiveSessionId(data.id);
      setCurrentMessages(data.messages || []);
      setActiveView('chat');
    } catch (e) { console.error("Failed to load session:", e); }
  };

  const deleteSession = async (id: string) => {
    try {
      await invoke("delete_chat_session", { sessionId: id });
      if (activeSessionId === id) createNewChat();
      await loadSessionList();
    } catch (e) { console.error("Failed to delete session:", e); }
  };

  // Start Ollama and poll until it's ready
  useEffect(() => {
    if (!isInitialized) return;

    invoke("start_ollama_daemon").catch(console.error);
    
    const pollOllama = async () => {
      const endpoint = llmSettings.ollamaEndpoint || "http://127.0.0.1:11434";
      for (let i = 0; i < 10; i++) {
        try {
          await invoke("fetch_ollama_models", { endpoint });
          setOllamaReady(true); 
          return;
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 2000));
      }
      // Give up after 20 seconds
      setOllamaReady(true); // let the settings page show the error naturally
    };
    pollOllama();
  }, [isInitialized, llmSettings.ollamaEndpoint]);

  useEffect(() => {
    invoke("load_settings")
      .then((data: any) => {
        if (data && Object.keys(data).length > 0) {
          if (data.workspace) setWorkspace(data.workspace);
          if (data.username) setUsername(data.username);
          if (data.userAlreadyExists !== undefined) setUserAlreadyExists(data.userAlreadyExists);
          if (data.telemetryEnabled !== undefined) setTelemetryEnabled(data.telemetryEnabled);
          if (data.llmSettings) setLlmSettings({ ...DEFAULT_LLM_SETTINGS, ...data.llmSettings });
          if (data.isDarkMode !== undefined) setIsDarkMode(data.isDarkMode);
          if (data.activeSkillId) setActiveSkillId(data.activeSkillId);
          if (data.skills && Array.isArray(data.skills)) {
            const savedCustom = (data.skills as Skill[]).filter(s => !s.builtIn);
            const savedBuiltIn = (data.skills as Skill[]).filter(s => s.builtIn);
            const mergedBuiltIns = DEFAULT_SKILLS.map(def => {
              const saved = savedBuiltIn.find(s => s.id === def.id);
              return saved ? { ...def, systemPrompt: saved.systemPrompt } : def;
            });
            setSkills([...mergedBuiltIns, ...savedCustom]);
          }
          if (data.rules && Array.isArray(data.rules)) setRules(data.rules);
          if (data.recipes && Array.isArray(data.recipes)) setRecipes(data.recipes);
          if (data.mcpServers && Array.isArray(data.mcpServers)) setMcpServers(data.mcpServers);
          if (data.accessibility) setAccessibility({ ...DEFAULT_ACCESSIBILITY, ...data.accessibility });
        }
        setHasLoadedSettings(true);
      })
      .catch((err) => { console.error("Failed to load settings:", err); setHasLoadedSettings(true); });
    refreshSecretStatus();
    loadSessionList();
    createNewChat();
  }, [loadSessionList, refreshSecretStatus]);

  useEffect(() => {
    if (!hasLoadedSettings) return;
    const settings = { workspace, username, userAlreadyExists, telemetryEnabled, llmSettings, isDarkMode, skills, rules, recipes, mcpServers, accessibility, activeSkillId };
    invoke("save_settings", { settings }).catch(console.error);
  }, [workspace, username, userAlreadyExists, telemetryEnabled, llmSettings, hasLoadedSettings, isDarkMode, skills, rules, recipes, mcpServers, accessibility, activeSkillId]);

  useEffect(() => {
    if (hasLoadedSettings && !isInitialized && workspace && username && secretStatus.workerPasswordConfigured) {
      const initSandbox = async () => {
        try {
          setTerminalLogs(prev => [...prev, "[SYSTEM] Auto-initializing sandbox environment..."]);
          if (!userAlreadyExists) {
            await invoke("create_user", { username });
            setUserAlreadyExists(true);
          }
          await invoke("initialize_workspace", { pathsStr: workspace, username });
          setIsInitialized(true);
          setTerminalLogs(prev => [...prev, "[SYSTEM] Sandbox Auto-Initialization complete. Ready."]);
        } catch (e: any) {
          setTerminalLogs(prev => [...prev, `[SYSTEM ERROR] ${e}`]);
        }
      };
      initSandbox();
    }
  }, [hasLoadedSettings, isInitialized, workspace, username, secretStatus.workerPasswordConfigured, userAlreadyExists]);

  const reinitializeSandbox = async () => {
    if (!workspace || !username) return;
    try {
      setTerminalLogs(prev => [...prev, "[SYSTEM] Re-initializing sandbox with new settings..."]);
      if (password.trim()) {
        await invoke("set_secret", { name: "worker_password", value: password });
        setPassword("");
        await refreshSecretStatus();
      } else if (!secretStatus.workerPasswordConfigured) {
        throw new Error("Set a worker password before initializing the restricted account.");
      }
      if (!userAlreadyExists) {
        await invoke("create_user", { username });
        setUserAlreadyExists(true);
      }
      await invoke("initialize_workspace", { pathsStr: workspace, username });
      setIsInitialized(true);
      setTerminalLogs(prev => [...prev, "[SYSTEM] Sandbox re-initialized. Ready."]);
    } catch (e: any) {
      setTerminalLogs(prev => [...prev, `[SYSTEM ERROR] ${e}`]);
    }
  };

  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<string>("terminal-output", (event) => {
        setTerminalLogs(prev => [...prev, event.payload]);
        setIsExecuting(false);
      });
      
      const unlistenTelegram = await listen<any>("telegram-message", async (event) => {
        const { chat_id, text, file_id, file_name } = event.payload;
        setTerminalLogs(prev => [...prev, `[TELEGRAM] Msg from ${chat_id}: ${text || file_name}`]);
        if (chatInterfaceRef.current) {
          chatInterfaceRef.current.handleExternalMessage(text, chat_id, file_id, file_name);
        }
      });
      
      return () => {
        unlisten();
        unlistenTelegram();
      };
    };
    
    let isMounted = true;
    let unlistenAll: (() => void) | null = null;
    
    setupListener().then(f => {
      if (!isMounted) {
        // Cleanup was called before setupListener finished!
        f();
      } else {
        unlistenAll = f;
      }
    });
    
    return () => {
      isMounted = false;
      if (unlistenAll) unlistenAll();
    };
  }, []);

  // Handle Telegram Bot lifecycle
  useEffect(() => {
    const allowedChatId = Number(llmSettings.telegramChatId);
    if (llmSettings.telegramEnabled && secretStatus.telegramConfigured && Number.isSafeInteger(allowedChatId) && allowedChatId > 0) {
      invoke("start_telegram_bot", { allowedChatId })
        .then(() => setTerminalLogs(prev => [...prev, "[SYSTEM] Telegram bot polling started."]))
        .catch(console.error);
    } else {
      invoke("stop_telegram_bot").catch(console.error);
    }
    return () => { invoke("stop_telegram_bot").catch(console.error); };
  }, [llmSettings.telegramEnabled, llmSettings.telegramChatId, secretStatus.telegramConfigured]);

  const handleCommandExecuted = (_cmd: string) => {
    setIsExecuting(true);
    if (telemetryEnabled) {
      invoke("log_telemetry", { actionCategory: "command", spawnLatencyMs: 0, sandboxPid: null }).catch(console.error);
    }
  };

  const handleResetWorkspace = async () => {
    try {
      setIsExecuting(true);
      setTerminalLogs(prev => [...prev, "[SYSTEM] Resetting workspace..."]);
      await invoke("reset_workspace", { pathsStr: workspace, username });
      setTerminalLogs(prev => [...prev, "[SYSTEM] Workspace reset successfully."]);
      setIsExecuting(false);
    } catch (e: any) {
      setTerminalLogs(prev => [...prev, `[SYSTEM ERROR] ${e}`]);
      setIsExecuting(false);
    }
  };

  const handleMessagesChange = (messages: Message[]) => {
    setCurrentMessages(messages);
    if (activeSessionId && messages.length > 0) saveCurrentSession(messages, activeSessionId);
  };

  return (
    <div className="h-screen w-full flex overflow-hidden bg-cream text-primary select-none font-sans">
      
      {/* Left Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-0 border-r-0' : 'w-64 border-r-[2px]'} bg-surface border-border flex flex-col z-20 transition-all duration-200 overflow-hidden shrink-0`}>
        <div className="px-4 py-5 border-b-[2px] border-border flex items-center space-x-3 bg-brutalYellow">
          <div className="w-10 h-10 border-[2px] border-accentText flex items-center justify-center text-primary font-display font-black text-sm bg-surface shadow-brutal-sm">
            IR
          </div>
          <span className="text-accentText font-display font-black text-xl uppercase tracking-tighter">Iroh</span>
        </div>

        <div className="p-3 border-b-[2px] border-border">
          <button
            onClick={createNewChat}
            className="w-full flex items-center justify-center space-x-2 bg-primary text-cream py-3 font-display font-bold text-sm uppercase tracking-wider hover:bg-brutalYellow hover:text-accentText border-[2px] border-border transition-colors shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>New Chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {chatSessions.length === 0 ? (
            <div className="text-textMuted text-sm text-center py-8 font-bold uppercase font-display">
              No History
            </div>
          ) : (
            chatSessions.map(session => (
              <div
                key={session.id}
                className={`group flex items-center space-x-2 px-3 py-2.5 cursor-pointer border-[2px] border-border transition-colors ${
                  activeSessionId === session.id
                    ? 'bg-brutalBlue text-cream'
                    : 'bg-surfaceAlt text-primary hover:bg-brutalYellow hover:text-accentText'
                }`}
                onClick={() => loadSession(session.id)}
              >
                <MessageCircle className="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span className="flex-1 text-xs font-bold truncate">{session.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  aria-label={"Delete chat " + session.title}
                  className="opacity-0 group-hover:opacity-100 text-primary hover:text-brutalRed transition-opacity p-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10 bg-cream">
        {/* Header */}
        <header data-tauri-drag-region className="h-12 w-full flex items-center justify-between border-b-[2px] border-border bg-cream px-5 z-50 shrink-0">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="p-1.5 border-[2px] border-border bg-surface shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none transition-all hover:bg-brutalYellow hover:text-accentText text-primary"
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4 stroke-[3]" /> : <ChevronLeft className="w-4 h-4 stroke-[3]" />}
            </button>
            <h1 className="text-sm font-display font-black uppercase tracking-widest pointer-events-none text-primary">
              {activeView === 'chat' ? 'Workspace' : 'Preferences'}
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => setActiveView(activeView === 'settings' ? 'chat' : 'settings')}
              aria-label={activeView === 'settings' ? "Return to chat" : "Open settings"}
              className={`p-1.5 border-[2px] border-border shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none transition-colors ${
                activeView === 'settings' ? 'bg-brutalYellow text-accentText' : 'bg-surface text-primary hover:bg-brutalYellow hover:text-accentText'
              }`}
            >
              <SettingsIcon className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button aria-label={isDarkMode ? "Use light theme" : "Use dark theme"} onClick={() => setIsDarkMode(!isDarkMode)} className={`p-1.5 border-[2px] border-border shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none transition-colors ${isDarkMode ? 'bg-brutalYellow text-accentText' : 'bg-surface text-primary hover:bg-brutalYellow hover:text-accentText'}`}>
              {isDarkMode ? <Sun className="w-4 h-4 stroke-[2.5]" /> : <Moon className="w-4 h-4 stroke-[2.5]" />}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {activeView === 'chat' ? (
            <div className="flex-1 flex w-full h-full">
              <div className="flex-1 flex flex-col border-r-[2px] border-border min-w-0 bg-cream">
                <div className="flex-1 min-h-0">
                  <ChatInterface 
                    ref={chatInterfaceRef}
                    isInitialized={isInitialized} workspace={workspace} username={username} telegramConfigured={secretStatus.telegramConfigured}
                    llmSettings={llmSettings} setLlmSettings={setLlmSettings} availableModels={availableModels}
                    messages={currentMessages} onMessagesChange={handleMessagesChange}
                    onCommandExecuted={handleCommandExecuted} onUpdateReasoningLog={setReasoningLog}
                    skills={skills} rules={rules} activeSkillId={activeSkillId}
                    onActiveSkillChange={setActiveSkillId}
                    recipes={recipes} mcpServers={mcpServers}
                  />
                </div>
                <div className="h-44 border-t-[2px] border-border shrink-0">
                  <TerminalBridge logs={terminalLogs} />
                </div>
              </div>
              <div className="w-[300px] shrink-0">
                <TaskInspector 
                  workspace={workspace} reasoningLog={reasoningLog} isExecuting={isExecuting} onResetWorkspace={handleResetWorkspace}
                  telemetryEnabled={telemetryEnabled} setTelemetryEnabled={setTelemetryEnabled} isInitialized={isInitialized}
                  llmSettings={llmSettings} setLlmSettings={setLlmSettings}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto bg-cream p-10 custom-scrollbar">
              <SettingsPage 
                workspace={workspace} setWorkspace={setWorkspace} username={username} setUsername={setUsername}
                password={password} setPassword={setPassword} userAlreadyExists={userAlreadyExists} setUserAlreadyExists={setUserAlreadyExists}
                llmSettings={llmSettings} setLlmSettings={setLlmSettings} isInitialized={isInitialized} setIsInitialized={setIsInitialized}
                onModelsDetected={setAvailableModels} onReinitSandbox={reinitializeSandbox}
                skills={skills} onSkillsChange={setSkills} rules={rules} onRulesChange={setRules}
                ollamaReady={ollamaReady}
                secretStatus={secretStatus} onSecretStatusChange={refreshSecretStatus}
                recipes={recipes} onRecipesChange={setRecipes} mcpServers={mcpServers} onMcpServersChange={setMcpServers}
                accessibility={accessibility} onAccessibilityChange={setAccessibility}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
export default App;
