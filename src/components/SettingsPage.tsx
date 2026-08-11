import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  Check,
  Cpu,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  AirLlmStatus,
  LLMProvider,
  LLMSettings,
  Rule,
  SecretStatus,
  Skill,
} from "../types";
import type { AccessibilitySettings, McpServerProfile, TaskRecipe } from "../types";
import AccessibilityPanel from "./AccessibilityPanel";
import ActivityLedger from "./ActivityLedger";
import KnowledgePanel from "./KnowledgePanel";
import McpPanel from "./McpPanel";
import ModelAdvisorPanel from "./ModelAdvisorPanel";
import PortableDataPanel from "./PortableDataPanel";
import RecipesPanel from "./RecipesPanel";
import UpdaterPanel from "./UpdaterPanel";

interface SettingsPageProps {
  workspace: string;
  setWorkspace: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  userAlreadyExists: boolean;
  setUserAlreadyExists: (value: boolean) => void;
  llmSettings: LLMSettings;
  setLlmSettings: React.Dispatch<React.SetStateAction<LLMSettings>>;
  isInitialized: boolean;
  setIsInitialized: (value: boolean) => void;
  onModelsDetected: (models: string[]) => void;
  onReinitSandbox: () => Promise<void>;
  skills: Skill[];
  onSkillsChange: (skills: Skill[]) => void;
  rules: Rule[];
  onRulesChange: (rules: Rule[]) => void;
  ollamaReady: boolean;
  secretStatus: SecretStatus;
  onSecretStatusChange: () => Promise<void>;
  recipes: TaskRecipe[];
  onRecipesChange: (recipes: TaskRecipe[]) => void;
  mcpServers: McpServerProfile[];
  onMcpServersChange: (servers: McpServerProfile[]) => void;
  accessibility: AccessibilitySettings;
  onAccessibilityChange: (settings: AccessibilitySettings) => void;
}

const fieldClass =
  "w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue rounded-none placeholder:text-textMuted";
const labelClass =
  "block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2";
const buttonClass =
  "inline-flex items-center justify-center gap-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm active:translate-y-[2px] active:translate-x-[2px] active:shadow-none hover:bg-brutalBlue transition-colors disabled:opacity-40";
const panelClass = "bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6";

function statusLabel(configured: boolean) {
  return configured ? "Configured securely" : "Not configured";
}

