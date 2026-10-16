import {useEffect,useState} from 'react'
import {Button,Input,message} from 'antd'
import {sys} from '../api'
import {t} from '../i18n/zh'
const defaults={'shortcuts.focusChat':'CommandOrControl+Alt+Space','shortcuts.newNote':'CommandOrControl+Alt+N'}
export default function ShortcutSettings(){
 const [values,setValues]=useState(defaults),[loaded,setLoaded]=useState(false)
 useEffect(()=>{void sys<{settings:Record<string,string|null>}>('settings.get',{keys:Object.keys(defaults)}).then(r=>{setValues({...defaults,...Object.fromEntries(Object.entries(r.settings).filter(([,v])=>v))});setLoaded(true)}).catch(e=>message.error(String(e)))},[])
 const save=async(settings:typeof defaults)=>{try{await sys('settings.set',{settings});setValues(settings);message.success(t('settings.saved'))}catch(e){message.error(String(e))}}
 return <div className="space-y-4"><p>{t('shortcuts.hint')}</p>{(Object.keys(defaults) as (keyof typeof defaults)[]).map(key=><label key={key} className="block">{t(key)}<Input disabled={!loaded} value={values[key]} readOnly onKeyDown={e=>{
  e.preventDefault();if(['Control','Meta','Shift','Alt'].includes(e.key))return
  const code=e.code.replace(/^Key|^Digit/,'');const name=code==='Space'?'Space':e.key.length===1?e.key.toUpperCase():e.key.replace('Arrow','')
  const value=[e.metaKey?'Command':'',e.ctrlKey?'Control':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',name].filter(Boolean).join('+');void save({...values,[key]:value})
 }}/></label>)}<Button disabled={!loaded} onClick={()=>void save(defaults)}>{t('shortcuts.reset')}</Button></div>
}
