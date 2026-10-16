export interface ConfirmPreview {
 kind:'mail'|'file_write'|'file_delete'|'note_delete'|'mcp'|'browser_eval'|'bulk'
 title:string
 fields:{label:string;value:string}[]
 body?:string
 warnings?:string[]
 editable?:Record<string,string>
}
export interface ConfirmCardData {id:string;chatId:string;preview:ConfirmPreview;state:'pending'|'allowed'|'denied'|'cancelled'}
