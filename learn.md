# Interview-KB 项目学习指南

这是一份针对当前代码的学习路线。建议不要一开始就逐个文件通读，而是先让页面跑起来，再沿着一次页面访问的完整链路阅读代码。

## 1. 先认识项目

Interview-KB 是一个静态的个人面试知识库：

- React 19：编写页面和组件
- TypeScript：为组件、数据和路由提供类型
- Vite：开发服务器和生产构建
- React Router：页面路由
- Tailwind CSS：页面样式
- `react-markdown`：把 Markdown 转成页面
- `highlight.js`：代码高亮

它没有后端、数据库和 API。Markdown 文件直接和前端代码一起打包，适合部署到 GitHub Pages。

整体数据流可以先记成：

```text
浏览器
  -> src/main.tsx
  -> src/App.tsx
  -> HashRouter 根据 URL 选择页面
  -> Layout 提供 Header、Sidebar 和 Outlet
  -> 页面读取 data 或 content
  -> React 组件渲染 HTML
```

## 2. 第一次运行

在项目根目录执行：

```bash
npm install
npm run dev
```

然后访问：

```text
http://localhost:5173/
```

常用地址：

```text
首页：       http://localhost:5173/
Projects：  http://localhost:5173/#/projects
项目详情：   http://localhost:5173/#/projects/frontman
K8s：        http://localhost:5173/#/k8s
K8s 笔记：   http://localhost:5173/#/k8s/k8s
```

项目使用 `HashRouter`，所以内部页面地址必须包含 `#`。

检查代码是否可以发布：

```bash
npm run build
npm run preview
```

当前 Vite 7 建议使用 Node.js `20.19+` 或 `22.12+`。如果本机是 `20.18.0`，通常仍可运行，但会看到版本警告。

## 3. 推荐阅读顺序

### 第一步：入口和路由

先看：

```text
src/main.tsx
src/App.tsx
```

重点理解：

- `createRoot` 如何挂载 React 应用
- `HashRouter` 为什么适合 GitHub Pages
- `Route` 如何把 URL 映射到页面组件
- `:projectId` 和 `:noteId` 如何成为动态参数
- `Suspense` 和 `lazy` 为什么只用于项目详情页

可以先追踪这几个路由：

```text
/                       -> Home
/projects               -> Projects
/projects/:projectId   -> ProjectDetail
/k8s                    -> K8s
/k8s/:noteId            -> KnowledgeDetail
```

### 第二步：页面骨架

阅读：

```text
src/components/layout/Layout.tsx
src/components/layout/Header.tsx
src/components/layout/Sidebar.tsx
src/pages/Home.tsx
```

理解以下概念：

- `Layout` 使用 `Outlet` 显示当前路由页面
- `Header` 是顶部固定区域
- `Sidebar` 使用 `NavLink` 判断当前菜单是否激活
- `Home` 从 `navigationItems` 循环生成首页分类卡片
- `Link` 和 `NavLink` 都是前端路由跳转，不会刷新整个页面

### 第三步：数据和类型

阅读：

```text
src/types/index.ts
src/data/navigation.ts
src/data/projects.ts
```

重点理解：

- `interface` 如何描述对象结构
- `Project` 如何保证项目数据字段完整
- `NavIcon` 联合类型如何限制图标名称
- `navigationItems` 如何同时驱动侧边栏和首页
- 为什么新增项目需要同时维护元数据和 Markdown 文件

例如，Projects 的数据链路是：

```text
src/data/projects.ts
  -> Projects.tsx 生成项目卡片
  -> 点击 /projects/frontman
  -> ProjectDetail 读取 projectId
  -> 找到 projects.ts 中的项目
  -> 加载 src/content/projects/Frontman.md
```

### 第四步：Markdown 是如何进入页面的

先阅读：

```text
src/pages/ProjectDetail.tsx
src/pages/KnowledgeCategory.tsx
src/pages/KnowledgeDetail.tsx
src/components/common/MarkdownRenderer.tsx
```

最关键的语法是 Vite 的：

```ts
import.meta.glob('../content/knowledge/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
```

它会在构建时扫描 Markdown 文件，并把文件内容作为字符串提供给 React。

知识分类页的流程：

```text
访问 /k8s
  -> K8s.tsx 传入 category="k8s"
  -> KnowledgeCategoryPage 扫描 k8s 目录
  -> 生成 Markdown 文件列表
  -> 点击某个文件
  -> 访问 /k8s/k8s
  -> KnowledgeDetail 根据 category 和 noteId 找文件
  -> MarkdownRenderer 渲染正文
```

### 第五步：Markdown 渲染细节

在 `MarkdownRenderer.tsx` 中重点看：

