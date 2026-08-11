import { Activity, CheckCircle2, Circle, PlayCircle, ShieldAlert, XCircle, RotateCcw, Cpu, HardDrive } from "lucide-react";
import { ReasoningLog, LLMSettings, SystemStats } from "../types";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatTokens, recommendContext } from "../modelGuidance";

interface TaskInspectorProps {
  workspace: string;
  reasoningLog: ReasoningLog | null;
  isExecuting: boolean;
  onResetWorkspace: () => void;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (enabled: boolean) => void;
  isInitialized: boolean;
  llmSettings: LLMSettings;
  setLlmSettings: (settings: LLMSettings) => void;
}

export default function TaskInspector({ 
  workspace, reasoningLog, isExecuting, onResetWorkspace, telemetryEnabled, setTelemetryEnabled, isInitialized,
  llmSettings, setLlmSettings
}: TaskInspectorProps) {
  
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const fetchSnapshot = async () => {
      try {
        const id = await invoke<string>("get_latest_snapshot", { workspace });
        if (id !== "No snapshots available.") {
          setLatestSnapshot(id);
        }
      } catch (e) {
        console.error(e);
      }
    };
    
    const fetchStats = async () => {
      try {
        const stats = await invoke<SystemStats>("get_system_stats");
        setSystemStats(stats);
      } catch (e) {
        console.error("Failed to fetch system stats:", e);
      }
    };

    fetchSnapshot();
    fetchStats();
    
    // Poll every 5s for new snapshots
    const snapInterval = setInterval(fetchSnapshot, 5000);
    // Poll every 2s for system stats
    const statsInterval = setInterval(fetchStats, 2000);
    
    return () => {
      clearInterval(snapInterval);
      clearInterval(statsInterval);
    };
  }, [workspace]);

  const handleRollback = async () => {
    if (!latestSnapshot || !workspace) return;
    setIsRollingBack(true);
    if (!window.confirm("Restore the latest snapshot? Backed-up files will be replaced, while newer files are preserved.")) return;
    try {
      await invoke("rollback_snapshot", { workspace, snapshotId: latestSnapshot });
      alert("Successfully rolled back to snapshot: " + latestSnapshot);
    } catch (e) {
      alert("Rollback failed: " + e);
    } finally {
      setIsRollingBack(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-brutalYellow" />;
      case 'running': return <PlayCircle className="w-4 h-4 text-brutalBlue animate-pulse" />;
      case 'failed': return <XCircle className="w-4 h-4 text-brutalRed" />;
      case 'blocked': return <ShieldAlert className="w-4 h-4 text-brutalRed" />;
      default: return <Circle className="w-4 h-4 text-textMuted" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface border-l-[2px] border-border font-sans">
      <div className="h-10 border-b-[2px] border-border flex items-center justify-between px-4 bg-brutalYellow shrink-0">
        <div className="flex items-center space-x-2 font-display font-black text-[11px] uppercase tracking-widest text-accentText">
          <Activity className="w-4 h-4 stroke-[3]" />
          <span>Inspector</span>
        </div>
        {isExecuting && (
          <div className="flex items-center space-x-1.5">
            <span className="text-[9px] font-bold text-accentText">ACTIVE</span>
            <div className="w-2 h-2 bg-brutalRed animate-pulse"></div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-5">
        
        {/* Actions */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Actions</h3>
          
          <button 
            onClick={handleRollback}
            disabled={!latestSnapshot || isRollingBack || isExecuting}
            className="w-full flex items-center justify-center space-x-2 bg-surfaceAlt text-primary border-[2px] border-border px-3 py-2 font-display font-black text-[10px] uppercase tracking-widest hover:bg-brutalBlue hover:text-cream transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4 stroke-[2.5]" />
            <span>{isRollingBack ? "Rolling Back..." : (latestSnapshot ? "Undo AI Action" : "No Snapshots")}</span>
          </button>

          <button 
            onClick={() => { if (window.confirm("Reset this workspace? Current contents will be moved to .antigravity/recovery so they can be recovered.")) onResetWorkspace(); }}
            disabled={!isInitialized || isExecuting}
            className="w-full bg-surfaceAlt text-primary border-[2px] border-border px-3 py-2.5 font-display font-black text-[10px] uppercase tracking-widest hover:bg-brutalRed hover:text-cream transition-colors disabled:opacity-50"
          >
            Reset Workspace
          </button>
        </div>

        {/* Telemetry Toggle */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Telemetry</h3>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <div className="relative">
              <input type="checkbox" checked={telemetryEnabled} onChange={(e) => setTelemetryEnabled(e.target.checked)} className="sr-only" />
              <div className={`block w-10 h-5 border-[2px] border-border transition-colors ${telemetryEnabled ? 'bg-brutalYellow' : 'bg-surfaceAlt'}`}></div>
              <div className={`absolute left-[2px] top-[2px] bg-primary w-3.5 h-3.5 transition-transform ${telemetryEnabled ? 'translate-x-[18px]' : ''}`}></div>
            </div>
            <span className="text-xs font-bold text-primary group-hover:text-brutalBlue transition-colors">Usage Data</span>
          </label>
        </div>

        {/* Reasoning Log */}
        <div className="space-y-2 pt-3 border-t-[2px] border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Live Reasoning</h3>
            {reasoningLog && <span className="text-[9px] font-bold text-textMuted">{reasoningLog.timestamp}</span>}
          </div>
          
          {!reasoningLog ? (
            <div className="text-xs font-bold text-textMuted italic p-3 border-[2px] border-border border-dashed bg-surfaceAlt">
              Waiting for agent activity...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-surfaceAlt border-[2px] border-border p-3">
                <h4 className="text-[9px] font-display font-black uppercase text-brutalBlue mb-1">Agent Thought</h4>
                <p className="text-[11px] text-primary leading-relaxed">{reasoningLog.thinkingText}</p>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[9px] font-display font-black uppercase text-textMuted pl-0.5">Steps</h4>
                {reasoningLog.steps.map((step) => (
                  <div key={step.id} className="bg-surfaceAlt border border-border p-2.5 flex items-start space-x-2 transition-all hover:translate-x-0.5">
                    <div className="mt-0.5 shrink-0">{getStatusIcon(step.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-display font-black uppercase text-primary truncate">{step.title}</p>
                      {step.details && <p className="text-[10px] text-textMuted mt-0.5 truncate" title={step.details}>{step.details}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* System Stats & Context Length */}
        <div className="space-y-4 pt-3 border-t-[2px] border-border pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted">Context Length</h3>
            <span className="text-[10px] font-bold text-accentText">{(() => {
              const val = llmSettings.contextLength || 32768;
              return val >= 1024 ? `${val / 1024}k` : val;
            })()}</span>
          </div>
          
          {(() => {
            const CONTEXT_OPTIONS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
            const currentIndex = CONTEXT_OPTIONS.indexOf(llmSettings.contextLength || 32768);
            const value = currentIndex !== -1 ? currentIndex : 4;
            return (
              <input 
                type="range" 
                min="0" 
                max={CONTEXT_OPTIONS.length - 1} 
                step="1" 
                value={value}
                onChange={(e) => setLlmSettings({ ...llmSettings, contextLength: CONTEXT_OPTIONS[parseInt(e.target.value, 10)] })}
                className="w-full accent-brutalBlue h-1 bg-surfaceAlt appearance-none outline-none cursor-pointer border-[1px] border-border"
              />
            );
          })()}

          {(() => {
            const suggestion = recommendContext({
              provider: llmSettings.provider,
              systemStats,
            });
            const isSelected = (llmSettings.contextLength || 32768) === suggestion.tokens;
            return (
              <div className="bg-brutalYellow/25 border-[2px] border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary">Suggested: {formatTokens(suggestion.tokens)}</span>
                  {!isSelected && (
                    <button
                      className="bg-primary text-cream border-[2px] border-border px-2 py-1 text-[9px] font-black uppercase hover:bg-brutalBlue"
                      onClick={() => setLlmSettings({ ...llmSettings, contextLength: suggestion.tokens })}
                    >
                      Use
                    </button>
                  )}
                </div>
                <p className="text-[10px] font-bold text-textMuted leading-relaxed">{suggestion.explanation}</p>
              </div>
            );
          })()}


          <h3 className="text-[10px] font-display font-black uppercase tracking-widest text-textMuted pt-2">System Stats</h3>
          
          <div className="space-y-3">
            <div className="bg-surfaceAlt border-[2px] border-border p-2">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center space-x-1.5 text-primary">
                  <Cpu className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[10px] font-bold uppercase">RAM</span>
                </div>
                <span className="text-[9px] font-bold text-textMuted">
                  {systemStats ? `${(systemStats.ram_used_mb / 1024).toFixed(1)} / ${(systemStats.ram_total_mb / 1024).toFixed(1)} GB` : '--'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface border-[1px] border-border">
                <div 
                  className="h-full bg-brutalBlue transition-all duration-500"
                  style={{ width: systemStats ? `${(systemStats.ram_used_mb / systemStats.ram_total_mb) * 100}%` : '0%' }}
                />
              </div>
            </div>

            <div className="bg-surfaceAlt border-[2px] border-border p-2">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center space-x-1.5 text-primary">
                  <HardDrive className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="text-[10px] font-bold uppercase">VRAM</span>
                </div>
                <span className="text-[9px] font-bold text-textMuted">
                  {systemStats ? (systemStats.vram_total_mb > 0 ? `${(systemStats.vram_used_mb / 1024).toFixed(1)} / ${(systemStats.vram_total_mb / 1024).toFixed(1)} GB` : 'N/A') : '--'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface border-[1px] border-border">
                <div 
                  className="h-full bg-brutalYellow transition-all duration-500"
                  style={{ width: systemStats && systemStats.vram_total_mb > 0 ? `${(systemStats.vram_used_mb / systemStats.vram_total_mb) * 100}%` : '0%' }}
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
