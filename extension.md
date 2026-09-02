# Interview-KB 扩展指南

这份文档说明如何在当前项目中增加新的知识分类、项目和 Markdown 笔记。项目是一个静态的 React + TypeScript + Vite 应用，内容和页面一起放在代码仓库中，不需要数据库或后端服务。

## 0. 本地运行

在项目根目录执行：

```bash
npm install       # 第一次使用，或 package.json 发生变化后
npm run dev
```

然后访问 [http://localhost:5173/](http://localhost:5173/)。

项目使用 `HashRouter`，所以首页以外的地址要带 `#`：

```text
首页：        http://localhost:5173/
Projects：   http://localhost:5173/#/projects
ReactorNet：  http://localhost:5173/#/projects/reactornet
MQ：          http://localhost:5173/#/mq
```

修改 `src` 文件后，Vite 会自动刷新页面。提交或发布前运行：

```bash
npm run build
```

构建成功会生成 `dist/`，也可以用 `npm run preview` 在本地预览生产构建。

## 1. 先了解目录职责

```text
src/
├── App.tsx                       # 所有 URL 路由
├── data/navigation.ts            # 左侧导航和首页分类卡片的数据
├── data/projects.ts              # Projects 列表的元数据
├── types/index.ts                # 共享 TypeScript 类型
├── pages/                        # 路由对应的页面
├── components/layout/Sidebar.tsx # 左侧导航和图标映射
├── components/layout/Header.tsx  # 顶部栏
├── content/projects/*.md         # 项目 Markdown 正文
└── content/knowledge/**/*.md    # MQ、算法题、面试、K8s、Linux Markdown 正文
```

当前有两种内容形态：

1. **Projects** 已经支持“元数据 + Markdown 详情页”的完整流程。
2. **Go、C++、Database、八股** 目前仍是 `CategoryPage` 空状态页。
3. **MQ、算法题、面试、K8s、Linux** 已接入通用 Markdown 分类页。只要把 `.md` 文件放进对应目录，分类页会自动列出文件，详情页会自动渲染正文。

## 2. 新增一个分类（先做出可访问的分类首页）

下面以新增 `MQ` 为例。`算法题`、`面试`、`K8s` 和 `Linux` 的做法完全相同。

### 2.1 添加导航数据

编辑 `src/data/navigation.ts`，在数组末尾加入：

```ts
{ label: 'MQ', path: '/mq', description: '消息队列、Kafka、RabbitMQ 等知识和面试问题', icon: 'layers', countLabel: 'Coming soon' },
```

建议规则：

- `label` 是用户看到的名称，可以是中文或英文。
- `path` 使用短的英文小写 slug，例如 `/mq`、`/algorithms`、`/interview`。不要在 path 中使用空格。
- `icon` 先复用已有值（`folder`、`terminal`、`braces`、`database`、`layers`）最省事。
- `countLabel` 会显示在首页卡片上；目前侧边栏只给 Projects 显示数量。

### 2.2 同步首页图标映射

`src/pages/Home.tsx` 现在是按 **label** 查图标，而不是按 `navigationItems` 中的 `icon` 字段查图标。因此新增导航项后，必须在 `iconByLabel` 中加入同名 key，否则首页渲染卡片时会找不到图标：

```ts
const iconByLabel = {
  Projects: LibraryBig,
  Go: Clock3,
  'C++': Clock3,
  Database: Clock3,
  八股: Clock3,
  MQ: Clock3,
  K8s: Clock3,
  Linux: Clock3,
}
```

如果之后经常增加分类，建议把这里改成按 `item.icon` 映射。这样每次新增分类就不必再维护一个按文字匹配的对象；改造时要同时参考 `Sidebar.tsx` 中已有的 `iconMap`。

首页的分类数量现在会从 `navigationItems.length` 自动计算；第一个 Projects 卡片仍通过 `index === 0` 标记为 active。

### 2.3 创建分类页面文件

新建 `src/pages/Mq.tsx`：

```tsx
import { KnowledgeCategoryPage } from './KnowledgeCategory'

export function Mq() {
  return (
    <KnowledgeCategoryPage
      category="mq"
      title="MQ"
      description="消息队列、Kafka、RabbitMQ 等知识和面试问题"
      icon="layers"
    />
  )
}
```

`KnowledgeCategoryPage` 会扫描 `src/content/knowledge/mq/`，列出其中的 Markdown 文件。目录为空时才会显示 `No notes yet.` 空状态。

### 2.4 注册路由

编辑 `src/App.tsx`：

```tsx
import { Mq } from './pages/Mq'
```

然后在 `<Route element={<Layout />}>` 内加入：

```tsx
<Route path="/mq" element={<Mq />} />
```

导航、首页卡片和路由三处都完成后，访问 `http://localhost:5173/#/mq` 就能看到新分类。

### 2.5 如果要使用新图标

当前 `src/types/index.ts` 的 `NavIcon` 只有 5 个值。如果想使用 Lucide 中尚未接入的图标，需要同时修改 3 处：

1. 在 `NavIcon` 联合类型中加入一个字符串，例如 `'message'`。
2. 在 `src/components/layout/Sidebar.tsx` 中导入对应的 Lucide 图标，并加入 `iconMap`。
3. 在 `src/pages/Home.tsx` 中给新增分类加入 `iconByLabel` 映射（或完成上面提到的按 `item.icon` 映射改造）。

只修改导航数据而不修改类型或图标映射，会在 `npm run build` 时出现 TypeScript 错误，或在首页运行时出现空图标。

## 3. 一次添加 MQ、算法题、面试、K8s、Linux

### 3.1 `src/data/navigation.ts`

```ts
export const navigationItems: NavigationItem[] = [
  // 原有项目保持不动……
  { label: 'MQ', path: '/mq', description: '消息队列、Kafka、RabbitMQ 等', icon: 'layers', countLabel: 'Coming soon' },
  { label: '算法题', path: '/algorithms', description: '数据结构、算法题和解题思路', icon: 'braces', countLabel: 'Coming soon' },
  { label: '面试', path: '/interview', description: '面试流程、项目介绍和常见问题', icon: 'layers', countLabel: 'Coming soon' },
]
```

### 3.2 页面文件

这三个页面文件已经创建好，后续不需要为每一篇笔记再创建 React 页面。它们都使用通用的 `KnowledgeCategoryPage`。例如：

```tsx
// src/pages/Algorithm.tsx
import { KnowledgeCategoryPage } from './KnowledgeCategory'

export function Algorithm() {
  return <KnowledgeCategoryPage category="algorithms" title="算法题" description="数据结构、算法题和解题思路" icon="braces" />
}
```

`Mq.tsx` 和 `Interview.tsx` 的完整代码也已经放在 `src/pages/` 中。

### 3.3 `src/App.tsx`

```tsx
import { Algorithm } from './pages/Algorithm'
import { Interview } from './pages/Interview'
import { Mq } from './pages/Mq'

// <Routes> 内
<Route path="/mq" element={<Mq />} />
<Route path="/algorithms" element={<Algorithm />} />
<Route path="/interview" element={<Interview />} />
```

最后不要忘记把 `MQ`、`算法题`、`面试`、`K8s`、`Linux` 加到 `Home.tsx` 的 `iconByLabel`。首页的分类数量现在会从 `navigationItems.length` 自动计算。

## 4. 给分类添加真正可浏览的笔记

### 4.1 当前通用笔记结构

MQ、算法题、面试、K8s、Linux 已经使用通用的分类列表页和详情页，不需要为每一篇笔记新增 React 文件：

```text
src/
├── content/knowledge/mq/*.md         # MQ 正文
├── content/knowledge/algorithms/*.md # 算法题正文
├── content/knowledge/interview/*.md  # 面试正文
├── content/knowledge/k8s/*.md        # K8s 正文
├── content/knowledge/linux/*.md      # Linux 正文
├── pages/KnowledgeCategory.tsx       # 通用分类列表页
└── pages/KnowledgeDetail.tsx         # 通用 Markdown 详情页
```

当前实现直接从 Markdown 文件读取标题和摘要，不需要单独维护元数据：

```text
src/content/knowledge/mq/kafka-basics.md
```

文件名会成为 URL 中的 `noteId`，Markdown 第一行的 `# 标题` 会显示为笔记标题；正文中第一段普通文本会作为分类列表的摘要。

建议的 URL 是：

```text
#/mq                         # 分类列表
#/mq/kafka-basics            # 一篇笔记
#/algorithms/two-sum         # 一道算法题
#/interview/project-intro    # 一篇面试笔记
```

通用详情页已经复用了 Projects 中的能力：`react-markdown`、`remark-gfm`、`rehype-slug`、代码高亮、复制按钮和二级标题目录。它通过 glob 扫描 `src/content/knowledge/**/*.md`，再根据 `category/noteId` 找到对应文件。

已注册的路由形态如下：

```tsx
<Route path="/mq" element={<Mq />} />
<Route path="/mq/:noteId" element={<KnowledgeDetail />} />
<Route path="/algorithms" element={<Algorithm />} />
<Route path="/algorithms/:noteId" element={<KnowledgeDetail />} />
<Route path="/interview" element={<Interview />} />
<Route path="/interview/:noteId" element={<KnowledgeDetail />} />
```

新增笔记时只需新增 Markdown 文件，Vite 会在开发环境自动刷新，分类列表会立即出现新入口。

### 4.3 Markdown 笔记建议

每篇笔记使用一个稳定的英文文件名，例如 `kafka-delivery.md`、`two-sum.md`、`project-intro.md`。正文可以采用统一模板：

````markdown
# Kafka 消息投递

> 一句话说明这篇笔记解决什么问题。

## 背景

## 核心概念

## 常见面试问题

## 代码或配置示例

```go
// code here
```

## 易错点
````

Projects 的目录会自动把 `##` 二级标题加入右侧目录；通用笔记页沿用同一实现即可。代码块写明语言名可以启用语法高亮，目前项目已注册 C、C++ 和 Go（以及 `c++`、`cc`、`hpp`、`golang` 别名）。

## 5. 新增一个 Project

Projects 不需要为每个项目新增 React 页面，通用的 `/projects/:projectId` 路由会处理详情页。

1. 编辑 `src/data/projects.ts`，增加一个完整的 `Project` 对象。
2. `id` 使用小写 slug，例如 `payment-gateway`。
3. `path` 写成 `/projects/payment-gateway`。
4. 在 `src/content/projects/` 创建同名 Markdown 文件，例如 `payment-gateway.md`。`id` 和文件名会忽略大小写匹配，但建议直接使用相同的小写文件名。
5. 运行 `npm run build`，再访问 `http://localhost:5173/#/projects/payment-gateway`。

示例：

```ts
{
  id: 'payment-gateway',
  name: 'Payment Gateway',
  category: 'Go service',
  description: 'A short description shown on the project card.',
  tags: ['Go', 'HTTP', 'Redis'],
  path: '/projects/payment-gateway',
  status: 'active',
  updatedAt: 'Updated today',
  moduleCount: 4,
}
```

如果元数据已加入但 Markdown 文件不存在，详情页会显示 `No Markdown file matches the project id...`；反过来也一样，只有 Markdown 没有元数据时不会生成项目卡片。

## 6. 完成后的检查清单

- [ ] `src/data/navigation.ts` 有新的导航项，`path` 唯一。
- [ ] `src/pages/Home.tsx` 的 `iconByLabel` 有对应 key，首页统计和 active 状态没有过期。
- [ ] 新页面已放在 `src/pages/`，并在 `src/App.tsx` 注册路由。
- [ ] 如果使用新图标，`NavIcon`、Sidebar 图标映射和首页映射都已同步。
- [ ] 如果新增笔记，元数据中的 `id`、`category`、`fileName` 与实际文件一致。
- [ ] `npm run build` 成功，没有 TypeScript 错误。
- [ ] 浏览器中检查首页、侧边栏、分类页、笔记详情页，并手动刷新一个带 `#` 的深层 URL。

## 7. 常见问题

### 点击导航后出现 404

通常是只改了 `navigation.ts`，没有在 `App.tsx` 添加 `<Route>`，或者 `path` 拼写不一致。

### 首页白屏或控制台提示组件不是有效元素

通常是新增了导航项，却没有在 `Home.tsx` 的 `iconByLabel` 添加同名 label。

### 新增 Markdown 后页面仍然是空状态

请确认文件放在 `src/content/knowledge/mq/`、`src/content/knowledge/algorithms/`、`src/content/knowledge/interview/`、`src/content/knowledge/k8s/` 或 `src/content/knowledge/linux/` 之一，并且扩展名是 `.md`。Go、C++、Database、八股 目前还是空状态页，尚未接入这套通用加载器。

### 发布到 GitHub Pages 后刷新子页面失败

不要把 `HashRouter` 改成普通 `BrowserRouter`，并使用带 `#` 的地址。当前 Vite `base` 和路由配置就是为 GitHub Pages 准备的。

### TypeScript 报 `NavIcon` 类型错误

检查 `src/types/index.ts` 中的联合类型，以及 `Sidebar.tsx` 的 `iconMap` 是否同时包含了新值。
