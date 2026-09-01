import { Search } from 'lucide-react'

interface SearchBarProps { value?: string; onChange?: (value: string) => void }

export function SearchBar({ value = '', onChange }: SearchBarProps) {
  return <label className="flex h-10 w-full max-w-[360px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-slate-400 transition-colors focus-within:border-slate-400 focus-within:bg-white"><Search size={16} strokeWidth={2} aria-hidden="true" /><input aria-label="Search knowledge" value={value} onChange={(event) => onChange?.(event.target.value)} placeholder="Search knowledge..." className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400" /><kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline-block">Ctrl K</kbd></label>
}
