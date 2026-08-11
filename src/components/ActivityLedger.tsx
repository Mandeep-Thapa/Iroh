import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, ScrollText, Trash2 } from "lucide-react";

interface ActivityEntry {
  id: string;
  timestamp: string;
  category: string;
  summary: string;
  detail: string;
  risk: string;
  status: string;
}

const badgeClass = "border border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider";

export default function ActivityLedger() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setEntries(await invoke<ActivityEntry[]>("list_activity"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = async () => {
    if (!window.confirm("Clear Iroh's local activity ledger? This cannot be undone.")) return;
    setBusy(true);
    try {
      await invoke("clear_activity");
      setEntries([]);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[2px] border-border pb-4">
        <div className="flex items-center gap-3">
          <ScrollText className="w-6 h-6" />
          <div>
            <h2 className="text-xl font-display font-black uppercase text-primary">Activity Ledger</h2>
            <p className="text-xs text-textMuted">Local, bounded record of approvals and tool outcomes. File contents and secrets are not logged.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="p-2 border-[2px] border-border bg-surfaceAlt hover:bg-brutalYellow hover:text-accentText" onClick={refresh} disabled={busy} aria-label="Refresh activity ledger"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button>
          <button className="p-2 border-[2px] border-border bg-surfaceAlt hover:bg-brutalRed hover:text-cream" onClick={clear} disabled={busy || entries.length === 0} aria-label="Clear activity ledger"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {error && <div role="alert" className="bg-brutalRed text-cream border-[2px] border-border p-3 text-xs font-bold">{error}</div>}
      <div role="log" aria-label="Iroh activity" className="max-h-80 overflow-y-auto custom-scrollbar space-y-2">
        {entries.length === 0 ? (
          <p className="text-sm text-textMuted font-bold py-4">No recorded activity yet.</p>
        ) : entries.map((entry) => (
          <article key={entry.id} className="bg-surfaceAlt border-[2px] border-border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${badgeClass} bg-surface text-primary`}>{entry.category}</span>
              <span className={`${badgeClass} ${entry.risk === "execute" || entry.status === "blocked" ? "bg-brutalRed text-cream" : entry.risk === "write" || entry.risk === "network" ? "bg-brutalYellow text-accentText" : "bg-brutalBlue text-cream"}`}>{entry.risk}</span>
              <span className={`${badgeClass} bg-surface text-primary`}>{entry.status}</span>
              <time className="ml-auto text-[10px] text-textMuted font-bold" dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
            </div>
            <h3 className="text-xs font-black text-primary">{entry.summary}</h3>
            {entry.detail && <pre className="whitespace-pre-wrap break-words text-[10px] text-textMuted font-mono">{entry.detail}</pre>}
          </article>
        ))}
      </div>
    </section>
  );
}
