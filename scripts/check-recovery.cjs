const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'whywork-process-check-')),token=crypto.randomBytes(16).toString('hex')
fs.writeFileSync(path.join(root,'owner'),token)
const electron=require('electron')
const workerEnv={...process.env};delete workerEnv.ELECTRON_RUN_AS_NODE
async function phase(name,crash=false) {
  await new Promise((resolve,reject)=>{
    const child=spawn(electron,[path.resolve('out/main/index.js'),'--recovery-worker'],{env:{...workerEnv,WHYWORK_RECOVERY_ROOT:root,WHYWORK_RECOVERY_TOKEN:token,WHYWORK_RECOVERY_PHASE:name},stdio:['ignore','pipe','pipe']})
    let output='',killed=false
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(name+' timed out: '+output))},20000)
    child.on('error',e=>{clearTimeout(timeout);reject(e)})
    const collect=data=>{
      output+=data.toString()
      if(crash&&!killed&&output.includes('[RECOVERY] CRASH_READY')) {
        try {assert(fs.statSync(path.join(root,'workspace/.whywork/whywork.db-wal')).size>0)}
        catch(e){clearTimeout(timeout);child.kill('SIGKILL');reject(e);return}
        killed=true;child.kill('SIGKILL')
      }
    }
    child.stdout.on('data',collect);child.stderr.on('data',collect)
    child.on('close',(code,signal)=>{
      clearTimeout(timeout)
      if(crash?killed&&signal==='SIGKILL':code===0)resolve()
      else reject(new Error(name+' failed ('+code+'/'+signal+'): '+output))
    })
  })
  console.log('[RECOVERY-CHECK]',name,crash?'owned worker SIGKILL confirmed':'PASS')
}
;(async()=>{
  try {await phase('prepare');await phase('verify-normal');await phase('crash-write',true);await phase('verify-crash');console.log('[RECOVERY-CHECK] committed files/FTS/SQLite survive normal exit and SIGKILL; unsaved edits and power loss not covered')}
  finally {fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
