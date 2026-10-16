import { create } from 'zustand'
import { sys } from '../api'

export interface NoteListItem {
  noteId: string
  title: string
  summary: string
  noteType: string
  noteSource: string
  favorite: boolean
  pinned: boolean
  later: boolean
  processed: boolean
  modifiedAt: number
  createdAt: number
  relativePath: string
  deleted: boolean
  searchSnippet?:string
  searchSource?:string
}

interface NotesState {
  items: NoteListItem[]
  total: number
  loading: boolean
  warning:string
  list: (opts: { filter?: Record<string, unknown>; query?: string;sort?:'modified'|'created'|'accessed'|'title';limit?:number;offset?:number;searchMode?:'fts'|'text' }) => Promise<void>
  setStatus: (noteId: string, patch: { favorite?: boolean; pinned?: boolean; later?: boolean }) => Promise<void>
  remove: (noteId: string) => Promise<void>
  restore: (noteId: string) => Promise<void>
}
let listRequest=0

export const useNotesStore = create<NotesState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  warning:'',

  list: async (opts) => {
    const request=++listRequest
    set({ loading: true })
    try {
      const r = await sys<{ items: NoteListItem[]; total: number;warning?:string }>('notes.list', opts)
      if(request===listRequest)set({ items: r.items, total: r.total,warning:r.warning??'' })
    } finally {
      if(request===listRequest)set({ loading: false })
    }
  },

  setStatus: async (noteId, patch) => {
    await sys('notes.set_status', { noteId, ...patch })
    set({
      items: get().items.map((n) => (n.noteId === noteId ? { ...n, ...patch } : n))
    })
  },

  remove: async (noteId) => {
    await sys('notes.delete', { noteId })
    set({ items: get().items.filter((n) => n.noteId !== noteId), total: Math.max(0,get().total-(get().items.some(n=>n.noteId===noteId)?1:0)) })
  },

  restore: async (noteId) => {
    await sys('notes.restore', { noteId })
    set({ items: get().items.filter((n) => n.noteId !== noteId),total:Math.max(0,get().total-(get().items.some(n=>n.noteId===noteId)?1:0)) })
  }
}))
