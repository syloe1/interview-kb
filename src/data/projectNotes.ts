// 项目正文的原始 Markdown。
// 和知识笔记不同，这里故意不写 eager: true —— 20 个项目文件加起来约 685KB，
// 全部塞进首屏包太重。每个文件各自打成一个 chunk，打开项目详情页时只下载那一个。
// 搜索需要全部正文，所以额外提供 loadAllProjectMarkdown()，在打开搜索时按需拉取。
export const projectMarkdownLoaders = import.meta.glob<string>(
  '../content/projects/*.md',
  {
    query: '?raw',
    import: 'default',
  }
);

export interface ProjectMarkdownSource {
  fileName: string;
  load: () => Promise<string>;
}

// 键是去掉扩展名的小写文件名（如 'reactornet'、'pr流程'），
// ProjectDetail 拿 project.fileName 或 project.id 去掉 .md 后来查
export const projectMarkdownSources: Record<string, ProjectMarkdownSource> =
  Object.fromEntries(
    Object.entries(projectMarkdownLoaders).map(([path, load]) => {
      const fileName = path.split('/').pop() ?? '';
      const key = fileName.replace(/\.md$/i, '').toLowerCase();
      return [key, { fileName, load }];
    })
  );

// 模块级 Promise 缓存：搜索框反复开关也只加载一次
let allProjectMarkdownPromise: Promise<Record<string, string>> | null = null;

/** 一次性加载所有项目正文，键和 projectMarkdownSources 一致 */
export function loadAllProjectMarkdown(): Promise<Record<string, string>> {
  if (!allProjectMarkdownPromise) {
    allProjectMarkdownPromise = Promise.all(
      Object.entries(projectMarkdownSources).map(async ([key, source]) => {
        return [key, await source.load()] as const;
      })
    ).then((entries) => Object.fromEntries(entries));
  }

  return allProjectMarkdownPromise;
}