- `ReactMarkdown` 如何把 Markdown 转成 React 元素
- `remarkGfm` 如何支持表格、删除线等 GitHub Markdown 语法
- `rehypeSlug` 如何给标题生成锚点
- `highlight.js` 如何给 C、C++、Go 代码高亮
- `useState` 如何记录“代码已复制”
- `dangerouslySetInnerHTML` 为什么只用于经过高亮处理的代码片段

代码块建议写明语言：

````markdown
```go
func main() {
    println("hello")
}
```

```cpp
int main() {
    return 0;
}
```
````

## 4. 目录职责速查

```text
src/
├── main.tsx                         # React 入口
├── App.tsx                          # 集中注册所有路由
├── index.css                        # 全局样式和 Markdown 样式
├── App.css                          # 页面级样式入口，目前内容很少
├── types/index.ts                   # 共享类型
├── data/navigation.ts               # 导航和分类卡片数据
├── data/projects.ts                 # Projects 元数据
├── components/
│   ├── layout/                      # Layout、Header、Sidebar
│   ├── common/                      # 面包屑、空状态、搜索框、Markdown 渲染器
│   └── project/                     # 项目卡片和项目区块
├── pages/                           # 路由页面
├── content/projects/*.md            # 项目正文
└── content/knowledge/**/*.md       # 知识正文
```

## 5. 两种内容模型

### Projects：元数据 + Markdown

新增项目需要两部分：

```text
src/data/projects.ts
src/content/projects/payment-gateway.md
```

`projects.ts` 中的 `id` 必须和 Markdown 文件名一致，建议全部使用小写 slug：

```ts
{
  id: 'payment-gateway',
  name: 'Payment Gateway',
  category: 'Go service',
  description: '项目简介',
  tags: ['Go', 'HTTP'],
  path: '/projects/payment-gateway',
  status: 'active',
  updatedAt: 'Updated today',
  moduleCount: 0,
}
```

对应文件：

```text
src/content/projects/payment-gateway.md
```

Projects 页面会自动读取 `##` 标题生成右侧目录。

### Knowledge：目录 + Markdown

已经接入通用加载器的分类包括：

```text
src/content/knowledge/mq/
src/content/knowledge/algorithms/
src/content/knowledge/interview/
src/content/knowledge/k8s/
src/content/knowledge/linux/
```

例如：

```text
src/content/knowledge/k8s/deployment.md
```

访问：

```text
http://localhost:5173/#/k8s/deployment
```

当前 `Go`、`C++`、`Database`、`八股` 页面还是空状态页面。虽然仓库中存在一些直接放在 `src/content/knowledge/` 根目录的 Markdown 文件，但当前通用分类加载器不会把它们自动归入这些分类。后续学习扩展时，建议使用下面的目录形式：

```text
src/content/knowledge/go/*.md
src/content/knowledge/cpp/*.md
src/content/knowledge/database/*.md
src/content/knowledge/fundamentals/*.md
```

## 6. TypeScript 学习重点

在这个项目中优先掌握：

1. 基础类型：`string`、`number`、`boolean`、数组和对象。
2. `interface`：给 Props、项目对象和导航对象定义结构。
3. 联合类型：例如 `NavIcon` 和项目状态 `'active' | 'planned'`。
4. 泛型：例如 `import.meta.glob<string>()`。
5. 可选值：`projectId = ''`、`?.` 和 `??`。
6. 类型导入：`import type { Project } from '../types'`。
7. 函数参数类型和返回值类型。
8. `Record<string, T>`：建立字符串到固定类型的映射。

练习阅读这段代码：

```ts
const project = projects.find(
  (item) => item.id.toLowerCase() === normalizedProjectId,
)
```

你需要能解释：

- `project` 为什么可能是 `undefined`
- 为什么访问它之前要判断是否存在
- `toLowerCase()` 为什么能让 URL 和文件名大小写不敏感

## 7. React 学习重点

当前项目中常用的 React 能力：

- 函数组件：`function Home() {}`
- Props：`<KnowledgeCategoryPage category="k8s" />`
- `useParams`：读取 URL 动态参数
- `useState`：管理复制按钮状态、侧边栏状态和 Markdown 加载状态
- `useEffect`：项目详情页加载异步 Markdown
- `useMemo`：缓存目录数据
- 条件渲染：空状态、加载状态、错误状态
- 列表渲染：`items.map(...)`
- `key`：给列表项稳定的唯一标识

建议自己画出 `ProjectDetail` 的状态变化：

```text
进入页面
  -> isLoading = true
  -> 加载 Markdown
  -> 成功：显示正文
  -> 失败：显示错误
  -> 离开页面：停止更新旧页面
```

## 8. 动手练习路线

按照难度逐步完成：

