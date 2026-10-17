import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'katex/dist/katex.min.css'
import App from './App'
import './global.css'

const APP_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif"

function Root() {
  const [prefersDark,setPrefersDark] = useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(()=>{
    const query=window.matchMedia('(prefers-color-scheme: dark)')
    const update=()=>{
      setPrefersDark(query.matches)
      // dark 类挂到 <html>：antd 弹层（Modal/Select 下拉）挂在 body 下，必须能取到 CSS 变量
      document.documentElement.classList.toggle('dark', query.matches)
    }
    update()
    query.addEventListener('change',update)
    return()=>query.removeEventListener('change',update)
  },[])
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: prefersDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: prefersDark ? '#7b8aff' : '#5768ff',
          colorInfo: prefersDark ? '#7b8aff' : '#5768ff',
          borderRadius: 6,
          fontFamily: APP_FONT,
          colorBgLayout: prefersDark ? '#15171c' : '#f3f4f6',
          colorBgContainer: prefersDark ? '#20232b' : '#ffffff',
          colorBorder: prefersDark ? '#626d80' : '#e9ebef',
          colorBorderSecondary: prefersDark ? '#1e2333' : '#f0f0f4',
          colorText: prefersDark ? '#e8eaf2' : '#15141a',
          colorTextSecondary: prefersDark ? '#9ca3ad' : '#73777f',
          colorTextTertiary: prefersDark ? '#9aa3b3' : '#858d9c',
          colorTextPlaceholder: prefersDark ? '#9aa3b3' : '#73777f'
        }
      }}
    >
      <App />
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
