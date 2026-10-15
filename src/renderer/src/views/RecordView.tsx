import RecordingControls from '../components/RecordingControls'

/** 录音工作区：竖栏「录音」入口的落地页（状态机 UI 复用 RecordingControls） */
export default function RecordView() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <h2 className="mb-1 text-xl">录音</h2>
      <p className="mb-4 text-xs text-[var(--ww-text-3)]">
        麦克风或系统音频录制，保存到本地知识库；转写与纪要需在设置中配置模型后进行。
      </p>
      <div className="max-w-xl rounded-lg border border-[var(--ww-border)] p-4">
        <RecordingControls />
      </div>
    </div>
  )
}
