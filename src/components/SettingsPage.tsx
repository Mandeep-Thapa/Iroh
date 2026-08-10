import { useState, useEffect, useCallback } from "react";
import { Settings, RefreshCw, Cpu, ShieldCheck, Eye, EyeOff, RotateCcw, Sparkles, BookOpen, Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { LLMSettings, LLMProvider, Skill, Rule } from "../types";
import { invoke } from "@tauri-apps/api/core";

interface SettingsPageProps {
  workspace: string; setWorkspace: (ws: string) => void;
  username: string; setUsername: (un: string) => void;
  password: string; setPassword: (pw: string) => void;
  userAlreadyExists: boolean; setUserAlreadyExists: (exists: boolean) => void;
  llmSettings: LLMSettings; setLlmSettings: React.Dispatch<React.SetStateAction<LLMSettings>>;
  isInitialized: boolean; setIsInitialized: (init: boolean) => void;
  onModelsDetected: (models: string[]) => void; onReinitSandbox: () => void;
  skills: Skill[]; onSkillsChange: (skills: Skill[]) => void;
  rules: Rule[]; onRulesChange: (rules: Rule[]) => void;
  ollamaReady: boolean;
}

export default function SettingsPage({
  workspace, setWorkspace, username, setUsername, password, setPassword,
  userAlreadyExists, setUserAlreadyExists, llmSettings, setLlmSettings,
  isInitialized, onModelsDetected, onReinitSandbox,
  skills, onSkillsChange, rules, onRulesChange, ollamaReady
}: SettingsPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const anthropicModels = [
    "claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"
  ];

  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState<string | null>(null);

  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editSkillName, setEditSkillName] = useState("");
  const [editSkillDesc, setEditSkillDesc] = useState("");
  const [editSkillPrompt, setEditSkillPrompt] = useState("");
  const [editSkillIcon, setEditSkillIcon] = useState("");
  const [newRuleText, setNewRuleText] = useState("");

  const fetchOllamaModels = useCallback(async () => {
    setLoading(true); setFetchError(null); setFetchSuccess(null);
    try {
      const endpoint = llmSettings.ollamaEndpoint || "http://localhost:11434";
      const res = await invoke<string>("fetch_ollama_models", { endpoint });
      const data = JSON.parse(res);
      const modelNames: string[] = (data.models || []).map((m: any) => m.name || m.model || '').filter(Boolean);
      setOllamaModels(modelNames);
      if (modelNames.length > 0) {
        if (!llmSettings.ollamaModel || !modelNames.includes(llmSettings.ollamaModel)) setLlmSettings(prev => ({ ...prev, ollamaModel: modelNames[0] }));
        setFetchSuccess(`Found ${modelNames.length} Ollama model(s)`);
      } else {
        setFetchError("Ollama running but no models found. Run: ollama pull <model>");
      }
      if (llmSettings.provider === 'ollama') onModelsDetected(modelNames);
    } catch (err: any) { setFetchError(`Ollama: ${err}. Is Ollama running?`); }
    setLoading(false);
  }, [llmSettings.ollamaEndpoint, llmSettings.ollamaModel, llmSettings.provider]);

  const fetchOpenAIModels = useCallback(async () => {
    if (!llmSettings.openaiKey) { setFetchError("API key required."); return; }
    setLoading(true); setFetchError(null); setFetchSuccess(null);
    try {
      const res = await fetch("https://api.openai.com/v1/models", { headers: { "Authorization": `Bearer ${llmSettings.openaiKey}` } });
      if (!res.ok) throw new Error(`OpenAI returned ${res.status}`);
      const data = await res.json();
      const models: string[] = (data.data || []).map((m: any) => m.id).filter((id: string) => id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")).sort();
      setOpenaiModels(models);
      if (models.length > 0) {
        if (!llmSettings.openaiModel || !models.includes(llmSettings.openaiModel)) setLlmSettings(prev => ({ ...prev, openaiModel: models[0] }));
        setFetchSuccess(`Found ${models.length} OpenAI model(s)`);
      }
      if (llmSettings.provider === 'openai') onModelsDetected(models);
    } catch (err: any) { setFetchError(`OpenAI: ${err.message}`); }
    setLoading(false);
  }, [llmSettings.openaiKey, llmSettings.openaiModel, llmSettings.provider]);

  const handleRefreshModels = async () => {
    if (llmSettings.provider === 'ollama') await fetchOllamaModels();
    else if (llmSettings.provider === 'openai') await fetchOpenAIModels();
    else { onModelsDetected(anthropicModels); setFetchSuccess(`${anthropicModels.length} Anthropic models available`); }
  };

  // Auto-fetch when Ollama becomes ready
  useEffect(() => {
    if (ollamaReady && llmSettings.provider === 'ollama') fetchOllamaModels();
  }, [ollamaReady]);

  useEffect(() => { handleRefreshModels(); }, [llmSettings.provider]);
  useEffect(() => { if (llmSettings.provider === 'ollama') fetchOllamaModels(); }, [llmSettings.ollamaEndpoint]);
  useEffect(() => { if (llmSettings.provider === 'openai' && llmSettings.openaiKey) fetchOpenAIModels(); }, [llmSettings.openaiKey]);
  useEffect(() => {
    if (llmSettings.provider === 'ollama') onModelsDetected(ollamaModels);
    else if (llmSettings.provider === 'openai') onModelsDetected(openaiModels);
    else onModelsDetected(anthropicModels);
  }, [llmSettings.provider, ollamaModels, openaiModels]);

  const currentModels = llmSettings.provider === 'ollama' ? ollamaModels : llmSettings.provider === 'openai' ? openaiModels : anthropicModels;
  const currentModel = llmSettings.provider === 'ollama' ? llmSettings.ollamaModel : llmSettings.provider === 'openai' ? llmSettings.openaiModel : llmSettings.anthropicModel;
  const setCurrentModel = (model: string) => {
    if (llmSettings.provider === 'ollama') setLlmSettings(prev => ({ ...prev, ollamaModel: model }));
    else if (llmSettings.provider === 'openai') setLlmSettings(prev => ({ ...prev, openaiModel: model }));
    else setLlmSettings(prev => ({ ...prev, anthropicModel: model }));
  };

  const startEditSkill = (skill: Skill) => {
    setEditingSkillId(skill.id); setEditSkillName(skill.name); setEditSkillDesc(skill.description);
    setEditSkillPrompt(skill.systemPrompt); setEditSkillIcon(skill.icon);
  };
  const saveEditSkill = () => {
    if (!editingSkillId || !editSkillName.trim()) return;
    onSkillsChange(skills.map(s => s.id === editingSkillId ? { ...s, name: editSkillName.trim(), description: editSkillDesc.trim(), systemPrompt: editSkillPrompt.trim(), icon: editSkillIcon || '🔧' } : s));
    setEditingSkillId(null);
  };
  const addCustomSkill = () => {
    const newSkill: Skill = { id: `skill_${Date.now()}`, name: "New Skill", description: "Describe what this skill does", systemPrompt: "You are a helpful assistant.", icon: "🔧", builtIn: false };
    onSkillsChange([...skills, newSkill]);
    startEditSkill(newSkill);
  };
  const deleteSkill = (id: string) => onSkillsChange(skills.filter(s => s.id !== id));
  const addRule = () => { if (!newRuleText.trim()) return; onRulesChange([...rules, { id: `rule_${Date.now()}`, text: newRuleText.trim(), enabled: true }]); setNewRuleText(""); };
  const toggleRule = (id: string) => onRulesChange(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  const deleteRule = (id: string) => onRulesChange(rules.filter(r => r.id !== id));

  return (
    <div className="max-w-3xl mx-auto space-y-10 pb-12 font-sans">
      
      <div className="mb-8">
        <div className="flex items-center space-x-4 mb-3">
          <div className="w-12 h-12 bg-brutalYellow border-[2px] border-border flex items-center justify-center shadow-brutal">
            <Settings className="w-7 h-7 text-accentText stroke-[2.5]" />
          </div>
          <h1 className="text-4xl font-display font-black uppercase tracking-tighter text-primary">Settings</h1>
        </div>
        <div className="h-[2px] bg-border mt-5 w-full"></div>
      </div>

      {/* LLM Config */}
      <div className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b-[2px] border-border pb-4 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-primary flex items-center justify-center">
              <Cpu className="w-5 h-5 text-cream stroke-[2.5]" />
            </div>
            <h2 className="text-xl font-display font-black uppercase tracking-tighter text-primary">Provider</h2>
          </div>
          <button onClick={handleRefreshModels} disabled={loading}
            className="flex items-center space-x-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:bg-brutalBlue transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 stroke-[3] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {fetchError && <div className="bg-brutalRed text-cream border-[2px] border-border px-4 py-2.5 text-xs font-bold">⚠ {fetchError}</div>}
        {fetchSuccess && !fetchError && <div className="bg-brutalBlue text-cream border-[2px] border-border px-4 py-2.5 text-xs font-bold">✓ {fetchSuccess}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">Provider</label>
            <select value={llmSettings.provider} onChange={(e) => setLlmSettings(prev => ({ ...prev, provider: e.target.value as LLMProvider }))}
              className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue cursor-pointer appearance-none rounded-none transition-colors">
              <option value="ollama">Ollama (Local LLMs)</option>
              <option value="openai">OpenAI API</option>
              <option value="anthropic">Anthropic API</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2 flex justify-between">
              <span>Model</span>
              <span className="bg-brutalYellow border border-border px-1.5 py-0.5 text-[9px] text-accentText">{currentModels.length} FOUND</span>
            </label>
            <select value={currentModel} onChange={(e) => setCurrentModel(e.target.value)}
              className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue cursor-pointer appearance-none rounded-none transition-colors">
              {currentModels.length === 0 ? <option value="">No models</option> : currentModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="pt-4">
          {llmSettings.provider === 'ollama' && (
            <div>
              <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">Endpoint</label>
              <input type="text" value={llmSettings.ollamaEndpoint} onChange={(e) => setLlmSettings(prev => ({ ...prev, ollamaEndpoint: e.target.value }))}
                className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none placeholder:text-textMuted" placeholder="http://localhost:11434" />
            </div>
          )}
          {llmSettings.provider === 'openai' && (
            <div>
              <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">API Key</label>
              <div className="relative">
                <input type={showApiKey ? "text" : "password"} value={llmSettings.openaiKey} onChange={(e) => setLlmSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                  className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 pr-10 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none font-mono placeholder:text-textMuted" placeholder="sk-proj-..." />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-2.5 text-textMuted hover:text-brutalRed transition-colors">
                  {showApiKey ? <EyeOff className="w-4 h-4 stroke-[2.5]" /> : <Eye className="w-4 h-4 stroke-[2.5]" />}
                </button>
              </div>
            </div>
          )}
          {llmSettings.provider === 'anthropic' && (
            <div>
              <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">API Key</label>
              <div className="relative">
                <input type={showApiKey ? "text" : "password"} value={llmSettings.anthropicKey} onChange={(e) => setLlmSettings(prev => ({ ...prev, anthropicKey: e.target.value }))}
                  className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 pr-10 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none font-mono placeholder:text-textMuted" placeholder="sk-ant-..." />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-2.5 text-textMuted hover:text-brutalRed transition-colors">
                  {showApiKey ? <EyeOff className="w-4 h-4 stroke-[2.5]" /> : <Eye className="w-4 h-4 stroke-[2.5]" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skills */}
      <div className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b-[2px] border-border pb-4 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-brutalYellow flex items-center justify-center border-[2px] border-border">
              <Sparkles className="w-5 h-5 text-accentText stroke-[2.5]" />
            </div>
            <h2 className="text-xl font-display font-black uppercase tracking-tighter text-primary">Skills</h2>
          </div>
          <button onClick={addCustomSkill}
            className="flex items-center space-x-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:bg-brutalBlue transition-colors">
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Skill</span>
          </button>
        </div>

        <div className="space-y-3">
          {skills.map(skill => (
            <div key={skill.id} className="bg-surfaceAlt border-[2px] border-border p-4">
              {editingSkillId === skill.id ? (
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input type="text" value={editSkillIcon} onChange={e => setEditSkillIcon(e.target.value)} placeholder="🔧"
                      className="w-10 bg-surface border-[2px] border-border px-1.5 py-1.5 text-center text-base rounded-none focus:outline-none focus:border-brutalBlue" />
                    <input type="text" value={editSkillName} onChange={e => setEditSkillName(e.target.value)} placeholder="Skill Name"
                      className="flex-1 bg-surface border-[2px] border-border px-3 py-1.5 text-sm font-bold text-primary rounded-none focus:outline-none focus:border-brutalBlue" />
                  </div>
                  <input type="text" value={editSkillDesc} onChange={e => setEditSkillDesc(e.target.value)} placeholder="Short description"
                    className="w-full bg-surface border-[2px] border-border px-3 py-1.5 text-sm text-primary rounded-none focus:outline-none focus:border-brutalBlue" />
                  <textarea value={editSkillPrompt} onChange={e => setEditSkillPrompt(e.target.value)} placeholder="System prompt..."
                    rows={4} className="w-full bg-surface border-[2px] border-border px-3 py-2 text-sm text-primary font-mono rounded-none focus:outline-none focus:border-brutalBlue resize-none custom-scrollbar" />
                  <div className="flex space-x-2">
                    <button onClick={saveEditSkill} className="flex items-center space-x-1 bg-brutalBlue text-cream px-3 py-1.5 border-[2px] border-border font-display font-black uppercase text-[10px]">
                      <Check className="w-3.5 h-3.5 stroke-[3]" /><span>Save</span>
                    </button>
                    <button onClick={() => setEditingSkillId(null)} className="flex items-center space-x-1 bg-surfaceAlt text-primary px-3 py-1.5 border-[2px] border-border font-display font-black uppercase text-[10px]">
                      <X className="w-3.5 h-3.5 stroke-[3]" /><span>Cancel</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-lg">{skill.icon}</span>
                    <div>
                      <div className="text-sm font-display font-black uppercase text-primary">{skill.name}</div>
                      <div className="text-[10px] text-textMuted">{skill.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {skill.builtIn && <span className="text-[8px] font-display font-black uppercase text-textMuted bg-surface border border-border px-1.5 py-0.5">Built-in</span>}
                    <button onClick={() => startEditSkill(skill)} className="w-7 h-7 bg-surface text-textMuted border border-border flex items-center justify-center hover:bg-brutalYellow hover:text-accentText transition-colors">
                      <Pencil className="w-3 h-3 stroke-[2.5]" />
                    </button>
                    {!skill.builtIn && (
                      <button onClick={() => deleteSkill(skill.id)} className="w-7 h-7 bg-surface text-textMuted border border-border flex items-center justify-center hover:bg-brutalRed hover:text-cream transition-colors">
                        <Trash2 className="w-3 h-3 stroke-[2.5]" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

        {/* Telegram Integration */}
        <div className="space-y-4">
          <div className="border-b-[2px] border-border pb-2">
            <h2 className="text-sm font-display font-black uppercase tracking-widest text-primary flex items-center space-x-2">
              <span className="w-2 h-2 bg-brutalBlue inline-block"></span>
              <span>Telegram Bot Integration</span>
            </h2>
            <p className="text-xs text-textMuted mt-1">Chat with Antigravity from your phone.</p>
          </div>
          
          <div className="space-y-1">
            <label className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Bot Token</label>
            <input 
              type="password" 
              value={llmSettings.telegramToken || ''} 
              onChange={e => setLlmSettings({...llmSettings, telegramToken: e.target.value})}
              className="w-full bg-surfaceAlt text-primary px-3 py-2 border-[2px] border-border focus:outline-none focus:border-brutalYellow font-mono text-xs placeholder:text-textMuted/50 transition-colors"
              placeholder="e.g. 123456789:ABCdefGHIjklMNO..."
            />
            <p className="text-[10px] text-textMuted mt-1">Get this from @BotFather on Telegram.</p>
          </div>
        </div>

        {/* Global Agent Rules */}
      <div className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6">
        <div className="flex items-center space-x-3 border-b-[2px] border-border pb-4">
          <div className="w-9 h-9 bg-primary flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-cream stroke-[2.5]" />
          </div>
          <h2 className="text-xl font-display font-black uppercase tracking-tighter text-primary">Rules</h2>
        </div>

        <div className="flex space-x-2">
          <input type="text" value={newRuleText} onChange={e => setNewRuleText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRule()}
            placeholder="e.g., Always use TypeScript strict mode"
            className="flex-1 bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none placeholder:text-textMuted" />
          <button onClick={addRule} disabled={!newRuleText.trim()}
            className="px-4 py-2.5 bg-primary text-cream border-[2px] border-border font-display font-black uppercase text-[10px] hover:bg-brutalBlue transition-colors disabled:opacity-30">
            Add
          </button>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Suggested Presets:</span>
          <div className="flex flex-wrap gap-2">
            {[
              "Explain concepts simply, like I'm 5 years old",
              "Be extremely concise, do not yap",
              "Always format code in TypeScript",
              "Actively ask for permission before modifying files"
            ].map(preset => (
              <button key={preset} 
                onClick={() => onRulesChange([...rules, { id: `rule_${Date.now()}_${Math.random()}`, text: preset, enabled: true }])}
                className="bg-surfaceAlt text-primary text-[10px] font-bold px-2 py-1 border border-border hover:bg-brutalYellow hover:text-accentText transition-colors text-left">
                + {preset}
              </button>
            ))}
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="text-xs font-bold text-textMuted italic p-3 border-[2px] border-border border-dashed bg-surfaceAlt">
            No rules defined. Rules inject into every conversation.
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center space-x-3 bg-surfaceAlt border border-border p-2.5">
                <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)}
                  className="w-4 h-4 border-[2px] border-border appearance-none checked:bg-brutalYellow cursor-pointer rounded-none shrink-0 relative after:content-[''] after:absolute after:hidden checked:after:block after:left-[3px] after:top-[0px] after:w-1.5 after:h-2.5 after:border-solid after:border-accentText after:border-r-[2px] after:border-b-[2px] after:rotate-45" />
                <span className={`flex-1 text-xs font-bold ${rule.enabled ? 'text-primary' : 'text-textMuted line-through'}`}>{rule.text}</span>
                <button onClick={() => deleteRule(rule.id)} className="w-6 h-6 text-textMuted flex items-center justify-center hover:text-brutalRed transition-colors shrink-0">
                  <Trash2 className="w-3 h-3 stroke-[2]" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sandbox Config */}
      <div className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b-[2px] border-border pb-4 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-cream stroke-[2.5]" />
            </div>
            <h2 className="text-xl font-display font-black uppercase tracking-tighter text-primary">Sandbox</h2>
          </div>
          {isInitialized && (
            <span className="text-[10px] font-display font-black uppercase tracking-widest text-accentText bg-brutalYellow border-[2px] border-border px-3 py-1.5 flex items-center space-x-2">
              <div className="w-2 h-2 bg-brutalRed animate-pulse"></div>
              <span>Active</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="col-span-1 md:col-span-2">
            <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">
              Workspaces <span className="lowercase font-sans text-[9px]">(comma separated)</span>
            </label>
            <input type="text" value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="M:\AI_Workspace"
              className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none placeholder:text-textMuted" />
          </div>
          <div>
            <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">Worker Account</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="AI_Worker"
              className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none placeholder:text-textMuted" />
          </div>
          <div>
            <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">Password</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                className="w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 pr-10 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue transition-colors rounded-none placeholder:text-textMuted" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-2.5 text-textMuted hover:text-brutalRed transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4 stroke-[2.5]" /> : <Eye className="w-4 h-4 stroke-[2.5]" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3 pt-3">
          <input type="checkbox" id="userExistsSettings" checked={userAlreadyExists} onChange={e => setUserAlreadyExists(e.target.checked)}
            className="w-4 h-4 border-[2px] border-border appearance-none checked:bg-brutalYellow cursor-pointer rounded-none relative after:content-[''] after:absolute after:hidden checked:after:block after:left-[3px] after:top-[0px] after:w-1.5 after:h-2.5 after:border-solid after:border-accentText after:border-r-[2px] after:border-b-[2px] after:rotate-45" />
          <label htmlFor="userExistsSettings" className="text-xs font-bold text-primary cursor-pointer">Account already exists on Windows</label>
        </div>

        {isInitialized && (
          <button onClick={onReinitSandbox}
            className="flex items-center space-x-2 bg-brutalYellow text-accentText border-[2px] border-border px-5 py-2.5 font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:bg-primary hover:text-cream transition-colors">
            <RotateCcw className="w-4 h-4 stroke-[3]" />
            <span>Re-Initialize Sandbox</span>
          </button>
        )}
      </div>
    </div>
  );
}
