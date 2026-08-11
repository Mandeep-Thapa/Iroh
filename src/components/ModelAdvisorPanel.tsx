import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Cpu, Gauge, HardDrive, RefreshCw, Timer } from "lucide-react";
import type { BenchmarkResult, LLMSettings, SystemStats } from "../types";
import { CONTEXT_OPTIONS, OLLAMA_STARTER_MODELS, findAdvertisedContext, formatModelSize, formatTokens, recommendContext } from "../modelGuidance";

interface OllamaModelSummary {
  name?: string;
  model?: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string; family?: string };
}

interface OllamaModelDetails {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

interface ModelAdvisorPanelProps {
  llmSettings: LLMSettings;
  setLlmSettings: React.Dispatch<React.SetStateAction<LLMSettings>>;
}

const smallButton = "border-[2px] border-border px-3 py-2 text-[10px] font-black uppercase tracking-wider bg-surfaceAlt hover:bg-brutalYellow hover:text-accentText disabled:opacity-30";

function activeModel(settings: LLMSettings): string {
  if (settings.provider === "ollama") return settings.ollamaModel;
  if (settings.provider === "openai") return settings.openaiModel;
  if (settings.provider === "anthropic") return settings.anthropicModel;
  return settings.airllmModel;
}

export default function ModelAdvisorPanel({ llmSettings, setLlmSettings }: ModelAdvisorPanelProps) {
  const [models, setModels] = useState<OllamaModelSummary[]>([]);
  const [details, setDetails] = useState<OllamaModelDetails | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const modelName = activeModel(llmSettings);
  const selected = models.find((model) => (model.name || model.model) === modelName);
  const starter = OLLAMA_STARTER_MODELS.find((model) => model.id === modelName);
  const advertisedMax = findAdvertisedContext(details?.model_info) || starter?.advertisedContext || null;
  const recommendation = useMemo(() => recommendContext({
    provider: llmSettings.provider,
    systemStats: stats,
    modelSizeBytes: selected?.size,
    advertisedMax,
  }), [llmSettings.provider, stats, selected?.size, advertisedMax]);

  const detect = async () => {
    if (llmSettings.provider !== "ollama") return;
    setBusy(true);
    setMessage("");
    try {
      const raw = await invoke<string>("fetch_ollama_models", { endpoint: llmSettings.ollamaEndpoint });
      const parsed = JSON.parse(raw) as { models?: OllamaModelSummary[] };
      const found = parsed.models || [];
      setModels(found);
      setMessage(found.length ? `${found.length} installed Ollama model(s) inspected locally.` : "Ollama is running, but no models are installed.");
    } catch (reason) {
      setModels([]);
      setMessage(`Model detection failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    invoke<SystemStats>("get_system_stats").then(setStats).catch(() => setStats(null));
  }, []);

  useEffect(() => {
    if (llmSettings.provider === "ollama") detect();
    else setModels([]);
    // Provider and endpoint changes are the only automatic re-detection triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmSettings.provider, llmSettings.ollamaEndpoint]);

  useEffect(() => {
    if (llmSettings.provider !== "ollama" || !modelName) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    invoke<string>("fetch_ollama_model_details", { endpoint: llmSettings.ollamaEndpoint, model: modelName })
      .then((raw) => { if (!cancelled) setDetails(JSON.parse(raw)); })
      .catch(() => { if (!cancelled) setDetails(null); });
    return () => { cancelled = true; };
  }, [llmSettings.provider, llmSettings.ollamaEndpoint, modelName]);

  const chooseModel = (id: string) => {
    setLlmSettings((current) => ({ ...current, ollamaModel: id }));
  };

  const useRecommendedContext = () => {
    setLlmSettings((current) => ({ ...current, contextLength: recommendation.tokens }));
  };

  const benchmark = async () => {
    if (!modelName || !["ollama", "airllm"].includes(llmSettings.provider)) return;
    setBusy(true);
    setMessage("Running one short local benchmark prompt...");
    const started = performance.now();
    try {
      const endpoint = llmSettings.provider === "ollama" ? llmSettings.ollamaEndpoint : llmSettings.airllmEndpoint;
      const output = await invoke<string>("chat_completion", {
        request: {
          provider: llmSettings.provider,
          model: modelName,
          systemPrompt: "This is a local performance check. Answer directly and do not call tools.",
          messages: [{ role: "user", content: "In one sentence, explain why careful planning improves software changes." }],
          endpoint,
          contextLength: llmSettings.contextLength || recommendation.tokens,
          cloudApiEnabled: false,
          structuredOutput: false,
        },
      });
      const result: BenchmarkResult = {
        id: `benchmark_${Date.now()}`,
        provider: llmSettings.provider,
        model: modelName,
        contextLength: llmSettings.contextLength || recommendation.tokens,
        durationMs: Math.round(performance.now() - started),
        outputChars: output.length,
        createdAt: Date.now(),
      };
      setLlmSettings((current) => ({ ...current, benchmarkHistory: [result, ...(current.benchmarkHistory || [])].slice(0, 10) }));
      setMessage(`Local benchmark completed in ${(result.durationMs / 1000).toFixed(1)} seconds.`);
    } catch (reason) {
      setMessage(`Benchmark failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[2px] border-border pb-4">
        <div className="flex items-center gap-3"><Gauge className="w-6 h-6" /><div><h2 className="text-xl font-display font-black uppercase text-primary">Model Advisor</h2><p className="text-xs text-textMuted">Advertised limits describe compatibility; Iroh's recommendation targets practical laptop headroom.</p></div></div>
        {llmSettings.provider === "ollama" && <button className={smallButton} onClick={detect} disabled={busy}><RefreshCw className={`inline w-3.5 h-3.5 mr-2 ${busy ? "animate-spin" : ""}`} /> Detect</button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surfaceAlt border-[2px] border-border p-4"><Cpu className="w-4 h-4 mb-2" /><div className="text-[10px] uppercase font-black text-textMuted">Hardware</div><div className="text-sm font-black mt-1">{stats ? `${(stats.ram_total_mb / 1024).toFixed(0)} GB RAM` : "Detecting..."}</div></div>
        <div className="bg-surfaceAlt border-[2px] border-border p-4"><HardDrive className="w-4 h-4 mb-2" /><div className="text-[10px] uppercase font-black text-textMuted">Selected model</div><div className="text-sm font-black mt-1 break-all">{modelName || "None"}</div><div className="text-[10px] text-textMuted mt-1">{selected ? `${formatModelSize(selected.size)} · ${selected.details?.quantization_level || "quantization unknown"}` : "Exact size available after local detection"}</div></div>
        <div className="bg-brutalYellow text-accentText border-[2px] border-border p-4"><CheckCircle2 className="w-4 h-4 mb-2" /><div className="text-[10px] uppercase font-black">Recommended context</div><div className="text-2xl font-black mt-1">{formatTokens(recommendation.tokens)}</div><button className="mt-2 text-[10px] underline font-black" onClick={useRecommendedContext}>Use recommendation</button></div>
      </div>

      <p className="text-xs font-bold text-textMuted">{recommendation.explanation}{advertisedMax ? ` Advertised model maximum: ${formatTokens(advertisedMax)}.` : " The model's advertised maximum is not available yet."}</p>
      <div>
        <div className="flex items-center justify-between mb-2"><h3 className="text-[10px] font-black uppercase tracking-widest text-textMuted">Context presets</h3><span className="text-xs font-black">Current: {formatTokens(llmSettings.contextLength || 32768)}</span></div>
        <div className="flex flex-wrap gap-2">{CONTEXT_OPTIONS.map((option) => <button key={option} className={`${smallButton} ${(llmSettings.contextLength || 32768) === option ? "bg-brutalBlue text-cream" : ""}`} disabled={Boolean(advertisedMax && option > advertisedMax)} onClick={() => setLlmSettings((current) => ({ ...current, contextLength: option }))}>{formatTokens(option)}</button>)}</div>
      </div>

      {llmSettings.provider === "ollama" && (
        <div className="space-y-3 border-t-[2px] border-border pt-5">
          <h3 className="text-sm font-display font-black uppercase">Supported starter catalog</h3>
          <p className="text-xs text-textMuted">These are compatible examples, not automatic downloads. Installed models are marked and can be selected immediately.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{OLLAMA_STARTER_MODELS.map((model) => {
            const installed = models.some((item) => (item.name || item.model) === model.id);
            return <article key={model.id} className="bg-surfaceAlt border-[2px] border-border p-3"><div className="flex justify-between gap-2"><div><h4 className="text-xs font-black">{model.name}</h4><code className="text-[10px] text-textMuted">{model.id}</code></div><span className={`h-fit border border-border px-2 py-0.5 text-[9px] uppercase font-black ${installed ? "bg-brutalBlue text-cream" : "bg-surface"}`}>{installed ? "Installed" : model.hardware}</span></div><p className="text-[10px] text-textMuted mt-2">{model.downloadSize} · up to {formatTokens(model.advertisedContext)} advertised · {model.note}</p>{installed && <button className="mt-2 text-[10px] font-black underline" onClick={() => chooseModel(model.id)}>Use model</button>}</article>;
          })}</div>
        </div>
      )}

      {(llmSettings.provider === "openai" || llmSettings.provider === "anthropic") && <div className="bg-brutalYellow/30 border-[2px] border-border p-4 text-xs font-bold">Iroh accepts exact model IDs available to your account, but deliberately does not probe a cloud API to populate this list. Detection could create network traffic and is never required.</div>}
      {llmSettings.provider === "airllm" && <div className="bg-brutalYellow/30 border-[2px] border-border p-4 text-xs font-bold">AirLLM accepts Hugging Face identifiers supported by the installed AirLLM version. Compatibility is verified locally only when you press Check or Start.</div>}

      <div className="border-t-[2px] border-border pt-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-display font-black uppercase">Local benchmark lab</h3><p className="text-xs text-textMuted">One short prompt; never runs against paid providers.</p></div><button className={smallButton} onClick={benchmark} disabled={busy || !modelName || !["ollama", "airllm"].includes(llmSettings.provider)}><Timer className="inline w-3.5 h-3.5 mr-2" /> Run locally</button></div>
        {(llmSettings.benchmarkHistory || []).length > 0 && <div className="space-y-2">{(llmSettings.benchmarkHistory || []).slice(0, 5).map((result) => <div key={result.id} className="grid grid-cols-[1fr_auto_auto] gap-3 bg-surfaceAlt border border-border p-2 text-[10px] font-bold"><span className="truncate">{result.model} · {formatTokens(result.contextLength)}</span><span>{(result.durationMs / 1000).toFixed(1)}s</span><span>{result.outputChars} chars</span></div>)}</div>}
      </div>
      {message && <p role="status" className="text-xs font-bold text-textMuted">{message}</p>}
    </section>
  );
}
