import { useEffect, useRef } from "react";
import { Terminal as TermIcon } from "lucide-react";

interface TerminalBridgeProps {
  logs: string[];
}

export default function TerminalBridge({ logs }: TerminalBridgeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-full flex flex-col bg-[#0d0d0d] font-mono text-xs">
      <div className="h-8 border-b border-[#2a2a2a] flex items-center px-3 shrink-0">
        <div className="flex items-center space-x-1.5 text-[10px] font-display font-black uppercase tracking-widest text-[#666]">
          <TermIcon className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Terminal</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-0.5 custom-scrollbar">
        {logs.length === 0 ? (
          <span className="text-[#555] italic text-[11px]">No output yet.</span>
        ) : (
          logs.map((log, i) => {
            const isSystem = log.includes("[SYSTEM]");
            const isError = log.includes("[ERROR]") || log.includes("[SYSTEM ERROR]");
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div key={i} className="flex">
                <span className="text-[#444] mr-2 shrink-0 select-none">[{timestamp}]</span>
                <span className={isError ? 'text-[#ff6b6b]' : isSystem ? 'text-[#5cdb5c]' : 'text-[#ccc]'}>{log}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
