import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cable, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { McpServerProfile, McpToolSummary } from "../types";

interface McpDiscovery {
  endpoint: string;
  serverInfo: { name?: string; version?: string } | null;
  tools: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

interface McpPanelProps {
  servers: McpServerProfile[];
  onChange: (servers: McpServerProfile[]) => void;
}

const fieldClass = "w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue rounded-none placeholder:text-textMuted";
const iconButton = "p-2.5 border-[2px] border-border bg-surface hover:bg-brutalYellow hover:text-accentText disabled:opacity-30";

export default function McpPanel({ servers, onChange }: McpPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<McpServerProfile>) => {
    onChange(servers.map((server) => server.id === id ? { ...server, ...patch } : server));
  };

  const add = () => {
    onChange([...servers, {
      id: `mcp_${Date.now()}`,
      name: "Local MCP",
      endpoint: "http://127.0.0.1:3000/mcp",
      enabled: false,
      tools: [],
      status: "Not inspected",
    }]);
  };

  const inspect = async (server: McpServerProfile) => {
    setBusyId(server.id);
    try {
      const discovery = await invoke<McpDiscovery>("inspect_mcp_server", { endpoint: server.endpoint });
      const tools: McpToolSummary[] = discovery.tools
        .filter((tool): tool is typeof tool & { name: string } => Boolean(tool.name))
        .map((tool) => ({ name: tool.name, description: tool.description || "No description", inputSchema: tool.inputSchema || {} }));
      update(server.id, {
        tools,
        status: `${discovery.serverInfo?.name || "MCP server"} · ${tools.length} tool(s)`,
        enabled: server.enabled && tools.length > 0,
      });
    } catch (reason) {
      update(server.id, { enabled: false, tools: [], status: `Inspection failed: ${String(reason)}` });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[2px] border-border pb-4">
        <div className="flex items-center gap-3">
          <Cable className="w-6 h-6" />
          <div>
            <h2 className="text-xl font-display font-black uppercase text-primary">Local MCP Servers</h2>
            <p className="text-xs text-textMuted">Loopback HTTP only. Tools are discovered progressively and every model-requested call still requires approval.</p>
          </div>
        </div>
        <button className="inline-flex items-center gap-2 px-3 py-2 border-[2px] border-border bg-primary text-cream font-black text-xs uppercase hover:bg-brutalBlue" onClick={add}><Plus className="w-4 h-4" /> Add</button>
      </div>

      {servers.length === 0 ? <p className="text-sm font-bold text-textMuted">No MCP servers configured. Iroh never starts arbitrary MCP commands automatically.</p> : servers.map((server) => (
        <article key={server.id} className="bg-surfaceAlt border-[2px] border-border p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto] gap-3 items-end">
            <div><label className="block text-[10px] font-black uppercase tracking-widest text-textMuted mb-2">Name</label><input className={fieldClass} value={server.name} onChange={(event) => update(server.id, { name: event.target.value, enabled: false })} /></div>
            <div><label className="block text-[10px] font-black uppercase tracking-widest text-textMuted mb-2">Loopback endpoint</label><input className={fieldClass} value={server.endpoint} onChange={(event) => update(server.id, { endpoint: event.target.value, enabled: false, tools: [] })} /></div>
            <button className={iconButton} onClick={() => inspect(server)} disabled={busyId === server.id} aria-label={`Inspect ${server.name}`}><RefreshCw className={`w-4 h-4 ${busyId === server.id ? "animate-spin" : ""}`} /></button>
            <button className={`${iconButton} hover:bg-brutalRed hover:text-cream`} onClick={() => onChange(servers.filter((item) => item.id !== server.id))} aria-label={`Delete ${server.name}`}><Trash2 className="w-4 h-4" /></button>
          </div>
          <label className="flex items-center gap-3 text-xs font-black uppercase">
            <input type="checkbox" checked={server.enabled} disabled={server.tools.length === 0} onChange={(event) => update(server.id, { enabled: event.target.checked })} />
            Expose discovered tools to Iroh
          </label>
          <p className="text-xs font-bold text-textMuted">{server.status}</p>
          {server.tools.length > 0 && <div className="flex flex-wrap gap-2">{server.tools.map((tool) => <span key={tool.name} title={tool.description} className="bg-surface border border-border px-2 py-1 text-[10px] font-mono font-bold">{tool.name}</span>)}</div>}
        </article>
      ))}
    </section>
  );
}
