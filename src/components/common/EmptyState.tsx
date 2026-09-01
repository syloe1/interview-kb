import { Construction } from 'lucide-react'

interface EmptyStateProps { title: string; description: string }

export function EmptyState({ title, description }: EmptyStateProps) {
  return <div className="flex min-h-[360px] flex-col items-center justify-center border border-dashed border-slate-200 bg-white px-6 text-center"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Construction size={20} strokeWidth={1.8} aria-hidden="true" /></div><h2 className="text-base font-semibold text-slate-800">{title}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p></div>
}
