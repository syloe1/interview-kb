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
- `xlsx`（SheetJS）：在浏览器里解析投递记录的 Excel 文件

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
/python                 -> Python
/python/:noteId         -> KnowledgeDetail
/applications           -> Applications
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

### 第六步：搜索

搜索是这个项目里唯一一处「不渲染只解析」Markdown 的地方，正好用来看清解析和渲染的分工。

按这个顺序读：

```text
src/lib/markdown.ts                       # 先看切分和锚点，后面全都依赖它
src/data/searchIndex.ts                   # 建索引 + 打分 + 截片段
src/components/common/SearchDialog.tsx    # 弹窗、键盘操作、懒加载时机
src/lib/highlight.ts                      # 命中高亮（rehype 插件）
```

重点理解：

- `unified().use(remarkParse).parse(markdown)` 拿到的是**语法树**，不是 HTML——在树上一层遍历就能同时服务目录、索引和渲染。
- 同一份 `github-slugger` 逻辑为什么必须被三处共用（目录、索引、`rehype-slug`），以及 `.trim()` 为什么不能加。
- 为什么「渲染完再操作 DOM 加 `<mark>`」会破坏 React 的节点，而改语法树不会。
- `useMemo` 为什么在这里不能无条件执行（弹窗关着时不该建索引）。

## 4. 目录职责速查

```text
src/
├── main.tsx                         # React 入口
├── App.tsx                          # 集中注册所有路由
├── index.css                        # 全局样式、Markdown 样式、搜索高亮样式
├── App.css                          # 页面级样式入口，目前内容很少
├── types/index.ts                   # 共享类型
├── lib/markdown.ts                  # Markdown 解析公共层：锚点、目录、按小节切分、标题/摘要提取
├── lib/highlight.ts                 # 把搜索命中的词包成 <mark> 的 rehype 插件
├── data/navigation.ts               # 导航和分类卡片数据
├── data/knowledgeNotes.ts           # 知识 Markdown 的 glob + countNotes() 计数 + 分类显示名
├── data/projectNotes.ts             # 项目 Markdown 的懒加载 glob（不 eager）
├── data/searchIndex.ts              # 搜索索引：把笔记切成章节 + 匹配打分
├── data/projects.ts                 # Projects 元数据
├── components/
│   ├── layout/                      # Layout、Header、Sidebar
│   ├── common/                      # 面包屑、空状态、SearchBar 触发器、SearchDialog 弹窗、Markdown 渲染器
│   └── project/                     # 项目卡片和项目区块
├── pages/                           # 路由页面
├── content/projects/*.md            # 项目正文
├── content/knowledge/<分类>/*.md    # 知识正文，一个子目录对应一个分类
└── content/knowledge/interview/找工作.xls   # 投递记录表格，由 /applications 页面读取
```

两个 `lib/` 文件是所有 Markdown 相关逻辑的唯一出处。**改锚点、目录或切分规则只改 `lib/markdown.ts`**，详情页和搜索索引都从这里取，改一处两边同步。

`content/knowledge/` 下的子目录名就是分类名，例如 `k8s/`、`python/`、`qt/`。目录名和 URL 段、`KnowledgeCategory` 联合类型三者要保持对应。

