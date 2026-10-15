import { create } from 'zustand'
import { sys, useSysEvent } from '../api'
export interface ModelSelection{providerId:string;model:string}
export interface CatalogProvider{id:string;name:string;enabled:boolean;ready:boolean;status:string;models:{id:string;label:string;source:'discovered'|'configured'}[]}
let openVersion=0
let catalogVersion=0

export interface ChatMsg {
  msgId: string
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls: { id: string; function: { name: string; arguments: string } }[] | null
  toolResult: unknown
  createdAt: number
}

export interface ChatSummary {
  chatId: string
  title: string
  noteId: string | null
  modelRole: 'fast' | 'expert'
  selection:ModelSelection|null
  updatedAt: number
}

interface ChatState {
  draft: string
  setDraft: (draft: string) => void
  chats: ChatSummary[]
  activeChatId: string | null
  messages: ChatMsg[]
  error: string | null
  running:Record<string,boolean>
  streaming: boolean
  streamText: string
  toolEvents: { toolCallId?:string; name: string; phase: 'start' | 'done' | 'error'; output?: string; ts: number }[]
  newChat: () => void
  loadChats: () => Promise<void>
  openChat: (chatId: string | null, noteId?: string | null) => Promise<string|null>
  send: (text: string, expectedChatId?:string) => Promise<void>
  stop: () => void
  draftSelection:ModelSelection|null
  catalog:CatalogProvider[]
  catalogLoading:boolean
  catalogError:string|null
  loadCatalog:(refresh?:boolean)=>Promise<void>
  setModel:(selection:ModelSelection)=>Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  draftSelection:null,catalog:[],catalogLoading:false,catalogError:null,
  loadCatalog:async(refresh=false)=>{
    const version=++catalogVersion;set({catalogLoading:true,catalogError:null})
    try{const r=await sys<{items:CatalogProvider[]}>('provider.models',{refresh});if(version===catalogVersion)set({catalog:r.items,catalogLoading:false})}
    catch(e){if(version===catalogVersion)set({catalog:[],catalogLoading:false,catalogError:String(e)})}
  },
  draft:'',
  setDraft:(draft)=>set({draft}),
  chats: [],
  activeChatId: null,
  messages: [],
  streaming: false,
  error:null,
  running:{},
  streamText: '',
  toolEvents: [],

  newChat: () => {openVersion++;set({draft:'',activeChatId:null,messages:[],streaming:false,streamText:'',toolEvents:[],error:null})},

  loadChats: async () => {
    const r = await sys<{ items: ChatSummary[] }>('chat.list')
    set({ chats: r.items })
  },

  openChat: async (chatId, noteId) => {
    const version=++openVersion
    let id = chatId
    if (!id) {
      const r = await sys<{ chatId: string }>('chat.create', { noteId: noteId ?? undefined,selection:get().draftSelection??undefined })
      id = r.chatId
      await get().loadChats()
    }
    if(version!==openVersion)return null
    set({activeChatId:id,messages:[],streamText:'',toolEvents:[],error:null,streaming:!!get().running[id]})
    const m = await sys<{ messages: ChatMsg[] }>('chat.messages', { chatId: id })
    if(version!==openVersion)return null
    set({ activeChatId: id, messages: m.messages, streamText: '', toolEvents: [], error:null, streaming:!!get().running[id] })
    return id
  },

  send: async (text,expectedChatId) => {
    const { activeChatId } = get()
    if(expectedChatId&&expectedChatId!==activeChatId)throw new Error('会话已切换，消息未发送')
    if (!activeChatId || get().streaming) return
    const selection=get().chats.find(c=>c.chatId===activeChatId)?.selection
    if(!selection)throw new Error('请先选择供应商和模型')
    const previous=get().messages
    set({
      streaming: true,
      error:null,
      running:{...get().running,[activeChatId]:true},
      streamText: '',
      toolEvents: [],
      messages: [
        ...get().messages,
        { msgId: `local-${Date.now()}`, role: 'user', content: text, toolCalls: null, toolResult: null, createdAt: Date.now() }
      ]
    })
    try {
      await sys('chat.send', { chatId: activeChatId, text,selection })
      // 完成后拉全量（chat.done 事件里也拉）
    } catch (e) {
      set({ running:{...get().running,[activeChatId]:false},...(get().activeChatId===activeChatId?{streaming:false,messages:previous}:{} ) })
      throw e
    }
  },

  stop: () => {
    const { activeChatId } = get()
    if (activeChatId) void window.whywork.abort(activeChatId)
  },

  setModel: async (selection) => {
    const {activeChatId,streaming}=get()
    if(streaming)throw new Error('回复期间不能切换模型，请先停止')
    if(!activeChatId){set({draftSelection:selection});return}
    await sys('chat.set_model',{chatId:activeChatId,selection})
    set({chats:get().chats.map(c=>c.chatId===activeChatId?{...c,selection}:c)})
  }

}))

/** 订阅 chat.* 事件 → 更新 store（在 ChatPanel 挂载时调用一次） */
let wired=false
export function wireChatEvents(): void {
  if(wired)return;wired=true
  window.whywork.onEvent((e) => {
    const st = useChatStore.getState()
    const p = e.payload as { toolCallId?:string;aborted?:boolean;chatId?: string; delta?: string; name?: string; phase?: string; output?: string; error?: string }
    if(p.chatId && (e.topic==='chat.done'||e.topic==='chat.error'))useChatStore.setState({running:{...st.running,[p.chatId]:false}})
    if (p.chatId && p.chatId !== st.activeChatId) return
    switch (e.topic) {
      case 'chat.delta':
        useChatStore.setState({ streamText: useChatStore.getState().streamText + (p.delta ?? '') })
        break
      case 'chat.tool': {
        const events=[...useChatStore.getState().toolEvents]
        const at=events.findIndex(t=>p.toolCallId && t.toolCallId===p.toolCallId)
        const value={toolCallId:p.toolCallId,name:p.name??'',phase:(p.phase as 'start'|'done'|'error')??'start',output:p.output,ts:Date.now()}
        if(at>=0)events[at]=value;else events.push(value)
        useChatStore.setState({toolEvents:events})
        break
      }
      case 'chat.done':
      case 'chat.error': {
        const id = useChatStore.getState().activeChatId
        useChatStore.setState({ streaming: false,error:e.topic==='chat.error'?(p.aborted?'已停止':p.error??'对话失败'):null })
        if (id) {
          void sys<{ messages: ChatMsg[] }>('chat.messages', { chatId: id })
            .then((m) => {if(useChatStore.getState().activeChatId===id)useChatStore.setState({ messages: m.messages, streamText: '', toolEvents: [] })})
            .then(() => useChatStore.getState().loadChats())
            .catch(() => undefined)
        }
        break
      }
      default:
        break
    }
  })
}

void useSysEvent
