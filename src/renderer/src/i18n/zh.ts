/** 中文字典（DEVELOPMENT.md §10：组件禁止硬编码文案） */
export const zh = {
  'app.name': 'WhyWork',
  'app.tagline': '本地优先的 AI 知识库',
  'nav.all': '全部笔记',
  'nav.favorite': '收藏',
  'nav.pinned': '置顶',
  'nav.later': '稍后读',
  'nav.unprocessed': '未处理',
  'nav.collections': '集合',
  'nav.settings': '设置',
  'notes.searchPlaceholder': '搜索笔记…（全文检索）',
  'notes.empty': '还没有笔记\n拖入 Markdown / PDF / Word 文件即可导入',
  'notes.count': '{n} 条笔记',
  'chat.title': 'AI 助手',
  'chat.placeholder': '输入消息，Enter 发送…',
  'chat.disabled': '对话功能将在 M3 里程碑接入',
  'chat.modelBadge': '未配置模型',
  'settings.workspace': '工作区',
  'settings.workspacePath': '笔记存储位置',
  'settings.change': '更改…',
  'settings.changed': '已切换工作区',
  'settings.about': '关于',
  'settings.aboutDesc': 'WhyWork —— 本地优先的 AI 知识库（remio 复刻 · 纯本地 · BYOK）',
  'status.ready': '就绪',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.loading': '加载中…',
  'common.error': '出错了'
} as const

export type I18nKey = keyof typeof zh

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let s: string = zh[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}
