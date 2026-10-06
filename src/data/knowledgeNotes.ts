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
