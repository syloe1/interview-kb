// 知识笔记的原始 Markdown，键是相对路径（如 '../content/knowledge/go/go.md'）
// 页面和导航数据共用这一份 glob，避免每个文件各写一遍 import.meta.glob
export const knowledgeMarkdown = import.meta.glob<string>(
  '../content/knowledge/**/*.md',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
);

// 知识笔记里引用的本地图片，键统一去掉开头的 '../'，例如
// 'content/knowledge/cpp/cc/image.png' -> Vite 打包后的图片 URL。
// Markdown 正文是原样字符串，不会自动处理 ![](xxx.png)，需要这份映射手动解析。
export const knowledgeImages: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../content/knowledge/**/*.{png,jpg,jpeg,gif,webp,svg}', {
      query: '?url',
      import: 'default',
      eager: true,
    })
  ).map(([path, url]) => [path.replace(/^\.\.\//, ''), url])
);

// 分类目录名 -> 页面显示名。分类页、详情页面包屑和搜索结果都用这一份，
// 键统一小写，和目录名的大小写无关。
export const categoryLabels: Record<string, string> = {
  go: 'Go',
  cpp: 'C++',
  database: 'Database',
  mq: 'MQ',
  algorithms: '算法题',
  interview: '面试',
  k8s: 'K8s',
  linux: 'Linux',
  thinking: '思考',
  python: 'Python',
  'qt-mcu': 'Qt / MCU',
};

// 统计某个分类目录下的笔记数量，返回首页卡片要显示的标签
// 目录为空时返回 Coming soon，Home 靠 includes('coming') 判断徽章样式
export function countNotes(category: string): string {
  // 统一转小写比较，兼容 Python/ 这种大写目录名
  const categoryPrefix = `../content/knowledge/${category}/`.toLowerCase();
  const count = Object.keys(knowledgeMarkdown).filter((path) =>
    path.toLowerCase().startsWith(categoryPrefix)
  ).length;

  return count === 0 ? 'Coming soon' : `${count} note${count > 1 ? 's' : ''}`;
}
