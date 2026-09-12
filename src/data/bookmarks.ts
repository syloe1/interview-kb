import type { BookmarkCategory } from '../types';

// ============================================================
// 常用链接收藏 —— 点击会在新标签页打开
// 使用方式：在对应分类的 links 数组中添加 { label, url } 即可
// ============================================================

export const bookmarkCategories: BookmarkCategory[] = [
  {
    title: '算法刷题',
    links: [
      { label: '如何科学刷题', url: 'https://leetcode.cn/discuss/post/3141566/ru-he-ke-xue-shua-ti-by-endlesscheng-q3yd/' },
      { label: '牛客网', url: 'https://www.nowcoder.com/' },
      { label: '牛客竞赛', url: 'https://ac.nowcoder.com/' },
      { label: 'Codeforce', url: 'https://codeforces.com/contests' }, 
      { label: 'Atcoder Table', url: 'https://kenkoooo.com/atcoder/#/table/' },
    ],
  },
  {
    title: '入门学习',
    links: [
      { label: 'Go 官方文档', url: 'https://go.dev/tour/welcome/1' },
      { label: 'Gin', url: 'https://gin-gonic.com/zh-cn/' },
      { label: 'Gorm', url: 'https://gorm.io/zh_CN/docs/index.html' },
      { label: 'b站博主', url: 'https://space.bilibili.com/291348098?spm_id_from=333.337.0.0' },
      { label: 'Gozero', url: 'https://go-zero.dev/zh-cn/guides/' },
      { label: 'Kratos', url: 'https://go-kratos.dev/zh-cn/docs/' },
    ],
  },
  {
    title: '公开课',
    links: [
      { label: '6.5840', url: 'https://pdos.csail.mit.edu/6.824/' },
      { label: '445', url: 'https://15445.courses.cs.cmu.edu/fall2025/' },
      { label: '生成式软件工程', url: 'https://www.bilibili.com/video/BV1pb8o6yE8f?spm_id_from=333.788.videopod.sections' },
      { label: '开源操作系统训练营', url: 'https://opencamp.cn/os2edu/camp/2026fall' },
    ],
  },
  {
    title: '有趣的',
    links: [
      { label: 'GitHub', url: 'https://github.com/' },
      { label: 'miniob', url: 'https://oceanbase.github.io/miniob/' },
      { label: 'arxiv', url: 'https://arxiv.org/list/cs.SE/recent' },
      { label: '极客兔兔', url: 'https://geektutu.com/books/7days-golang' },
    ],
  },
];
