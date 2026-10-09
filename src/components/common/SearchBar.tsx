import { Search } from 'lucide-react';

interface SearchBarProps {
  onOpen: () => void;
}

// 长得像输入框，实际是个按钮：真正的输入框在 SearchDialog 里，
// 这样弹窗能统一处理键盘选择、跳转和索引加载。
export function SearchBar({ onOpen }: SearchBarProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="搜索笔记（Ctrl+K）"
      className="flex h-10 w-full max-w-[360px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--hover-bg)] px-3 text-[var(--text-faint)] transition-colors hover:border-[var(--border-active)] hover:bg-[var(--card-bg)]"
    >
      <Search size={16} strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left text-sm">搜索笔记…</span>
      <kbd className="hidden rounded border border-[var(--border)] bg-[var(--card-bg)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-faint)] sm:inline-block">
        Ctrl K
      </kbd>
    </button>
  );
}
