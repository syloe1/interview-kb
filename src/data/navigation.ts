import type { NavigationItem } from '../types'

export const navigationItems: NavigationItem[] = [
  { label: 'Projects', path: '/projects', description: '我的项目经历、架构设计和面试问题', icon: 'folder', countLabel: '2 projects' },
  { label: 'Go', path: '/go', description: 'Go 语言相关知识和面试问题', icon: 'terminal', countLabel: 'Coming soon' },
  { label: 'C++', path: '/cpp', description: 'C++ 相关知识和面试问题', icon: 'braces', countLabel: 'Coming soon' },
  { label: 'Database', path: '/database', description: 'MySQL、Redis、数据库原理等', icon: 'database', countLabel: 'Coming soon' },
  { label: '八股', path: '/fundamentals', description: '操作系统、网络、分布式等基础知识', icon: 'layers', countLabel: 'Coming soon' },
]
