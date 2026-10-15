import {z} from 'zod'
import {register} from './registry'
import {startPairing,stopPairing} from '../services/pairing'
import {getDb} from '../db/client'
export function registerPairingDomain():void {
  register('pair',{
    start:{handler:async()=>startPairing()},
    stop:{handler:async()=>{await stopPairing();return{ok:true}}},
    devices:{handler:async()=>({items:getDb().prepare('SELECT device_id,name,platform,paired_at,last_seen FROM devices ORDER BY paired_at DESC').all()})},
    remove:{schema:z.object({id:z.string()}),handler:async(p:{id:string})=>{getDb().prepare('DELETE FROM devices WHERE device_id=?').run(p.id);return{ok:true}}}
  })
}
