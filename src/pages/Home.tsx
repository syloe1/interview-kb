import { ArrowRight, BookOpen, CheckCircle2, Clock3, LibraryBig } from 'lucide-react'
import { Link } from 'react-router-dom'
import { navigationItems } from '../data/navigation'

const iconByLabel = {
  Projects: LibraryBig,
  Go: Clock3,
  'C++': Clock3,
  Database: Clock3,
  八股: Clock3,
  MQ: Clock3,
  算法题: Clock3,
  面试: Clock3,
  K8s: Clock3,
  Linux: Clock3,
}

export function Home() {
  return <div><section className="border-b border-slate-200 pb-9"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#6988aa]"><BookOpen size={14} aria-hidden="true" /> Personal workspace</div><div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end"><div><h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">Interview-KB</h1><p className="mt-3 text-base font-medium text-slate-600">Personal Interview Knowledge Base</p><p className="mt-5 max-w-xl text-sm leading-7 text-slate-500">这是一个用于记录和复习个人项目、技术知识和面试问题的知识库。把值得再次想起的内容，整理成可以快速检索的笔记。</p></div><div className="border-l-2 border-[#bfd0e2] pl-4 text-sm text-slate-500 lg:mb-1"><p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">Current focus</p><p className="mt-2 font-medium text-slate-700">Building a stronger<br />systems foundation.</p></div></div></section><section className="pt-8"><div className="mb-4 flex items-end justify-between"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Browse by topic</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Knowledge map</h2></div><span className="hidden text-xs text-slate-400 sm:block">{navigationItems.length} sections · 1 active</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{navigationItems.map((item, index) => { const Icon = iconByLabel[item.label as keyof typeof iconByLabel]; const isActive = index === 0; return <Link key={item.path} to={item.path} className={`group flex min-h-[170px] flex-col border p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(30,52,80,0.07)] ${isActive ? 'border-[#b9cbe0] bg-[#fbfdff]' : 'border-slate-200 bg-white hover:border-slate-300'}`}><div className="flex items-start justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-md ${isActive ? 'bg-[#e7f0f8] text-[#2e5d94]' : 'bg-slate-100 text-slate-400'}`}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span><ArrowRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#2e5d94]" aria-hidden="true" /></div><h3 className="mt-7 text-base font-semibold text-slate-900">{item.label}</h3><p className="mt-1.5 text-sm leading-5 text-slate-500">{item.description}</p><div className="mt-auto pt-4"><span className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${isActive ? 'text-[#2e5d94]' : 'text-slate-400'}`}>{isActive && <CheckCircle2 size={12} aria-hidden="true" />}{item.countLabel}</span></div></Link> })}</div></section></div>
}
