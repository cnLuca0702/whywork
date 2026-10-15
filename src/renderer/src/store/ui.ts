import { create } from 'zustand'

export type View = 'chat' | 'notes' | 'settings' | 'tools'
export type NoteFilter = 'all' | 'favorite' | 'pinned' | 'later' | 'unprocessed' | 'trash'
let leaveViewGuard: (()=>Promise<boolean>) | null = null
let navigationPending = false
export function registerViewGuard(guard:()=>Promise<boolean>):()=>void {
  leaveViewGuard=guard
  return()=>{if(leaveViewGuard===guard)leaveViewGuard=null}
}

interface UiState {
  view: View
  filter: NoteFilter
  collectionId: string | null
  searchMode:'fts'|'text'
  setSearchMode:(mode:'fts'|'text')=>void
  search: string
  activeNoteId: string | null
  setView: (v: View) => Promise<boolean>
  toolsTab: string
  setToolsTab: (tab: string) => Promise<void>
  setFilter: (f: NoteFilter) => void
  setCollection: (id: string | null) => void
  setSearch: (s: string) => void
  setActiveNote: (id: string | null) => void
}

export const useUiStore = create<UiState>((set,get) => ({
  view: 'notes',
  filter: 'all',
  collectionId: null,
  search: '',
  searchMode:'text',
  setSearchMode:searchMode=>set({searchMode}),
  activeNoteId: null,
  toolsTab: 'capture',
  setToolsTab: async (toolsTab) => { if (await get().setView('tools')) set({toolsTab}) },
  setView: async (view) => {
    if(view===get().view)return true
    if(navigationPending)return false
    if(!leaveViewGuard){set({view,activeNoteId:null});return true}
    navigationPending=true
    try { const ok=await leaveViewGuard(); if(ok)set({view,activeNoteId:null}); return ok }
    finally {navigationPending=false}
  },
  setFilter: (filter) => set({ filter, collectionId: null, activeNoteId: null,search:'' }),
  setCollection: (collectionId) => set({ collectionId, filter: 'all', activeNoteId: null,search:'' }),
  setSearch: (search) => set({ search }),
  setActiveNote: (activeNoteId) => set({ activeNoteId })
}))
