import RecordingControls from '../components/RecordingControls'

/** 录音工作区：竖栏「录音」入口的落地页（状态机 UI 复用 RecordingControls）；面板头已有标题，不再重复（U-10） */
export default function RecordView() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <p className="ww-page-desc mb-4">
        麦克风或系统音频录制，保存到本地知识库；转写与纪要需在设置中配置模型后进行。
      </p>
      <div className="max-w-xl rounded-lg border border-[var(--ww-border)] p-4">
        <RecordingControls />
      </div>
    </div>
  )
}
