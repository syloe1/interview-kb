import type { Project } from '../types'

export const projects: Project[] = [
  {
    id: 'reactornet',
    name: 'ReactorNet',
    category: 'C++ network library',
    description: 'A minimalist C++ network library implementing the Reactor pattern, inspired by muduo.',
    tags: ['C++', 'Linux', 'epoll', 'Reactor', 'Networking'],
    path: '/projects/reactornet',
    status: 'active',
    updatedAt: 'Updated today',
    moduleCount: 12,
  },
  {
    id: 'frontman',
    name: 'Frontman',
    category: 'Go API gateway',
    description: 'A Go API gateway with reverse proxy, routing, plugins, load balancing, and backend service management.',
    tags: ['Go', 'API Gateway', 'Reverse Proxy', 'Routing', 'Plugins'],
    path: '/projects/frontman',
    status: 'active',
    updatedAt: 'Updated today',
    moduleCount: 0,
  },
]