## 5. 三种内容模型

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
src/content/knowledge/go/
src/content/knowledge/cpp/
src/content/knowledge/database/
src/content/knowledge/mq/
src/content/knowledge/algorithms/
src/content/knowledge/interview/
src/content/knowledge/k8s/
src/content/knowledge/linux/
src/content/knowledge/thinking/
src/content/knowledge/python/
src/content/knowledge/qt/
```

例如：

```text
src/content/knowledge/k8s/deployment.md
```

访问：

```text
http://localhost:5173/#/k8s/deployment
```

`八股` 页面还是空状态页面。虽然仓库中存在一些直接放在 `src/content/knowledge/` 根目录的 Markdown 文件，但当前通用分类加载器不会把它们自动归入这些分类。后续学习扩展时，建议使用下面的目录形式：

```text
src/content/knowledge/fundamentals/*.md
```

#### 新增一个知识分类要改哪些文件

以 `qt` 为例，只加 Markdown 目录还不够，还要让路由认识它：

1. 建目录并放笔记：`src/content/knowledge/qt/qt.md`。
2. 新建页面 `src/pages/Qt.tsx`，把 `category="qt"` 传给 `KnowledgeCategoryPage`。
3. `src/App.tsx` 注册两条路由：`/qt` 和 `/qt/:noteId`。
4. `src/pages/KnowledgeCategory.tsx` 的 `KnowledgeCategory` 联合类型补上 `'qt'`。
5. `src/pages/KnowledgeDetail.tsx` 的 `categoryLabels` 补上显示名。
6. `src/data/navigation.ts` 加导航项；`src/pages/Home.tsx` 的 `iconByLabel` 也要加同名 key，否则首页卡片会渲染出空图标。

注意第 6 步容易漏：首页图标是按导航项的 `label` 查表的，联合类型不会拦住漏配的 key。

导航项的 `countLabel` 不用手写。[src/data/navigation.ts](src/data/navigation.ts) 里写的是 `countNotes('qt')`，这个函数在 [src/data/knowledgeNotes.ts](src/data/knowledgeNotes.ts)：扫一遍 `src/content/knowledge/` 下的 Markdown，数出该分类目录里有多少篇，返回 `3 notes` 这种标签；目录不存在或没有 `.md` 时返回 `Coming soon`。首页卡片就是靠标签里有没有 `coming` 这个词来决定徽章颜色的，所以**加完笔记不用再去改数字**。

### 投递情况：运行时解析 Excel

`投递情况` 页（`/applications`）是第三种内容模型：**不在构建期转换，而是浏览器里现读 Excel**。

```text
src/content/knowledge/interview/找工作.xls
  -> Applications.tsx 用 ?url 拿到文件地址
  -> fetch 下载成 ArrayBuffer
  -> 动态 import('xlsx') 解析
  -> 整理成 标题 / 表头 / 数据行
  -> 渲染成 HTML 表格
```

几个关键点：

- 文件用 `?url` 导入，Vite 会把它当静态资源原样复制进 `dist`。**这意味着任何访问站点的人都能下载这个 xls**，别往里放不想公开的东西。
- `import('xlsx')` 写成动态导入，SheetJS 会被单独打包成一个 chunk（约 500KB），只在打开这个页面时才加载，不拖慢首页。
- 读取时用 `sheet_to_json(..., { raw: false })`，取单元格的显示文本。用默认的 `raw: true` 的话，日期会变成 `46273` 这种 Excel 序列号。
- 表头是猜的：首行只有一个非空单元格就当合并标题（如「秋招」）；剩下第一行不含数字才当表头。所以「面经」表没有表头，整表都是数据。

### 搜索：在内容之上再建一层章节索引

页面右上角的搜索框和 <kbd>Ctrl/Cmd + K</kbd> 打开的是同一个弹窗（`SearchDialog`）。它不搜「篇」，搜「节」：

```text
按下 Ctrl+K
  -> Layout 的 window keydown 监听打开 SearchDialog
  -> 第一次打开才建索引：知识笔记同步建好，项目笔记异步拉取
  -> searchIndex.ts 把每篇笔记按 ## / ### 切成小节
  -> 输入关键词 -> 匹配 + 打分 -> 按相关度排序
  -> 点结果 -> 跳 /<分类>/<笔记>?section=<小节锚点>&q=<关键词>
  -> 详情页滚到该小节，并把命中的词高亮成 <mark>
```

几个关键设计：

- **为什么按小节切**：一篇 `cc.md` 有 56KB、`面试题.md` 有 151KB。只给到「哪一篇」等于让人再 Ctrl+F 一次。切到 h2+h3 之后，各节正文的中位长度从 169 字符降到 118 字符。
- **索引分两份，加载时机不同**：知识笔记是 `eager` 打包的，已在内存里；项目笔记 20 个文件共约 685KB，是懒加载的，打开搜索时才下载。所以搜索刚打开时可能只有知识笔记的结果，底部会显示「项目笔记加载中」。
- **懒到什么程度**：`getKnowledgeDocs()` 内部做了缓存，首次调用才真正解析 Markdown。`SearchDialog` 关着的时候 `useMemo` 直接返回空数组，所以从不搜索的访客不付这份开销。
- **跳转靠 URL 参数**：`?section=` 是锚点，`?q=` 是原关键词（详情页拿它做高亮）。两个都在 URL 上，所以搜索结果的链接可以直接分享、刷新还是那个位置。

配合跳转的三个地方，改的时候容易漏：

1. `Layout` 在 `location.search` 里发现 `section` 时会跳过「切页面滚回顶部」，否则详情页刚滚到位就被拽回页顶。
2. 详情页的滚动放在 `useEffect` 里，ProjectDetail 还要等 `markdown` 到位（正文是异步加载的）。
3. `index.css` 里给 `.markdown-content` 的标题加了 `scroll-margin-top: 5.5rem`，不然滚动目标会被 68px 的吸顶 Header 盖住。

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

### 练习 5：读懂并改造搜索

搜索已经实现了，把它当阅读材料而不是从零写：

1. 读 `data/searchIndex.ts` 的 `splitIntoSections`，搞清楚一节是怎么切出来的。
2. 读 `scoreDoc`，说清楚为什么搜「零拷贝」时 `面试题.md` 里的「零拷贝 Zero-Copy」排第一。
3. 读 `SearchDialog.tsx`，画出弹窗打开后知识索引和项目索引分别在哪一步加载。
4. 读 `lib/highlight.ts`，回答：为什么不用「渲染完再操作 DOM」的方式做高亮？

改造方向（任选其一）：

- **改排序**：让命中笔记标题的结果更靠前，或者给命中次数更多的小节加分。
- **加范围过滤**：在弹窗里加一排分类标签，点一下就只在某个分类里搜。
- **加键盘快捷键**：按 `/` 也能打开搜索框（注意别在输入框里误触发）。

这几步会串起 Props、状态、数组过滤、路由和 Markdown 数据。

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

分类目录名和分类名的大小写不一致时不会报错：`KnowledgeCategory` 比较路径前会统一转成小写，所以 `Python/` 目录能被 `/python` 路由找到。新目录还是建议用全小写，少一层心智负担。

### 新文件没有出现

尝试：

1. 确认文件位于 `src` 目录内。
2. 保存文件后等待 Vite 更新。
3. 刷新页面。
4. 重启 `npm run dev`。
5. 运行 `npm run build` 查看 TypeScript 错误。

### 分类里明明有笔记，首页卡片却显示 Coming soon

首页卡片的标签来自 `countNotes(分类名)`，参数写错就数不到东西：

- 拿 `src/data/navigation.ts` 里传的字符串，去和 `src/content/knowledge/` 下的目录名逐字对一遍，比如 `countNotes('interview')` 对应 `interview/`。
- 目录名大小写不影响：`countNotes` 内部会转成小写再比，所以 `Python/` 能被 `countNotes('python')` 数到。但两边都写小写最省心。
- 分类页（`/interview`）能列出笔记、首页却显示 `Coming soon` 时，基本就是这个参数对不上——因为分类页用的是 `KnowledgeCategory` 联合类型，写错了 TypeScript 会直接报错，首页这边只是个字符串。

### 投递情况页面的表格不对

`/applications` 的表头和日期是**猜出来**的，改 Excel 后先看这两条：

- **某一行被当成了表头**：判断规则是「首行不含数字就当表头」。如果表头里带数字（比如「2024 届」），或者数据行一个数字都没有，就会猜错。改 `Applications.tsx` 里的 `hasHeader` 判断。
- **日期显示成 46273**：说明读到了原始序列号。确认 `sheet_to_json` 带着 `raw: false`。
- **多出一行「秋招」这样的标题**：这是故意保留的合并单元格标题，不是 bug。
- **表格没更新**：页面有模块级缓存，改完 xls 要刷新页面（`sheetPromise` 只在首次进入时创建）。

### 搜索结果点进去没定位到小节

`?section=` 传的是**小节锚点**，它必须和页面上 `rehype-slug` 生成的 `id` 逐字相同。排查顺序：

- **看看 URL**。跳过去的地址应该是 `#/go/go?section=零拷贝&q=零拷贝`。没有 `?section=` 说明这条结果是「开篇小节」（`id` 为空），本来就该停在笔记开头。
- **确认元素存在**。浏览器控制台执行 `document.getElementById('零拷贝')`，返回 `null` 就是锚点对不上。
- **别自己写 slug**。锚点只能由 `lib/markdown.ts` 的 `getTableOfContents` / `splitIntoSections` 产出，它们和渲染用的是同一套 `github-slugger`。手写或用别的库算都会漂。
- **被 Header 盖住**？那只说明 `scroll-margin-top` 丢了，元素其实滚过去了。

### 搜索跳转的位置差了开头一个字符 / 锚点带前导 `-`

`github-slugger` **不裁剪首尾空格**，会把空格也转成 `-`。`qt.md` 里有一行标题是：

```markdown
## ` <QTextStream>`：Qt 的文本流类……
```

标题正文以空格开头，所以页面上的 id 是 `-qtextstreamqt-...`，带一个前导横线。

因此算锚点时必须用 `toString(node)` 的**原串**，`.trim()` 过的字符串只能用来判断空标题和显示：

```ts
const raw = toString(node);      // 拿去算锚点
const label = raw.trim();        // 拿去显示、判空
```

### 改了高亮插件后，从搜索结果点进详情页直接白屏

报错长这样：

```text
TypeError: Cannot read properties of undefined (reading 'children')
```

八成是把 **transformer 当成 plugin 交出去了**。unified 的插件有两层：

```ts
// 正确：attacher 先被调用一次（拿到 options），它返回的函数才是 transformer
function rehypePlugin(options) {
  return (tree) => { /* 在这里改语法树 */ };
}

