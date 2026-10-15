/** 供应商统一接口（DEVELOPMENT.md §8.1） */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; argsJson: string }
  | { type: 'usage'; input: number; output: number }

export interface StreamRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  signal: AbortSignal
}

export interface ChatProvider {
  id: string
  name: string
  listModels(): Promise<string[]>
  modelCatalog?(): Promise<{id:string;label:string}[]>
  stream(req: StreamRequest, emit: (e: StreamEvent) => void): Promise<{ finishReason: 'stop' | 'tool_use' | 'length' }>
}

export class ProviderError extends Error {
  code: 'PROVIDER_ERROR' | 'NETWORK_ERROR' | 'NO_PROVIDER' | 'ABORTED'
  constructor(code: ProviderError['code'], message: string) {
    super(message)
    this.code = code
  }
}
