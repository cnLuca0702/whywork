import {z} from 'zod'
import {register} from './registry'
import {browserPage,prepareBrowser,closeBrowser} from '../services/browser'
export function registerBrowserDomain():void {
  register('browser',{
    prepare:{handler:async()=>{await prepareBrowser();return{ready:true}}},
    fetch:{schema:z.object({url:z.string().url()}),handler:async(p:{url:string})=>browserPage(p.url)},
    eval:{schema:z.object({url:z.string().url(),script:z.string().min(1).max(10000)}),handler:async(p:{url:string;script:string})=>browserPage(p.url,p.script)},
    close:{handler:async()=>{await closeBrowser();return{ok:true}}}
  })
}
