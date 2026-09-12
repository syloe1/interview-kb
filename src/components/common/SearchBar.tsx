import { Search } from 'lucide-react';

interface SearchBarProps {
  value?: string;
  onChange?: (value: string) => void;
}

export function SearchBar({ value = '', onChange }: SearchBarProps) {
  return (
    <label className="flex h-10 w-full max-w-[360px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--hover-bg)] px-3 text-[var(--text-faint)] transition-colors focus-within:border-[var(--border-active)] focus-within:bg-[var(--card-bg)]">
      <Search size={16} strokeWidth={2} aria-hidden="true" />
      <input
        aria-label="Search knowledge"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="Search knowledge..."
        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-faint)]"
      />
      <kbd className="hidden rounded border border-[var(--border)] bg-[var(--card-bg)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-faint)] sm:inline-block">
        Ctrl K
      </kbd>
    </label>
  );
}
