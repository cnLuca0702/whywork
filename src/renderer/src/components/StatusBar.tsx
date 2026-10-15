import { useEffect, useState } from 'react'
import { t } from '../i18n/zh'
import { sys } from '../api'

interface PingResult {
  pong: boolean
  version: string
}

export default function StatusBar() {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    sys<PingResult>('app.ping')
      .then((r) => setVersion(r.version))
      .catch(() => setVersion('?'))
  }, [])

  return (
    <div className="ww-status">
      <span>{t('status.ready')}</span>
      {version && <span>v{version}</span>}
      <span className="ml-auto">BYOK · 本地运行</span>
    </div>
  )
}
