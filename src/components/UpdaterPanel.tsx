import { useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw } from "lucide-react";

const buttonClass = "inline-flex items-center justify-center gap-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm hover:bg-brutalBlue disabled:opacity-40";

export default function UpdaterPanel() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState("Checks run only when you click the button.");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const checkNow = async () => {
    setBusy(true);
    setProgress(null);
    setMessage("Checking the signed Iroh release feed...");
    try {
      const available = await check();
      setUpdate(available);
      setMessage(available ? `Iroh ${available.version} is available.` : "Iroh is up to date.");
    } catch (reason) {
      setUpdate(null);
      setMessage(`Update checks are unavailable in this build: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!update) return;
    setBusy(true);
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        if (event.event === "Finished") setProgress(100);
      });
      setMessage("Signed update installed. Restarting Iroh...");
      await relaunch();
    } catch (reason) {
      setMessage(`Update installation failed: ${String(reason)}`);
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
        <Download className="w-6 h-6" />
        <div>
          <h2 className="text-xl font-display font-black uppercase text-primary">Signed Updates</h2>
          <p className="text-xs text-textMuted">Manual checks against Iroh's GitHub release feed. Packages must pass Tauri signature verification before installation.</p>
        </div>
      </div>
      <p role="status" className="text-xs font-bold text-textMuted break-words">{message}</p>
      {progress !== null && (
        <div className="border-[2px] border-border h-4 bg-surfaceAlt" aria-label={`Update download ${progress}%`}>
          <div className="h-full bg-brutalBlue" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button className={buttonClass} onClick={checkNow} disabled={busy}>
          <RefreshCw className={`w-4 h-4 ${busy && !update ? "animate-spin" : ""}`} /> Check now
        </button>
        {update && <button className={buttonClass} onClick={install} disabled={busy}><Download className="w-4 h-4" /> Install {update.version}</button>}
      </div>
      {update?.body && <details className="bg-surfaceAlt border-[2px] border-border p-3"><summary className="cursor-pointer text-xs font-black uppercase">Release notes</summary><p className="text-xs whitespace-pre-wrap mt-3 text-textMuted">{update.body}</p></details>}
    </section>
  );
}
