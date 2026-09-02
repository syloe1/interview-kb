import type { NavigationItem } from '../types'

export const navigationItems: NavigationItem[] = [
  { label: 'Projects', path: '/projects', description: '我的项目经历、架构设计和面试问题', icon: 'folder', countLabel: '2 projects' },
  { label: 'Go', path: '/go', description: 'Go 语言相关知识和面试问题', icon: 'terminal', countLabel: '1 note' },
  { label: 'C++', path: '/cpp', description: 'C++ 相关知识和面试问题', icon: 'braces', countLabel: '1 note' },
  { label: 'Database', path: '/database', description: 'MySQL、Redis、数据库原理等', icon: 'database', countLabel: '1 note' },
  { label: '八股', path: '/fundamentals', description: '操作系统、网络、分布式等基础知识', icon: 'layers', countLabel: 'Coming soon' },
  { label: 'MQ', path: '/mq', description: '消息队列、Kafka、RabbitMQ 等知识和面试问题', icon: 'layers', countLabel: 'Coming soon' },
  { label: '算法题', path: '/algorithms', description: 'hot100 + 算法题目和解题思路', icon: 'layers', countLabel: 'Coming soon' },
  { label: '面试', path: '/interview', description: '面试经历', icon: 'layers', countLabel: 'Coming soon' },
  { label: 'K8s', path: '/k8s', description: 'Kubernetes、容器编排和云原生知识', icon: 'layers', countLabel: 'Coming soon' },
  { label: 'Linux', path: '/linux', description: 'Linux 系统、命令和内核基础', icon: 'terminal', countLabel: 'Coming soon' },
]
