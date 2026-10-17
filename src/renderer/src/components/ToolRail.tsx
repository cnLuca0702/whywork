import { Tooltip } from 'antd'
import {
  MessageOutlined,
  AudioOutlined,
  InboxOutlined,
  TableOutlined,
  CalendarOutlined,
  MailOutlined,
  GlobalOutlined,
  DeploymentUnitOutlined
} from '@ant-design/icons'
import { useUiStore } from '../store/ui'

/** 最右侧工具竖栏：图形化入口 + 悬浮文字提示（用户要求） */

interface RailItem {
  key: string
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  divider?: boolean
}

export default function ToolRail() {
  const view = useUiStore((s) => s.view)
  const toolsTab = useUiStore((s) => s.toolsTab)
  const setView = useUiStore((s) => s.setView)
  const setToolsTab = useUiStore((s) => s.setToolsTab)

  const items: RailItem[] = [
    { key: 'chat', icon: <MessageOutlined />, label: 'AI 问答', active: view === 'chat', onClick: () => void setView('chat') },
    { key: 'record', icon: <AudioOutlined />, label: '录音', active: view === 'record', onClick: () => void setView('record') },
    { key: 'capture', icon: <InboxOutlined />, label: '采集', active: view === 'tools' && toolsTab === 'capture', onClick: () => void setToolsTab('capture') },
    { key: 'office', icon: <TableOutlined />, label: '表格与文档', active: view === 'tools' && toolsTab === 'office', onClick: () => void setToolsTab('office') },
    { key: 'calendar', icon: <CalendarOutlined />, label: '日历', active: view === 'tools' && toolsTab === 'calendar', onClick: () => void setToolsTab('calendar'), divider: true },
    { key: 'mail', icon: <MailOutlined />, label: '邮件', active: view === 'tools' && toolsTab === 'mail', onClick: () => void setToolsTab('mail') },
    { key: 'browser', icon: <GlobalOutlined />, label: '网页浏览', active: view === 'tools' && toolsTab === 'browser', onClick: () => void setToolsTab('browser') },
    { key: 'pair', icon: <DeploymentUnitOutlined />, label: '设备绑定', active: view === 'tools' && toolsTab === 'pair', onClick: () => void setToolsTab('pair') }
  ]

  return (
    <nav className="ww-rail" aria-label="工具竖栏">
      {items.map((it) => (
        <div key={it.key}>
          {it.divider && <div className="ww-rail-sep" />}
          <Tooltip title={it.label} placement="left" mouseEnterDelay={0.15}>
            <button
              className={`ww-rail-btn${it.active ? ' is-active' : ''}`}
              aria-label={it.label}
              onClick={it.onClick}
            >
              {it.icon}
            </button>
          </Tooltip>
        </div>
      ))}
    </nav>
  )
}
