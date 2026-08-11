import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookMarked, Database, Search } from "lucide-react";

interface KnowledgeBuildReport {
  filesIndexed: number;
  chunksIndexed: number;
  embedded: boolean;
  indexPath: string;
}

interface KnowledgeHit {
  path: string;
  lineStart: number;
  lineEnd: number;
  score: number;
  text: string;
}

interface KnowledgePanelProps {
  workspace: string;
  ollamaEndpoint: string;
}

const fieldClass = "w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue rounded-none placeholder:text-textMuted";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-primary text-cream px-4 py-2.5 border-[2px] border-border font-display font-black uppercase text-xs tracking-widest shadow-brutal-sm hover:bg-brutalBlue disabled:opacity-40";

export default function KnowledgePanel({ workspace, ollamaEndpoint }: KnowledgePanelProps) {
  const [embeddingModel, setEmbeddingModel] = useState("embeddinggemma");
  const [semantic, setSemantic] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [report, setReport] = useState<KnowledgeBuildReport | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const build = async () => {
    if (!workspace) return;
    setBusy(true);
    setMessage(semantic ? "Building local semantic index. This can take several minutes..." : "Building local lexical index...");
    try {
      const result = await invoke<KnowledgeBuildReport>("build_workspace_knowledge", {
        workspace,
        ollamaEndpoint,
        embeddingModel: semantic ? embeddingModel : null,
      });
      setReport(result);
      setMessage(`Indexed ${result.filesIndexed} file(s) into ${result.chunksIndexed} cited chunk(s).`);
    } catch (reason) {
      setMessage(`Indexing failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim() || !workspace) return;
    setBusy(true);
    setMessage("");
    try {
      const results = await invoke<KnowledgeHit[]>("search_workspace_knowledge", {
        workspace,
        ollamaEndpoint,
        query: query.trim(),
      });
      setHits(results);
      setMessage(results.length ? `Found ${results.length} cited result(s).` : "No relevant workspace sections found.");
    } catch (reason) {
      setMessage(`Search failed: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
        <BookMarked className="w-6 h-6" />
        <div>
          <h2 className="text-xl font-display font-black uppercase text-primary">Workspace Knowledge</h2>
          <p className="text-xs text-textMuted">Local retrieval with source paths and line ranges. Hidden files, large files, and ignored files are skipped.</p>
        </div>
      </div>

      <label className="flex items-start gap-3 bg-surfaceAlt border-[2px] border-border p-3 text-sm font-bold cursor-pointer">
        <input type="checkbox" className="mt-1" checked={semantic} onChange={(event) => setSemantic(event.target.checked)} />
        <span><strong>Use local semantic embeddings</strong><span className="block text-xs text-textMuted mt-1">Requires the selected embedding model in Ollama. No model is downloaded automatically.</span></span>
      </label>
      {semantic && (
        <div>
          <label className="block text-[10px] font-display font-black uppercase tracking-widest text-textMuted mb-2">Ollama embedding model</label>
          <input className={fieldClass} value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} placeholder="embeddinggemma" />
        </div>
      )}
      <button className={buttonClass} onClick={build} disabled={busy || !workspace}><Database className="w-4 h-4" /> {report ? "Rebuild index" : "Build index"}</button>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 border-t-[2px] border-border pt-5">
        <input className={fieldClass} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="Search this workspace with citations" />
        <button className={buttonClass} onClick={search} disabled={busy || !query.trim() || !workspace}><Search className="w-4 h-4" /> Search</button>
      </div>
      {message && <p role="status" className="text-xs font-bold text-textMuted">{message}</p>}
      {report && <p className="text-[10px] font-mono text-textMuted break-all">{report.embedded ? "Semantic" : "Lexical"} index: {report.indexPath}</p>}

      {hits.length > 0 && (
        <div className="space-y-3">
          {hits.map((hit, index) => (
            <article key={`${hit.path}:${hit.lineStart}:${index}`} className="bg-surfaceAlt border-[2px] border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <code className="text-xs font-black text-primary break-all">{hit.path}:{hit.lineStart}-{hit.lineEnd}</code>
                <span className="text-[9px] font-black uppercase bg-brutalBlue text-cream border border-border px-2 py-0.5">{Math.round(hit.score * 100)}% match</span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-[11px] text-textMuted font-mono max-h-40 overflow-y-auto custom-scrollbar">{hit.text}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