// 错误：直接返回 (tree) => {...}，unified 会当作 attacher 调用它，
// 参数是 options 不是语法树，tree 就是 undefined
```

`lib/highlight.ts` 的 `createHighlightPlugin` 就是标准写法，对照着改。注意 **`npm run build` 拦不住这个错**——unified 的插件类型很宽松，只能靠真的跑一遍页面才会暴露。

### 右侧「On this page」点一下跳到 404

目录项**必须是 `<button onClick={...}>`，不能是 `<a href="#某个id">`**。

这个站用 `HashRouter`，URL 里的 `#` 是路由本身（`#/go/go`）。点 `href="#零拷贝"` 会把整个 hash 换成 `零拷贝`，路由解析成 `/零拷贝`，直接掉进 `NotFound`。`KnowledgeDetail` 和 `ProjectDetail` 的目录都是按钮，照抄就行。

Markdown 正文里手写的 `[文字](#锚点)` 也有同样的问题，写笔记时避开。

### 某篇项目笔记搜不到

项目笔记要能搜到，得同时满足两条：

- 文件在 `src/content/projects/` 下，且扩展名是 `.md`；
- 文件在 `src/data/projects.ts` 里有对应条目——匹配规则是「`project.fileName`，没有就用 `project.id + '.md'`」，两边都转小写后比对。

只放了 Markdown、没在 `projects.ts` 注册的文件没有路由，搜出来也点不进去，所以索引层会直接跳过（`kratos.md` 目前就是这种孤儿文件）。

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

### 第 7 天：读透搜索

沿着「解析 -> 索引 -> 弹窗 -> 跳转定位 -> 高亮」完整走一遍搜索链路（见第 3 节的「第六步」），然后按练习 5 挑一个方向改造，并用 `npm run build` 验证。

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
