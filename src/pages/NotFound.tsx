import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function NotFound() { return <div className="flex min-h-[65vh] flex-col items-center justify-center text-center"><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">404 / page not found</p><h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-950">This page doesn't exist.</h1><p className="mt-3 text-sm text-slate-500">The note may have moved, or the path is not part of this knowledge base.</p><Link to="/" className="mt-7 inline-flex items-center gap-2 border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"><ArrowLeft size={15} aria-hidden="true" /> Back home</Link></div> }
