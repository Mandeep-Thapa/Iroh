import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, PackageOpen, Upload } from "lucide-react";

interface PortableDataPanelProps {
  workspace: string;
}

const fieldClass = "w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue rounded-none placeholder:text-textMuted";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm hover:bg-brutalBlue disabled:opacity-40";

export default function PortableDataPanel({ workspace }: PortableDataPanelProps) {
  const [importPath, setImportPath] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const exportBundle = async () => {
    setBusy(true);
    try {
      const path = await invoke<string>("export_portable_bundle", { workspace });
      setMessage(`Portable bundle written to ${path}. Encrypted secrets are not included.`);
    } catch (reason) {
      setMessage(`Export failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const importBundle = async () => {
    if (!importPath.trim()) return;
    if (!window.confirm("Import settings and chats from this workspace bundle? Existing sessions with matching IDs will be replaced.")) return;
    setBusy(true);
    try {
      setMessage(await invoke<string>("import_portable_bundle", { workspace, path: importPath.trim() }));
    } catch (reason) {
      setMessage(`Import failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
        <PackageOpen className="w-6 h-6" />
        <div>
          <h2 className="text-xl font-display font-black uppercase text-primary">Portable Iroh Bundle</h2>
          <p className="text-xs text-textMuted">Export settings, recipes, and chats as workspace JSON. DPAPI secrets are deliberately excluded.</p>
        </div>
      </div>
      <button className={buttonClass} onClick={exportBundle} disabled={busy || !workspace}><Download className="w-4 h-4" /> Export to workspace</button>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 border-t-[2px] border-border pt-5">
        <input className={fieldClass} value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="Absolute path to iroh-portable-*.json inside the workspace" />
        <button className={buttonClass} onClick={importBundle} disabled={busy || !workspace || !importPath.trim()}><Upload className="w-4 h-4" /> Import</button>
      </div>
      {message && <p role="status" className="text-xs font-bold text-textMuted break-all">{message}</p>}
    </section>
  );
}
