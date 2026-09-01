import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

interface BreadcrumbItem { label: string; path?: string }
interface BreadcrumbProps { items: BreadcrumbItem[] }

export function Breadcrumb({ items }: BreadcrumbProps) {
  return <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-xs text-slate-400">{items.map((item, index) => <span className="flex items-center gap-1.5" key={item.label}>{index > 0 && <ChevronRight size={13} aria-hidden="true" />}{item.path ? <Link className="transition-colors hover:text-slate-700" to={item.path}>{item.label}</Link> : <span className="text-slate-600">{item.label}</span>}</span>)}</nav>
}
