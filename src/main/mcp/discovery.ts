import type {McpToolInfo} from './manager'
export function rankTools(tools:McpToolInfo[],query:string,serverIds?:string[],limit=20){
 const q=query.toLowerCase(),score=(t:McpToolInfo)=>[t.name,t.originalName].some(n=>n.toLowerCase()===q)?3:[t.name,t.originalName].some(n=>n.toLowerCase().includes(q))?2:t.description.toLowerCase().includes(q)?1:0
 return tools.filter(t=>(!serverIds?.length||serverIds.includes(t.serverId))&&score(t)>0).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name)).slice(0,limit).map(({inputSchema:_schema,...preview})=>({...preview,fullName:preview.name,name:preview.originalName}))
}
