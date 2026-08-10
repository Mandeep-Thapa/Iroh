import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Settings, Activity, Upload, AlertTriangle, 
  Eye, EyeOff, Cpu, ShieldCheck, Layers
} from "lucide-react";
import { LLMSettings, LLMProvider } from "../types";

interface ControlPanelProps {
  workspace: string;
  setWorkspace: (ws: string) => void;
  username: string;
  setUsername: (un: string) => void;
  password: string;
  setPassword: (pw: string) => void;
  userAlreadyExists: boolean;
  setUserAlreadyExists: (exists: boolean) => void;
  llmSettings: LLMSettings;
  setLlmSettings: React.Dispatch<React.SetStateAction<LLMSettings>>;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (enabled: boolean) => void;
  onResetWorkspace: () => void;
  isInitialized: boolean;
  setIsInitialized: (init: boolean) => void;
}

export default function ControlPanel({
  workspace, setWorkspace,
  username, setUsername,
  password, setPassword,
  userAlreadyExists, setUserAlreadyExists,
  llmSettings, setLlmSettings,
  telemetryEnabled, setTelemetryEnabled,
  onResetWorkspace,
  isInitialized, setIsInitialized
}: ControlPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<'llm' | 'sandbox' | 'system'>('llm');

  const handleInit = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!userAlreadyExists) {
        await invoke("create_user", { username, password });
      }
      
      await invoke("initialize_workspace", { path: workspace, username });
      setIsInitialized(true);
    } catch (e: any) {
      setError(e.toString());
    }
    setLoading(false);
  };

  const handleFileUpload = async () => {
    const src = prompt("Enter full source file path to copy into sandbox:");
    if (!src) return;
    const filename = src.split(/[\\/]/).pop() || "copied_file.txt";
    try {
      const res = await invoke("copy_file_to_workspace", {
        src,
        destWorkspace: workspace,
        filename
      });
      alert(res);
    } catch (err: any) {
      alert(`File Copy Error: ${err}`);
    }
  };

  return (
    <div className="w-96 bg-slate-900 border-l border-slate-700/80 flex flex-col h-full text-slate-300 select-none shadow-2xl">
      {/* Settings Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 backdrop-blur">
        <div className="flex items-center space-x-2">
          <Settings className="w-5 h-5 text-blue-400 animate-spin-slow" />
          <h2 className="text-base font-bold tracking-wide text-white">System Settings</h2>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          isInitialized ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
        }`}>
          {isInitialized ? "Sandbox Active" : "Uninitialized"}
        </span>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/30 text-xs font-medium">
        <button
          onClick={() => setActiveTab('llm')}
          className={`flex-1 py-3 flex items-center justify-center space-x-1.5 border-b-2 transition-all ${
            activeTab === 'llm' 
              ? "border-blue-500 text-blue-400 bg-blue-500/5 font-semibold" 
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>LLM Engine</span>
        </button>

        <button
          onClick={() => setActiveTab('sandbox')}
          className={`flex-1 py-3 flex items-center justify-center space-x-1.5 border-b-2 transition-all ${
            activeTab === 'sandbox' 
              ? "border-blue-500 text-blue-400 bg-blue-500/5 font-semibold" 
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>OS Sandbox</span>
        </button>

        <button
          onClick={() => setActiveTab('system')}
          className={`flex-1 py-3 flex items-center justify-center space-x-1.5 border-b-2 transition-all ${
            activeTab === 'system' 
              ? "border-blue-500 text-blue-400 bg-blue-500/5 font-semibold" 
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Actions & Logs</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
        {/* Tab 1: LLM Engine */}
        {activeTab === 'llm' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                LLM Provider
              </label>
              <select
                value={llmSettings.provider}
                onChange={(e) => setLlmSettings(prev => ({ ...prev, provider: e.target.value as LLMProvider }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="ollama">Ollama (Local LLM)</option>
                <option value="openai">OpenAI API</option>
                <option value="anthropic">Anthropic API</option>
              </select>
            </div>

            {/* Provider Specific Configuration */}
            {llmSettings.provider === 'ollama' && (
              <div className="space-y-3 bg-slate-950/50 border border-slate-800 p-3.5 rounded-lg">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Ollama Endpoint URL</label>
                  <input
                    type="text"
                    value={llmSettings.ollamaEndpoint}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, ollamaEndpoint: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="http://localhost:11434"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={llmSettings.ollamaModel}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, ollamaModel: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="llama3"
                  />
                </div>
              </div>
            )}

            {llmSettings.provider === 'openai' && (
              <div className="space-y-3 bg-slate-950/50 border border-slate-800 p-3.5 rounded-lg">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">OpenAI API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={llmSettings.openaiKey}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-9 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={llmSettings.openaiModel}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, openaiModel: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="gpt-4o"
                  />
                </div>
              </div>
            )}

            {llmSettings.provider === 'anthropic' && (
              <div className="space-y-3 bg-slate-950/50 border border-slate-800 p-3.5 rounded-lg">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Anthropic API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={llmSettings.anthropicKey}
                      onChange={(e) => setLlmSettings(prev => ({ ...prev, anthropicKey: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 pr-9 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                      placeholder="sk-ant-..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Model Name</label>
                  <input
                    type="text"
                    value={llmSettings.anthropicModel}
                    onChange={(e) => setLlmSettings(prev => ({ ...prev, anthropicModel: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    placeholder="claude-3-5-sonnet-20241022"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: OS Sandbox Settings */}
        {activeTab === 'sandbox' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Isolated Workspace Path
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={workspace}
                  onChange={e => setWorkspace(e.target.value)}
                  disabled={isInitialized}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                AI Worker User Context
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={isInitialized}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                AI Worker Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isInitialized}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2.5 pt-1">
              <input
                type="checkbox"
                id="userExists"
                checked={userAlreadyExists}
                onChange={e => setUserAlreadyExists(e.target.checked)}
                disabled={isInitialized}
                className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
              />
              <label htmlFor="userExists" className="text-xs text-slate-300 cursor-pointer">
                User already created beforehand (skip NetUserAdd)
              </label>
            </div>

            <button
              onClick={handleInit}
              disabled={loading || isInitialized}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-3 font-semibold shadow-lg transition-all disabled:opacity-40 disabled:hover:bg-blue-600 mt-2"
            >
              {loading ? "Configuring ACLs..." : isInitialized ? "Sandbox Configured" : "Initialize / Apply ACLs"}
            </button>
          </div>
        )}

        {/* Tab 3: Actions & System Tools */}
        {activeTab === 'system' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-red-950/30 border border-red-900/60 p-4 rounded-xl space-y-3">
              <div className="flex items-center space-x-2 text-red-400 font-bold text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>Panic Enforcement Gateway</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Immediately terminates any running worker processes and purges all workspace contents to restore a clean environment.
              </p>
              <button
                onClick={onResetWorkspace}
                className="w-full bg-red-600 hover:bg-red-500 text-white rounded-lg py-2.5 font-bold shadow-md transition-all active:scale-95 text-xs tracking-wider"
              >
                PANIC / RESET WORKSPACE
              </button>
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => setTelemetryEnabled(!telemetryEnabled)}
                className={`w-full flex items-center justify-between p-3.5 border rounded-xl transition-all ${
                  telemetryEnabled 
                    ? 'bg-emerald-950/40 border-emerald-600/60 text-emerald-300' 
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Activity className={`w-4 h-4 ${telemetryEnabled ? 'text-emerald-400' : ''}`} />
                  <div className="text-left">
                    <div className="text-xs font-semibold text-white">Academic Telemetry</div>
                    <div className="text-[11px] text-slate-400">Log CPU, RAM, & Latency</div>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  telemetryEnabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"
                }`}>
                  {telemetryEnabled ? "ON" : "OFF"}
                </span>
              </button>

              <button
                onClick={handleFileUpload}
                className="w-full flex items-center space-x-3 p-3.5 bg-slate-950 hover:bg-slate-800/60 border border-slate-800 rounded-xl transition-all text-left"
              >
                <Upload className="w-4 h-4 text-blue-400" />
                <div>
                  <div className="text-xs font-semibold text-white">Elevated File Gateway</div>
                  <div className="text-[11px] text-slate-400">Copy external input files into workspace</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-950 border border-red-800 text-red-300 text-xs rounded-lg animate-shake">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
