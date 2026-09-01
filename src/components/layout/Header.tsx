import { GitBranch, Menu } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SearchBar } from '../common/SearchBar'

interface HeaderProps { onMenuClick: () => void }

export function Header({ onMenuClick }: HeaderProps) {
  return <header className="sticky top-0 z-30 flex h-[68px] items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8"><div className="flex w-full items-center gap-3"><button aria-label="Open navigation" onClick={onMenuClick} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"><Menu size={19} aria-hidden="true" /></button><Link to="/" className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-slate-900"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 font-mono text-[11px] font-bold text-white">&gt;_</span>Interview-KB</Link><div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-5"><div className="hidden min-w-0 md:block"><SearchBar /></div><a href="https://github.com/" target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"><GitBranch size={16} aria-hidden="true" /><span className="hidden sm:inline">GitHub</span></a></div></div></header>
}
