export type NavIcon = 'folder' | 'terminal' | 'braces' | 'database' | 'layers';

export interface NavigationItem {
  label: string          // 显示名称
  path: string           // 路由路径
  description: string    // 描述文字
  icon: NavIcon         // 图标标识
  countLabel: string    // 数量标签
}

export interface Project {
  id: string              // 唯一标识
  name: string            // 项目名称
  category: string        // 项目分类
  description: string     // 项目描述
  tags: string[]          // 标签数组
  path: string            // 文件路径
  fileName?: string       // 文件名（可选）
  status: 'active' | 'planned'  // 状态联合
  updatedAt: string       // 更新时间
  moduleCount: number     // 模块数量
}