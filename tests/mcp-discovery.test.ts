import {expect,it} from 'vitest'
import {rankTools} from '../src/main/mcp/discovery'
const tool=(name:string,description='',serverId='a')=>({name,originalName:name,description,serverId,serverName:serverId,inputSchema:{type:'object',properties:{secret:{type:'string'}}}})
it('ranks exact names before substrings and descriptions without leaking schemas',()=>{
 const result=rankTools([tool('other','find note'),tool('notes'),tool('note')],'note')
 expect(result.map(t=>t.name)).toEqual(['note','notes','other']);expect(result.every(t=>!('inputSchema'in t))).toBe(true)
 expect(rankTools([tool('note','','a'),tool('note','','b')],'note',['b'],1).map(t=>t.serverId)).toEqual(['b'])
})