export default function SettingsPage({
  workspace,
  setWorkspace,
  username,
  setUsername,
  password,
  setPassword,
  userAlreadyExists,
  setUserAlreadyExists,
  llmSettings,
  setLlmSettings,
  isInitialized,
  onModelsDetected,
  onReinitSandbox,
  skills,
  onSkillsChange,
  rules,
  onRulesChange,
  ollamaReady,
  secretStatus,
  onSecretStatusChange,
  recipes,
  onRecipesChange,
  mcpServers,
  onMcpServersChange,
  accessibility,
  onAccessibilityChange,
}: SettingsPageProps) {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openaiSecret, setOpenaiSecret] = useState("");
  const [anthropicSecret, setAnthropicSecret] = useState("");
  const [telegramSecret, setTelegramSecret] = useState("");
  const [huggingFaceSecret, setHuggingFaceSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [airStatus, setAirStatus] = useState<AirLlmStatus>({
    running: false,
    ready: false,
    detail: "Not checked",
  });
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editSkillName, setEditSkillName] = useState("");
  const [editSkillDesc, setEditSkillDesc] = useState("");
  const [editSkillPrompt, setEditSkillPrompt] = useState("");
  const [editSkillIcon, setEditSkillIcon] = useState("");
  const [newRuleText, setNewRuleText] = useState("");

  const report = (message: string, isError = false) => {
    setNotice(isError ? "" : message);
    setError(isError ? message : "");
  };

  const fetchOllamaModels = useCallback(async () => {
    setBusy(true);
    report("");
    try {
      const raw = await invoke<string>("fetch_ollama_models", {
        endpoint: llmSettings.ollamaEndpoint || "http://127.0.0.1:11434",
      });
      const data = JSON.parse(raw);
      const models = (data.models || [])
        .map((item: { name?: string; model?: string }) => item.name || item.model || "")
        .filter(Boolean);
      setOllamaModels(models);
      if (models.length && !models.includes(llmSettings.ollamaModel)) {
        setLlmSettings((current) => ({ ...current, ollamaModel: models[0] }));
      }
      report(models.length ? "Found " + models.length + " local model(s)." : "Ollama is running, but no models are installed.", !models.length);
    } catch (reason) {
      report("Ollama is unavailable: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  }, [llmSettings.ollamaEndpoint, llmSettings.ollamaModel, setLlmSettings]);

  useEffect(() => {
    if (ollamaReady && llmSettings.provider === "ollama") {
      fetchOllamaModels();
    }
  }, [ollamaReady, llmSettings.provider, fetchOllamaModels]);

  useEffect(() => {
    if (llmSettings.provider === "ollama") onModelsDetected(ollamaModels);
    if (llmSettings.provider === "openai") onModelsDetected(llmSettings.openaiModel ? [llmSettings.openaiModel] : []);
    if (llmSettings.provider === "anthropic") onModelsDetected(llmSettings.anthropicModel ? [llmSettings.anthropicModel] : []);
    if (llmSettings.provider === "airllm") onModelsDetected(llmSettings.airllmModel ? [llmSettings.airllmModel] : []);
  }, [
    llmSettings.provider,
    llmSettings.openaiModel,
    llmSettings.anthropicModel,
    llmSettings.airllmModel,
    ollamaModels,
    onModelsDetected,
  ]);

  const saveSecret = async (name: string, value: string, clear: () => void) => {
    if (!value.trim()) {
      report("Enter a value before saving.", true);
      return;
    }
    setBusy(true);
    try {
      await invoke("set_secret", { name, value });
      clear();
      await onSecretStatusChange();
      report("Secret encrypted with Windows DPAPI.");
    } catch (reason) {
      report("Could not save secret: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  };

  const deleteSecret = async (name: string) => {
    setBusy(true);
    try {
      await invoke("delete_secret", { name });
      await onSecretStatusChange();
      report("Secret removed.");
    } catch (reason) {
      report("Could not remove secret: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  };

  const checkAirLlm = async () => {
    setBusy(true);
    try {
      const environment = await invoke<string>("check_airllm_environment", {
        pythonPath: llmSettings.airllmPythonPath,
      });
      const status = await invoke<AirLlmStatus>("get_airllm_status", {
        endpoint: llmSettings.airllmEndpoint,
      });
      setAirStatus(status);
      report("Environment: " + environment + ". Server: " + status.detail);
    } catch (reason) {
      report("AirLLM check failed: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  };

  const startAirLlm = async () => {
    setBusy(true);
    try {
      const endpoint = new URL(llmSettings.airllmEndpoint);
      const message = await invoke<string>("start_airllm_server", {
        pythonPath: llmSettings.airllmPythonPath,
        model: llmSettings.airllmModel,
        port: Number(endpoint.port || "11435"),
        cacheDir: llmSettings.airllmCacheDir || null,
        compression: llmSettings.airllmCompression,
      });
      report(message);
      setAirStatus(await invoke<AirLlmStatus>("get_airllm_status", {
        endpoint: llmSettings.airllmEndpoint,
      }));
    } catch (reason) {
      report("AirLLM could not start: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  };

  const stopAirLlm = async () => {
    setBusy(true);
    try {
      report(await invoke<string>("stop_airllm_server"));
      setAirStatus({ running: false, ready: false, detail: "Stopped" });
    } catch (reason) {
      report("AirLLM could not stop: " + String(reason), true);
    } finally {
      setBusy(false);
    }
  };

  const startEditSkill = (skill: Skill) => {
    setEditingSkillId(skill.id);
    setEditSkillName(skill.name);
    setEditSkillDesc(skill.description);
    setEditSkillPrompt(skill.systemPrompt);
    setEditSkillIcon(skill.icon);
  };

  const saveEditSkill = () => {
    if (!editingSkillId || !editSkillName.trim()) return;
    onSkillsChange(
      skills.map((skill) =>
        skill.id === editingSkillId
          ? {
              ...skill,
              name: editSkillName.trim(),
              description: editSkillDesc.trim(),
              systemPrompt: editSkillPrompt.trim(),
              icon: editSkillIcon.trim() || "AI",
            }
          : skill,
      ),
    );
    setEditingSkillId(null);
  };

  const addSkill = () => {
    const skill: Skill = {
      id: "skill_" + Date.now(),
      name: "New Skill",
      description: "Describe this skill",
      systemPrompt: "You are a helpful assistant.",
      icon: "AI",
      builtIn: false,
    };
    onSkillsChange([...skills, skill]);
    startEditSkill(skill);
  };

  const addRule = () => {
    if (!newRuleText.trim()) return;
    onRulesChange([
      ...rules,
      { id: "rule_" + Date.now(), text: newRuleText.trim(), enabled: true },
    ]);
    setNewRuleText("");
  };

  const currentModel =
    llmSettings.provider === "ollama"
      ? llmSettings.ollamaModel
      : llmSettings.provider === "openai"
        ? llmSettings.openaiModel
        : llmSettings.provider === "anthropic"
          ? llmSettings.anthropicModel
          : llmSettings.airllmModel;

  const setCurrentModel = (model: string) => {
    if (llmSettings.provider === "ollama") setLlmSettings((value) => ({ ...value, ollamaModel: model }));
    if (llmSettings.provider === "openai") setLlmSettings((value) => ({ ...value, openaiModel: model }));
    if (llmSettings.provider === "anthropic") setLlmSettings((value) => ({ ...value, anthropicModel: model }));
    if (llmSettings.provider === "airllm") setLlmSettings((value) => ({ ...value, airllmModel: model }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-12 font-sans">
      <div>
        <h1 className="text-4xl font-display font-black uppercase tracking-tighter text-primary">Settings</h1>
        <p className="text-sm text-textMuted font-bold mt-1">Local-first providers, encrypted credentials, and explicit tool permissions.</p>
      </div>

      {(notice || error) && (
        <div role="status" className={"border-[2px] border-border px-4 py-3 text-sm font-bold " + (error ? "bg-brutalRed text-cream" : "bg-brutalBlue text-cream")}>
          {error || notice}
        </div>
      )}

      <section className={panelClass}>
        <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
          <div className="w-9 h-9 bg-brutalYellow border-[2px] border-border flex items-center justify-center">
            <Cpu className="w-5 h-5 text-accentText" />
          </div>
          <div>
            <h2 className="text-xl font-display font-black uppercase text-primary">Model Provider</h2>
            <p className="text-xs text-textMuted">Local inference is the default and does not call a paid API.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Provider</label>
            <select
              className={fieldClass}
              value={llmSettings.provider}
              onChange={(event) => setLlmSettings((value) => ({ ...value, provider: event.target.value as LLMProvider }))}
            >
              <option value="ollama">Ollama - recommended local option</option>
              <option value="airllm">AirLLM - experimental layer streaming</option>
              <option value="openai">OpenAI API - may cost money</option>
              <option value="anthropic">Anthropic API - may cost money</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Model identifier</label>
            {llmSettings.provider === "ollama" && ollamaModels.length > 0 ? (
              <select className={fieldClass} value={currentModel} onChange={(event) => setCurrentModel(event.target.value)}>
                {ollamaModels.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            ) : (
              <input className={fieldClass} value={currentModel} onChange={(event) => setCurrentModel(event.target.value)} placeholder="Enter an exact model ID" />
            )}
          </div>
        </div>

        {llmSettings.provider === "ollama" && (
          <div className="flex flex-col md:flex-row gap-3">
            <input className={fieldClass} value={llmSettings.ollamaEndpoint} onChange={(event) => setLlmSettings((value) => ({ ...value, ollamaEndpoint: event.target.value }))} />
            <button className={buttonClass} onClick={fetchOllamaModels} disabled={busy}>
              <RefreshCw className={"w-4 h-4 " + (busy ? "animate-spin" : "")} /> Detect
            </button>
          </div>
        )}

        {(llmSettings.provider === "openai" || llmSettings.provider === "anthropic") && (
          <div className="bg-brutalYellow/30 border-[2px] border-border p-4 space-y-3">
            <label className="flex items-start gap-3 text-sm font-bold text-primary cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={llmSettings.cloudApiEnabled}
                onChange={(event) => setLlmSettings((value) => ({ ...value, cloudApiEnabled: event.target.checked }))}
              />
              <span>Enable cloud API requests. Sending prompts can consume paid credits. This app never enables it automatically.</span>
            </label>
          </div>
        )}
      </section>

      <ModelAdvisorPanel llmSettings={llmSettings} setLlmSettings={setLlmSettings} />

      {llmSettings.provider === "airllm" && (
        <section className={panelClass}>
          <div className="flex items-center justify-between gap-4 border-b-[2px] border-border pb-4">
            <div>
              <h2 className="text-xl font-display font-black uppercase text-primary">AirLLM Lab</h2>
              <p className="text-xs text-textMuted">Experimental. Low VRAM does not mean low total RAM, disk, or latency.</p>
            </div>
            <span className={"px-3 py-1 border-[2px] border-border text-xs font-black uppercase " + (airStatus.ready ? "bg-brutalBlue text-cream" : "bg-surfaceAlt text-primary")}>
              {airStatus.ready ? "Ready" : airStatus.running ? "Starting" : "Stopped"}
            </span>
          </div>
          <div className="bg-brutalYellow/30 border-[2px] border-border p-4 text-xs font-bold text-primary">
            AirLLM streams model layers to reduce GPU-memory pressure. Large models still need substantial disk space, downloads, CPU/RAM headroom, and can be extremely slow on a 4-8 GB laptop. Start with a small quantized Ollama model first.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div><label className={labelClass}>Local endpoint</label><input className={fieldClass} value={llmSettings.airllmEndpoint} onChange={(event) => setLlmSettings((value) => ({ ...value, airllmEndpoint: event.target.value }))} /></div>
            <div><label className={labelClass}>Python executable</label><input className={fieldClass} value={llmSettings.airllmPythonPath} onChange={(event) => setLlmSettings((value) => ({ ...value, airllmPythonPath: event.target.value }))} /></div>
            <div><label className={labelClass}>Cache directory (optional)</label><input className={fieldClass} value={llmSettings.airllmCacheDir} onChange={(event) => setLlmSettings((value) => ({ ...value, airllmCacheDir: event.target.value }))} /></div>
            <div><label className={labelClass}>Compression</label><select className={fieldClass} value={llmSettings.airllmCompression} onChange={(event) => setLlmSettings((value) => ({ ...value, airllmCompression: event.target.value as LLMSettings["airllmCompression"] }))}><option value="4bit">4-bit</option><option value="8bit">8-bit</option><option value="none">None</option></select></div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} onClick={checkAirLlm} disabled={busy}><RefreshCw className="w-4 h-4" /> Check locally</button>
            <button className={buttonClass} onClick={startAirLlm} disabled={busy}><Play className="w-4 h-4" /> Start</button>
            <button className={buttonClass} onClick={stopAirLlm} disabled={busy}><Square className="w-4 h-4" /> Stop</button>
          </div>
          <p className="text-xs text-textMuted font-bold">{airStatus.detail}</p>
        </section>
      )}

      <KnowledgePanel workspace={workspace} ollamaEndpoint={llmSettings.ollamaEndpoint} />

      <section className={panelClass}>
        <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
          <KeyRound className="w-6 h-6 text-primary" />
          <div><h2 className="text-xl font-display font-black uppercase text-primary">Encrypted Secrets</h2><p className="text-xs text-textMuted">Values are never shown again or stored in settings JSON.</p></div>
        </div>
        {[
          { label: "OpenAI API key", name: "openai_api_key", configured: secretStatus.openaiConfigured, value: openaiSecret, set: setOpenaiSecret },
          { label: "Anthropic API key", name: "anthropic_api_key", configured: secretStatus.anthropicConfigured, value: anthropicSecret, set: setAnthropicSecret },
          { label: "Telegram bot token", name: "telegram_token", configured: secretStatus.telegramConfigured, value: telegramSecret, set: setTelegramSecret },
          { label: "Hugging Face token", name: "huggingface_token", configured: secretStatus.huggingfaceConfigured, value: huggingFaceSecret, set: setHuggingFaceSecret },
        ].map((item) => (
          <div key={item.name} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto] gap-3 items-end bg-surfaceAlt border-[2px] border-border p-3">
            <div><div className="text-xs font-black uppercase text-primary">{item.label}</div><div className="text-[10px] text-textMuted">{statusLabel(item.configured)}</div></div>
            <input type="password" autoComplete="off" className={fieldClass} value={item.value} onChange={(event) => item.set(event.target.value)} placeholder={item.configured ? "Enter a replacement" : "Enter secret"} />
            <button className={buttonClass} disabled={busy || !item.value.trim()} onClick={() => saveSecret(item.name, item.value, () => item.set(""))}><Check className="w-4 h-4" /> Save</button>
            <button aria-label={"Remove " + item.label} className="p-2.5 border-[2px] border-border bg-surface hover:bg-brutalRed hover:text-cream disabled:opacity-30" disabled={busy || !item.configured} onClick={() => deleteSecret(item.name)}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </section>

      <section className={panelClass}>
        <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <div><h2 className="text-xl font-display font-black uppercase text-primary">Restricted Workspace</h2><p className="text-xs text-textMuted">Defense in depth through a non-admin Windows worker; this is not a VM security boundary.</p></div>
        </div>
        <div><label className={labelClass}>Workspace directory</label><input className={fieldClass} value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="M:\AI_Workspace" /></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div><label className={labelClass}>Worker account</label><input className={fieldClass} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="AI_Worker" /></div>
          <div><label className={labelClass}>Worker password</label><input type="password" autoComplete="new-password" className={fieldClass} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={secretStatus.workerPasswordConfigured ? "Configured - enter to replace" : "Required"} /></div>
        </div>
        <label className="flex gap-3 items-center text-sm font-bold text-primary"><input type="checkbox" checked={userAlreadyExists} onChange={(event) => setUserAlreadyExists(event.target.checked)} /> Worker account already exists</label>
        <button className={buttonClass} onClick={onReinitSandbox} disabled={busy || !workspace.trim() || !username.trim() || (!password.trim() && !secretStatus.workerPasswordConfigured)}>
          <RotateCcw className="w-4 h-4" /> {isInitialized ? "Re-initialize" : "Initialize"} workspace
        </button>
      </section>

      <section className={panelClass}>
        <div className="flex items-center justify-between gap-3 border-b-[2px] border-border pb-4">
          <div className="flex items-center gap-3"><Sparkles className="w-6 h-6" /><h2 className="text-xl font-display font-black uppercase text-primary">Skills</h2></div>
          <button className={buttonClass} onClick={addSkill}><Plus className="w-4 h-4" /> Add</button>
        </div>
        <div className="space-y-3">
          {skills.map((skill) => (
            <div key={skill.id} className="bg-surfaceAlt border-[2px] border-border p-4">
              {editingSkillId === skill.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-[70px_1fr] gap-3"><input className={fieldClass} value={editSkillIcon} onChange={(event) => setEditSkillIcon(event.target.value)} /><input className={fieldClass} value={editSkillName} onChange={(event) => setEditSkillName(event.target.value)} /></div>
                  <input className={fieldClass} value={editSkillDesc} onChange={(event) => setEditSkillDesc(event.target.value)} />
                  <textarea rows={5} className={fieldClass} value={editSkillPrompt} onChange={(event) => setEditSkillPrompt(event.target.value)} />
                  <div className="flex gap-2"><button className={buttonClass} onClick={saveEditSkill}><Check className="w-4 h-4" /> Save</button><button className={buttonClass} onClick={() => setEditingSkillId(null)}><X className="w-4 h-4" /> Cancel</button></div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex gap-3 items-center"><span className="font-black text-xs border border-border px-2 py-1 bg-surface">{skill.icon}</span><div><div className="text-sm font-black uppercase text-primary">{skill.name}</div><div className="text-xs text-textMuted">{skill.description}</div></div></div>
                  <div className="flex gap-2"><button aria-label={"Edit " + skill.name} className="p-2 border border-border bg-surface" onClick={() => startEditSkill(skill)}><Pencil className="w-4 h-4" /></button>{!skill.builtIn && <button aria-label={"Delete " + skill.name} className="p-2 border border-border bg-surface hover:bg-brutalRed hover:text-cream" onClick={() => onSkillsChange(skills.filter((item) => item.id !== skill.id))}><Trash2 className="w-4 h-4" /></button>}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex items-center gap-3 border-b-[2px] border-border pb-4"><BookOpen className="w-6 h-6" /><h2 className="text-xl font-display font-black uppercase text-primary">Global Rules</h2></div>
        <div className="flex gap-3"><input className={fieldClass} value={newRuleText} onChange={(event) => setNewRuleText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addRule(); }} placeholder="A rule injected into every conversation" /><button className={buttonClass} onClick={addRule} disabled={!newRuleText.trim()}><Plus className="w-4 h-4" /> Add</button></div>
        <div className="space-y-2">
          {rules.length === 0 && <p className="text-xs text-textMuted font-bold">No global rules.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="flex gap-3 items-center bg-surfaceAlt border border-border p-3">
              <input type="checkbox" checked={rule.enabled} onChange={() => onRulesChange(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} />
              <span className={"flex-1 text-xs font-bold " + (rule.enabled ? "text-primary" : "text-textMuted line-through")}>{rule.text}</span>
              <button aria-label="Delete rule" onClick={() => onRulesChange(rules.filter((item) => item.id !== rule.id))}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </section>

      <RecipesPanel recipes={recipes} onChange={onRecipesChange} />
      <McpPanel servers={mcpServers} onChange={onMcpServersChange} />
      <PortableDataPanel workspace={workspace} />
      <UpdaterPanel />
      <AccessibilityPanel value={accessibility} onChange={onAccessibilityChange} />
      <ActivityLedger />

    </div>
  );
}