### 练习 1：改一段页面文字

修改 `src/pages/Home.tsx` 的首页说明，观察 Vite 热更新。

### 练习 2：添加一篇已有分类笔记

创建：

```text
src/content/knowledge/k8s/deployment.md
```

写入：

````markdown
# Deployment

> Kubernetes Deployment 的复习笔记。

## 核心概念

## 常用命令

```bash
kubectl get deployment
```
````

访问 `#/k8s`，确认列表中出现新笔记。

### 练习 3：添加一个项目

同时修改：

```text
src/data/projects.ts
src/content/projects/你的项目名.md
```

确认项目卡片、详情页和右侧目录都能工作。

### 练习 4：接入 Go、C++、Database

参考 `K8s.tsx`、`Mq.tsx` 和 `KnowledgeCategory.tsx`：

1. 将 Markdown 移入对应子目录。
2. 让 `Go.tsx`、`Cpp.tsx`、`Database.tsx` 使用 `KnowledgeCategoryPage`。
3. 在 `App.tsx` 注册 `/:noteId` 详情路由。
4. 将 `KnowledgeCategory` 联合类型补充完整。
5. 检查导航和首页图标映射。

完成这个练习后，你就掌握了这个项目最重要的扩展模式。

### 练习 5：实现搜索

`SearchBar` 的输入框已经存在，但当前还没有连接到 Markdown 内容。你可以：

1. 扫描所有 Markdown 文件。
2. 提取文件名、标题和摘要。
3. 根据输入内容过滤结果。
4. 使用 `Link` 跳转到对应详情页。
5. 增加无搜索结果状态。

这个练习会综合使用 Props、状态、数组过滤、路由和 Markdown 数据。

## 9. 常见问题排查

### 页面 404

检查：

- `App.tsx` 是否注册了对应路由。
- URL 是否使用了 `#/`。
- 路由 slug 是否和 `Link` 使用的路径一致。

### Markdown 找不到

检查：

- 文件扩展名是否为 `.md`。
- 文件是否放在对应分类子目录中。
- 文件名是否和 URL 最后一段一致。
- 分类目录名是否使用小写 slug。

### 新文件没有出现

尝试：

1. 确认文件位于 `src` 目录内。
2. 保存文件后等待 Vite 更新。
3. 刷新页面。
4. 重启 `npm run dev`。
5. 运行 `npm run build` 查看 TypeScript 错误。

### 页面标题不对

每篇笔记建议使用真正的一级标题：

```markdown
# 这篇笔记的标题
```

章节使用二级标题：

```markdown
## 背景
## 核心概念
## 常见问题
```

不要把 Markdown 标题写进代码块中，否则它只是代码文本。

### 改了代码但页面没有变化

确认修改的是正在运行的项目目录：

```text
C:\Users\WK112\Desktop\typescript
```

然后查看终端是否仍然显示：

```text
Local: http://localhost:5173/
```

## 10. 建议的七天学习计划

### 第 1 天：工具和入口

学习 npm、Vite、`npm run dev`、`npm run build`，阅读 `main.tsx` 和 `App.tsx`。

### 第 2 天：React 页面

阅读 `Layout`、`Header`、`Sidebar`、`Home`，理解组件、Props 和 JSX。

### 第 3 天：TypeScript

阅读 `types`、`data` 和所有组件 Props，练习修改接口和联合类型。

### 第 4 天：路由

理解 `HashRouter`、`Routes`、`Route`、`Link`、`NavLink`、`useParams`。

### 第 5 天：Markdown 系统

阅读 `ProjectDetail`、`KnowledgeCategory`、`KnowledgeDetail` 和 `MarkdownRenderer`。

### 第 6 天：自己扩展

新增一篇 K8s 笔记，再新增一个项目，检查列表、详情和目录。

### 第 7 天：完成一个功能

选择接入 Go/C++/Database，或者实现搜索功能，并用 `npm run build` 验证。

## 11. 最终应该掌握什么

学完后，你应该可以独立回答：

- React 应用从哪里启动？
- 一个 URL 如何找到对应页面？
- `Layout` 和 `Outlet` 如何组合页面？
- 项目信息和项目正文分别存在哪里？
- `import.meta.glob` 如何读取 Markdown？
- 新增一篇笔记为什么不需要新增 React 页面？
- 为什么 `HashRouter` 的 URL 要带 `#`？
- 如何把一个空分类接入通用 Markdown 页面？
- 如何定位“页面 404”和“Markdown 找不到”？

最有效的方式是：每读完一个模块，就马上改一个小地方并运行页面验证。这个项目的代码量不大，完整走通一遍“路由 -> 页面 -> 数据 -> Markdown -> 渲染”，比单纯背 API 更容易真正掌握。
