import {useMemo} from 'react'
import {message} from 'antd'
import {renderMarkdown,type Citation} from '../markdown/render'
import {sys} from '../api'
import {useUiStore} from '../store/ui'
import {t} from '../i18n/zh'

export default function MarkdownContent({text,sources}:{text:string;sources?:Citation[]}) {
  const html=useMemo(()=>renderMarkdown(text,sources),[text,sources])
  return <div className="ww-markdown prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{__html:html}}
    onClick={event=>{
      const number=(event.target as HTMLElement).closest<HTMLElement>('[data-source]')?.dataset.source
      if(number){const source=sources?.find(s=>s.n===Number(number));if(source)void openCitation(source);return}
      const target=(event.target as HTMLElement).closest<HTMLElement>('[data-target]')?.dataset.target
      if(!target)return
      event.preventDefault()
      void sys<{items:{noteId:string;title:string}[]}>('notes.list',{query:target,limit:100}).then(async result=>{
        const note=result.items.find(n=>n.title===target)
        if(!note){void message.info(t('chat.linkMissing'));return}
        if(await useUiStore.getState().setView('notes'))useUiStore.getState().setActiveNote(note.noteId)
      }).catch(e=>void message.error(String(e)))
    }}/>
}

export async function openCitation(source:Citation){
 if(await useUiStore.getState().setView('notes')){
   useUiStore.getState().setActiveNote(source.noteId)
   useUiStore.setState({citationSnippet:source.snippet})
 }
}
