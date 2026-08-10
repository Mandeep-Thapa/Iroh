import { Shield, ShieldAlert, Cpu } from "lucide-react";

interface StatusBarProps {
  workspace: string;
  username: string;
  isRestricted: boolean;
  processState: string;
}

export default function StatusBar({ workspace, username, isRestricted, processState }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs select-none">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          {isRestricted ? (
            <Shield className="w-4 h-4 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          )}
          <span className="font-semibold text-slate-400">
            Target Workspace: <span className="text-slate-100 font-mono">{workspace}</span>
          </span>
        </div>
        
        <div className="h-3 w-px bg-slate-800" />
        
        <div className="flex items-center space-x-2">
          <Cpu className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-slate-400">
            Principal: <span className="text-slate-100 font-mono">{username} {isRestricted && "(Restricted)"}</span>
          </span>
        </div>
      </div>
      
      <div>
        <span className="flex items-center space-x-2">
          <span className="relative flex h-2.5 w-2.5">
            {processState === "Running" ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </>
            ) : processState === "Error" ? (
               <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            ) : (
               <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-600"></span>
            )}
          </span>
          <span className="text-slate-400 font-mono text-xs">{processState}</span>
        </span>
      </div>
    </div>
  );
}
