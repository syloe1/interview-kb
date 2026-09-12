import { Moon, Sun, Gamepad2 } from 'lucide-react';
import { useTheme, type Theme } from '../../hooks/useTheme';

const themeConfig: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: '浅色主题' },
  dark: { icon: Moon, label: '深色主题' },
  pixel: { icon: Gamepad2, label: '像素主题' },
};

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const { icon: Icon, label } = themeConfig[theme];

  return (
    <button
      onClick={cycleTheme}
      aria-label={`切换主题，当前：${label}`}
      title={`${label}（点击切换）`}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--accent)]"
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
