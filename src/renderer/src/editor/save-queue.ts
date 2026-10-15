const pending=new Map<string,Promise<void>>()
export function queueNoteSave(noteId:string,write:()=>Promise<void>):Promise<void> {
  const previous=pending.get(noteId)??Promise.resolve()
  const next=previous.catch(()=>undefined).then(write)
  pending.set(noteId,next)
  const finish=()=>{if(pending.get(noteId)===next)pending.delete(noteId)}
  void next.then(finish,finish)
  return next
}
export async function pendingNoteSave(noteId:string):Promise<void> {
  for(;;){const current=pending.get(noteId);if(!current)return;await current;if(pending.get(noteId)===current)return}
}
