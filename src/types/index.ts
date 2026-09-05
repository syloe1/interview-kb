export type NavIcon = 'folder' | 'terminal' | 'braces' | 'database' | 'layers'

export interface NavigationItem {
  label: string
  path: string
  description: string
  icon: NavIcon
  countLabel: string
}

export interface Project {
  id: string
  name: string
  category: string
  description: string
  tags: string[]
  path: string
  fileName?: string
  status: 'active' | 'planned'
  updatedAt: string
  moduleCount: number
}
