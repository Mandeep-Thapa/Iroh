import { Accessibility, Contrast, Gauge, Move } from "lucide-react";
import type { AccessibilitySettings } from "../types";

interface AccessibilityPanelProps {
  value: AccessibilitySettings;
  onChange: (value: AccessibilitySettings) => void;
}

export default function AccessibilityPanel({ value, onChange }: AccessibilityPanelProps) {
  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex items-center gap-3 border-b-[2px] border-border pb-4">
        <Accessibility className="w-6 h-6" />
        <div><h2 className="text-xl font-display font-black uppercase text-primary">Accessibility</h2><p className="text-xs text-textMuted">Display preferences apply immediately and are stored locally.</p></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="bg-surfaceAlt border-[2px] border-border p-4 space-y-3">
          <span className="flex items-center gap-2 text-xs font-black uppercase"><Gauge className="w-4 h-4" /> UI scale</span>
          <input type="range" min="90" max="120" step="5" value={value.uiScale} onChange={(event) => onChange({ ...value, uiScale: Number(event.target.value) })} className="w-full accent-brutalBlue" />
          <span className="text-xs font-bold text-textMuted">{value.uiScale}%</span>
        </label>
        <label className="bg-surfaceAlt border-[2px] border-border p-4 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={value.reducedMotion} onChange={(event) => onChange({ ...value, reducedMotion: event.target.checked })} />
          <span><strong className="flex items-center gap-2 text-xs uppercase"><Move className="w-4 h-4" /> Reduced motion</strong><span className="block text-xs text-textMuted mt-2">Disables non-essential transitions and animated status effects.</span></span>
        </label>
        <label className="bg-surfaceAlt border-[2px] border-border p-4 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={value.highContrast} onChange={(event) => onChange({ ...value, highContrast: event.target.checked })} />
          <span><strong className="flex items-center gap-2 text-xs uppercase"><Contrast className="w-4 h-4" /> High contrast</strong><span className="block text-xs text-textMuted mt-2">Strengthens borders, text, focus rings, and panel separation.</span></span>
        </label>
      </div>
    </section>
  );
}
