import { Menu, app, type MenuItemConstructorOptions } from 'electron'

/** 应用菜单（精简中文化）：
 *  ⚠ macOS 的 ⌘C/⌘V/⌘X/⌘A/⌘Z 等系统快捷键由菜单角色承载——
 *  绝不能 setApplicationMenu(null)，否则全局无法键盘复制粘贴（已踩坑，见记忆 whywork-electron-menu-clipboard）。 */

export function setupAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` }
      ]
    })
  }

  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ]
  })

  template.push({
    label: '窗口',
    submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 输入区右键菜单（Electron 默认无原生右键菜单） */
export function popupEditContextMenu(params: Electron.ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = []
  if (params.isEditable) {
    if (params.editFlags.canCut) items.push({ role: 'cut', label: '剪切' })
    if (params.editFlags.canCopy) items.push({ role: 'copy', label: '复制' })
    if (params.editFlags.canPaste) items.push({ role: 'paste', label: '粘贴' })
    if (params.editFlags.canSelectAll) items.push({ role: 'selectAll', label: '全选' })
  } else if (params.selectionText) {
    items.push({ role: 'copy', label: '复制' })
  }
  if (items.length > 0) Menu.buildFromTemplate(items).popup()
}

/** 自检用：确认剪贴板相关角色存在（防止未来再次误删菜单） */
export function menuHasClipboardRoles(): boolean {
  const menu = Menu.getApplicationMenu()
  if (!menu) return false
  const labels = new Set<string>()
  const walk = (items: Electron.MenuItem[]): void => {
    for (const it of items) {
      if (it.label) labels.add(it.label)
      if (it.submenu) walk(it.submenu.items)
    }
  }
  walk(menu.items)
  return labels.has('粘贴') && labels.has('复制') && labels.has('剪切') && labels.has('全选')
}
