import { useState } from "react";
import { BookOpenCheck, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { TaskRecipe } from "../types";

interface RecipesPanelProps {
  recipes: TaskRecipe[];
  onChange: (recipes: TaskRecipe[]) => void;
}

const fieldClass = "w-full bg-surfaceAlt border-[2px] border-border px-3 py-2.5 text-sm font-bold text-primary focus:outline-none focus:border-brutalBlue rounded-none placeholder:text-textMuted";

export default function RecipesPanel({ recipes, onChange }: RecipesPanelProps) {
  const [editing, setEditing] = useState<TaskRecipe | null>(null);

  const startNew = () => setEditing({ id: `recipe_${Date.now()}`, name: "New recipe", description: "", prompt: "", builtIn: false });
  const save = () => {
    if (!editing || !editing.name.trim() || !editing.prompt.trim()) return;
    const normalized = { ...editing, name: editing.name.trim(), description: editing.description.trim(), prompt: editing.prompt.trim() };
    onChange(recipes.some((recipe) => recipe.id === editing.id) ? recipes.map((recipe) => recipe.id === editing.id ? normalized : recipe) : [...recipes, normalized]);
    setEditing(null);
  };

  return (
    <section className="bg-surface border-[2px] border-border p-6 shadow-brutal space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[2px] border-border pb-4">
        <div className="flex items-center gap-3"><BookOpenCheck className="w-6 h-6" /><div><h2 className="text-xl font-display font-black uppercase text-primary">Task Recipes</h2><p className="text-xs text-textMuted">Reusable starting prompts for deliberate, repeatable work.</p></div></div>
        <button className="inline-flex items-center gap-2 px-3 py-2 border-[2px] border-border bg-primary text-cream font-black text-xs uppercase hover:bg-brutalBlue" onClick={startNew}><Plus className="w-4 h-4" /> Add</button>
      </div>

      {editing && (
        <div className="bg-brutalYellow/30 border-[2px] border-border p-4 space-y-3">
          <input className={fieldClass} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Recipe name" />
          <input className={fieldClass} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} placeholder="Short description" />
          <textarea className={`${fieldClass} min-h-32 resize-y`} value={editing.prompt} onChange={(event) => setEditing({ ...editing, prompt: event.target.value })} placeholder="Prompt placed in the composer" />
          <div className="flex gap-2"><button className="inline-flex items-center gap-2 px-3 py-2 border-[2px] border-border bg-primary text-cream text-xs font-black uppercase" onClick={save}><Save className="w-4 h-4" /> Save</button><button className="inline-flex items-center gap-2 px-3 py-2 border-[2px] border-border bg-surface text-primary text-xs font-black uppercase" onClick={() => setEditing(null)}><X className="w-4 h-4" /> Cancel</button></div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recipes.map((recipe) => (
          <article key={recipe.id} className="bg-surfaceAlt border-[2px] border-border p-4 flex gap-3 items-start">
            <div className="min-w-0 flex-1"><h3 className="text-sm font-black uppercase text-primary">{recipe.name}</h3><p className="text-xs text-textMuted mt-1">{recipe.description}</p><p className="text-[10px] font-mono text-textMuted mt-3 line-clamp-3">{recipe.prompt}</p></div>
            <div className="flex gap-1"><button className="p-2 border border-border bg-surface" onClick={() => setEditing({ ...recipe })} aria-label={`Edit ${recipe.name}`}><Pencil className="w-3.5 h-3.5" /></button>{!recipe.builtIn && <button className="p-2 border border-border bg-surface hover:bg-brutalRed hover:text-cream" onClick={() => onChange(recipes.filter((item) => item.id !== recipe.id))} aria-label={`Delete ${recipe.name}`}><Trash2 className="w-3.5 h-3.5" /></button>}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
