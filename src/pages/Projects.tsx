import { FolderGit2 } from 'lucide-react'
import { Breadcrumb } from '../components/common/Breadcrumb'
import { ProjectCard } from '../components/project/ProjectCard'
import { projects } from '../data/projects'

export function Projects() { return <div><Breadcrumb items={[{ label: 'Projects' }]} /><div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-7 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2 text-[#2e5d94]"><FolderGit2 size={17} aria-hidden="true" /><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">01 collection</span></div><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-slate-950">Projects</h1><p className="mt-2 text-sm text-slate-500">My projects and interview notes.</p></div><span className="font-mono text-xs text-slate-400">{projects.length.toString().padStart(2, '0')} projects</span></div><div className="mt-7 space-y-3">{projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div></div> }
