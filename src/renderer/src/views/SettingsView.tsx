import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Input, message, Select, Switch, Tabs, Tag, Typography, Radio, Modal, Dropdown } from 'antd'
import { FolderOpenOutlined, LoginOutlined, PlusOutlined, SettingOutlined, MoreOutlined } from '@ant-design/icons'
import { sys, useSysEvent } from '../api'
import { t } from '../i18n/zh'

interface ProviderInfo {
  id: string
  kind: string
  name: string
  baseUrl: string | null
  hasKey: boolean
  models: { fast: string[]; expert: string[]; defaultFast?: string; defaultExpert?: string } | null
  enabled: boolean
}

interface PresetInfo {
  kind?: 'openai-compat'|'anthropic'
  id: string
  name: string
  baseUrl: string
  models: string[]
}

function ProviderEditor({preset,saved,known,onClose,onSaved}:{preset?:PresetInfo;saved?:ProviderInfo;known:PresetInfo[];onClose:()=>void;onSaved:()=>void}) {
  const customId='openai-compat'
  const [chosenId,setChosenId]=useState<string|undefined>(saved?.id??preset?.id)
  const chosen=preset??known.find(p=>p.id===chosenId)
  const custom=!chosen||chosen.id===customId
  const [name,setName]=useState(saved?.name??chosen?.name??'')
  const [baseUrl,setBaseUrl]=useState(saved?.baseUrl??chosen?.baseUrl??'')
  const initialModels=[...new Set([...(saved?.models?.fast??[]),...(saved?.models?.expert??[]),saved?.models?.defaultFast,saved?.models?.defaultExpert].filter((m):m is string=>!!m))]
  const [models,setModels]=useState<string[]>(initialModels)
  const [modelOptions,setModelOptions]=useState<string[]>(initialModels)
  const [apiKey,setApiKey]=useState('')
  const [busy,setBusy]=useState(false)
  const [enabled,setEnabled]=useState(saved?.enabled??true)
  // 新增流程切换供应商：名称/URL 跟随预设重置
  useEffect(()=>{if(!saved&&chosen){setName(custom?'':chosen.name);setBaseUrl(chosen.baseUrl);setModels([]);setModelOptions([])}},[chosenId]) // eslint-disable-line react-hooks/exhaustive-deps
  const savedId=useRef(saved?.id).current
  const finalId=savedId??(custom?`openai-compat:${crypto.randomUUID()}`:chosen?.id??'')
  const save=async()=>{
    if(!chosen){void message.warning('请先选择供应商');return}
    if(!name.trim()||!baseUrl.trim()){void message.warning('名称和 Base URL 必填');return}
    try{const u=new URL(baseUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error()}catch{void message.warning('请输入不含账号、密码、查询参数的 HTTP(S) Base URL');return}
    if(!saved?.hasKey&&!apiKey.trim()){void message.warning('请输入 API 密钥');return}
    setBusy(true)
    try{
      await sys('provider.save',{id:finalId,kind:chosen.kind??'openai-compat',name:name.trim(),baseUrl:baseUrl.trim(),enabled,
        ...(apiKey?{apiKey}:{}),
        ...(models.length>0?{models:{fast:models,expert:[]}}:{})})
      setApiKey('');onSaved();onClose();void message.success('配置已保存；请刷新目录查看模型')
    }catch(e){void message.error(String(e))}finally{setBusy(false)}
  }
  const [probe,setProbe]=useState<{state:'idle'|'busy'|'ok'|'fail';msg:string;models?:string[]}>({state:'idle',msg:''})
  const runProbe=async(mode:'pull'|'test')=>{
    if(!baseUrl.trim()){void message.warning('请先填写 Base URL');return}
    if(!saved?.hasKey&&!apiKey.trim()&&chosen){/* 无 Key 也可试探，但大概率 401 */}
    setProbe({state:'busy',msg:mode==='pull'?'正在拉取模型…':'正在测试连接…'})
    try{
      const r=await sys<{models:string[];ms:number}>('provider.probe',{baseUrl:baseUrl.trim(),...(apiKey?{apiKey}:{...(saved?.id?{id:saved.id}:{})})})
      if(mode==='pull'){
        if(r.models.length===0){setProbe({state:'fail',msg:'连接正常，但目录未返回模型；请手动输入模型 ID'});setModelOptions(m=>[...new Set([...m])])}
        else{setModelOptions(r.models);setModels(r.models);setProbe({state:'ok',msg:`已拉取 ${r.models.length} 个模型并默认全选（${r.ms}ms），取消不需要的即可`})}
      }else{
        setProbe({state:'ok',msg:`连接正常（${r.ms}ms，目录 ${r.models.length} 个模型）`})
      }
    }catch(e){
      setProbe({state:'fail',msg:String(e).replace(/^Error:?\s*/,'')})
    }
  }
  return <Modal open title={saved?'配置提供商':'添加提供商'} onCancel={onClose} onOk={()=>void save()} confirmLoading={busy} okText="保存" cancelText="取消" okButtonProps={{disabled:!chosen}} destroyOnHidden>
    <div className="ww-provider-form">
      {!saved&&<label>供应商<Select aria-label="供应商类型" style={{width:'100%'}} value={chosenId} onChange={setChosenId}
        options={[...known,{id:customId,kind:'openai-compat',name:'自定义供应商（OpenAI 兼容）',baseUrl:'',models:[]}].map(p=>({value:p.id,label:p.name}))}/></label>}
      <label>名称<Input aria-label="提供商名称" value={name} onChange={e=>setName(e.target.value)} disabled={!custom}/></label>
      <label>Base URL<Input aria-label="提供商 Base URL" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} disabled={!custom} placeholder="https://your-endpoint/v1"/></label>
      <label>API 密钥<Input.Password aria-label="提供商 API 密钥" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="off" placeholder={saved?.hasKey?'已保存；留空保留原密钥':'输入你的 API 密钥'}/></label>
      <label>模型<Select aria-label="提供商模型" mode="multiple" tokenSeparators={[',','，','\n']} style={{width:'100%'}} value={models}
        onChange={v=>setModels(v as string[])} placeholder="自动拉取后勾选；也可手动输入 ID"
        options={modelOptions.map(m=>({value:m,label:m}))} maxTagCount="responsive" open={undefined}/></label>
      <div className="flex items-center gap-2">
        <Button size="small" type="text" loading={probe.state==='busy'} onClick={()=>void runProbe('pull')}>自动拉取模型</Button>
        <Button size="small" type="text" loading={probe.state==='busy'} onClick={()=>void runProbe('test')}>测试连接</Button>
        {probe.state==='ok'&&<span className="text-xs text-green-500">✓ {probe.msg}</span>}
        {probe.state==='fail'&&<span className="text-xs text-red-400">✗ {probe.msg}</span>}
      </div>
      <div className="text-xs text-[var(--ww-text-3)]">使用模型的准确 ID。目录读取失败时，手动配置的 ID 仍可选择，但不会标记为已验证。</div>
      <label className="flex items-center gap-2"><Switch checked={enabled} onChange={setEnabled} size="small"/>启用提供商</label>
    </div>
  </Modal>
}

function ProviderSettings({presets,saved,refresh}:{presets:PresetInfo[];saved:ProviderInfo[];refresh:()=>void}){
  const [section,setSection]=useState('codex')
  const [editor,setEditor]=useState<{preset?:PresetInfo;saved?:ProviderInfo}|null>(null)
  const [catalog,setCatalog]=useState<import('../store/chat').CatalogProvider[]>([])
  const [loading,setLoading]=useState(false)
  const [catalogError,setCatalogError]=useState('')
  const known=presets.filter(p=>p.id!=='openai-compat')
  const rows=saved.filter(r=>r.kind!=='chatgpt'&&(section==='keys'?known.some(p=>p.id===r.id):!known.some(p=>p.id===r.id)))
  const load=async()=>{setLoading(true);setCatalogError('');try{const r=await sys<{items:import('../store/chat').CatalogProvider[]}>('provider.models',{refresh:true});setCatalog(r.items)}catch(e){setCatalogError(String(e));setCatalog([])}finally{setLoading(false)}}
  const edit=(r:ProviderInfo)=>setEditor({saved:r,preset:known.find(p=>p.id===r.id)})
  const changed=()=>{setCatalog([]);refresh()}
  return <section className="ww-provider-settings">
    <h2>AI 服务提供商</h2>
    <Radio.Group aria-label="提供商类型" className="ww-provider-tabs" value={section} onChange={e=>setSection(e.target.value)} options={[{value:'codex',label:'Codex'},{value:'keys',label:'自定义 API 密钥'},{value:'custom',label:'自定义供应商'}]}/>
    {section==='codex'?<ChatGPTCard onChanged={changed}/>:<>
      <div className="ww-provider-notice">{section==='keys'?'选择已知供应商，使用你自己的 API 密钥。模型以该供应商返回的目录和你的配置为准。':'支持 OpenAI v1/chat/completions 兼容接口。'}</div>
      <div className="ww-provider-list">
        {rows.length===0&&<div className="ww-provider-empty">尚未添加提供商</div>}
        {rows.map(r=>{const discovered=catalog.find(p=>p.id===r.id);const configured=[...new Set([...(r.models?.fast??[]),...(r.models?.expert??[]),r.models?.defaultFast,r.models?.defaultExpert].filter(Boolean))]
          return <div className="ww-provider-row" key={r.id}>
            <Switch size="small" aria-label={'启用 '+r.name} checked={r.enabled} onChange={enabled=>void sys('provider.save',{id:r.id,kind:r.kind,name:r.name,enabled}).then(changed).catch(e=>message.error(String(e)))}/>
            <div className="ww-provider-detail"><strong>{r.name}</strong><div>{(discovered?.models.map(m=>m.label)??configured).join(', ')||'尚未配置模型，可读取目录'}</div><small>{!r.enabled?'已停用':discovered?.status??(r.hasKey?'密钥已保存 · 模型未验证':'需要配置密钥')}</small></div>
            <Button type="text" aria-label={'配置 '+r.name} icon={<SettingOutlined/>} onClick={()=>edit(r)}/>
            <Dropdown menu={{items:[{key:'edit',label:'编辑配置'},{key:'remove',label:'移除提供商',danger:true}],onClick:({key})=>key==='edit'?edit(r):Modal.confirm({title:'移除 '+r.name+'？',content:'现有对话会保留，但需重新选择模型。',okText:'移除',cancelText:'取消',onOk:()=>sys('provider.delete',{id:r.id}).then(changed)})}} trigger={['click']}><Button type="text" aria-label={r.name+' 更多操作'} icon={<MoreOutlined/>}/></Dropdown>
          </div>})}
      </div>
      <div className="flex flex-wrap gap-2"><Button className="ww-add-provider" icon={<PlusOutlined/>} onClick={()=>{if(section==='keys')setEditor({});else setEditor({preset:{id:'openai-compat',name:'',baseUrl:'',models:[]}})}}>添加提供商</Button>
        <Button loading={loading} disabled={!rows.length} onClick={()=>void load()}>刷新模型目录</Button></div>
      {catalogError&&<div role="alert">{catalogError}</div>}
      <p className="text-xs text-[var(--ww-text-3)]">目录刷新不调用模型推理。聊天中可分别选择不同供应商的模型。</p>
    </>}
    {editor&&<ProviderEditor key={editor.saved?.id??editor.preset?.id??'new'} preset={editor.preset} saved={editor.saved} known={known} onClose={()=>setEditor(null)} onSaved={changed}/>}
  </section>
}

function ChatGPTCard({ onChanged }: { onChanged: () => void }) {
  type Status={loggedIn:boolean;accountId?:string;model?:string;planEnabled?:boolean;legacyLogin?:boolean;pending?:boolean;needsRefresh?:boolean}
  const [status,setStatus]=useState<Status>({loggedIn:false})
  const [busy,setBusy]=useState(false)
  const [modelsOpen,setModelsOpen]=useState(false)
  const [candidates,setCandidates]=useState<string[]>([])
  const [picked,setPicked]=useState<string[]>([])
  const loginRef=useRef(false)
  const refresh=useCallback(()=>{void sys<Status>('provider.chatgpt_status').then(setStatus).catch(()=>undefined)},[])
  useEffect(refresh,[refresh])
  const login=async(newAccount=false)=>{
    if(loginRef.current)return
    loginRef.current=true;setBusy(true)
    try{
      const r=await sys<{ok:boolean;planEnabled:boolean;modelReady:boolean}>('provider.chatgpt_login',{newAccount})
      if(r.ok)void message[r.planEnabled&&r.modelReady?'success':'warning'](r.planEnabled?(r.modelReady?'ChatGPT 身份和套餐权限已确认':'已登录，模型目录暂未取得，请点击刷新模型'):'已登录，但尚未授权套餐使用；可重新授权或配置其他供应商')
      refresh();onChanged()
    }catch(e){void message.error(String(e))}finally{loginRef.current=false;setBusy(false);refresh()}
  }
  return <Card size="small" title="Codex">
    <div className="space-y-2 text-sm">
      <div>{status.loggedIn?`已登录（${status.accountId?.slice(0,12)??'…'}） · ${status.planEnabled?'已授权套餐使用':'未授权套餐使用'}`:'通过 ChatGPT 账号授权连接模型。'}</div>
      <div className="text-xs text-[var(--ww-text-3)]">WhyWork 会在官方页面申请本机应用授权。套餐使用取决于账号及授权范围；不会读取你的 ChatGPT 历史对话，也不会自动改用 API 计费。</div>
      {status.legacyLogin&&<div role="alert">旧版登录需要重新授权，请关闭旧登录页面后从这里重新开始。</div>}
      {status.needsRefresh&&<div>会话需要刷新；若已被撤销，将提示重新登录。</div>}
      {status.model&&<div>当前模型：{status.model}</div>}
      <div className="flex flex-wrap gap-2">
        <Button size="small" type="primary" icon={<LoginOutlined/>} loading={busy} disabled={!!status.pending&&!busy} onClick={()=>void login()}>Continue with ChatGPT</Button>
        {(busy||status.pending)&&<Button size="small" onClick={()=>void sys('provider.chatgpt_cancel_login').then(refresh).catch(e=>message.error(String(e)))}>取消登录</Button>}
        {status.loggedIn&&<>
          <Button size="small" disabled={busy} onClick={()=>void sys('provider.chatgpt_models').then(()=>{refresh();onChanged()}).catch(e=>message.error(String(e)))}>刷新模型</Button>
          <Button size="small" type="primary" ghost onClick={async()=>{
            try{
              const r=await sys<{models:string[];selected:string[]}>('provider.chatgpt_candidates')
              setCandidates(r.models);setPicked(r.selected);setModelsOpen(true)
            }catch(e){void message.error(String(e))}
          }}>选择生效模型</Button>
          <Button size="small" disabled={busy} onClick={()=>void login(true)}>连接其他账号或工作区</Button>
          <Button size="small" danger disabled={busy} onClick={()=>void sys<{revoked:boolean}>('provider.chatgpt_logout').then(r=>{refresh();onChanged();if(!r.revoked)void message.warning('本地已退出，远端撤销未确认。请在 ChatGPT 设置中断开 WhyWork。')}).catch(e=>message.error(String(e)))}>退出登录</Button>
        </>}
      </div>
    </div>
    <Modal open={modelsOpen} title="选择生效模型" okText="保存" cancelText="取消"
      onCancel={()=>setModelsOpen(false)}
      onOk={async()=>{
        try{
          if(picked.length===0){void message.warning('至少选择一个模型');return}
          await sys('provider.save',{id:'chatgpt',kind:'chatgpt',name:'Codex · ChatGPT',models:{fast:picked,expert:[]}})
          setModelsOpen(false);refresh();onChanged();void message.success(`已生效 ${picked.length} 个模型`)
        }catch(e){void message.error(String(e))}
      }}>
      <div className="text-xs text-[var(--ww-text-3)]" style={{marginBottom:12}}>勾选的模型才会出现在对话选择器中；账号目录会随官方调整变化，可随时回来重新勾选。</div>
      <Select aria-label="Codex 生效模型" mode="multiple" style={{width:'100%'}} value={picked}
        onChange={v=>setPicked(v as string[])} placeholder="勾选要启用的模型"
        options={candidates.map(m=>({value:m,label:m}))} maxTagCount="responsive"/>
    </Modal>
  </Card>
}

function SearchCard() {
  const [brave, setBrave] = useState('')
  const [tavily, setTavily] = useState('')
  const [blacklist, setBlacklist] = useState('')

  useEffect(() => {
    sys<{ settings: Record<string, string | null> }>('settings.get', { keys: ['search.braveKey', 'search.tavilyKey'] })
      .then((r) => {
        setBrave(r.settings['search.braveKey'] ?? '')
        setTavily(r.settings['search.tavilyKey'] ?? '')
      })
      .catch(() => undefined)
    sys<{ items: string[] }>('clip.blacklist_get')
      .then((r) => setBlacklist(r.items.join('\n')))
      .catch(() => undefined)
  }, [])

  return (
    <div className="space-y-4">
      <Card size="small" title="联网搜索源（BYOK）">
        <div className="space-y-2">
          <Input.Password addonBefore="Brave Key" placeholder="可选" value={brave} onChange={(e) => setBrave(e.target.value)} />
          <Input.Password addonBefore="Tavily Key" placeholder="可选" value={tavily} onChange={(e) => setTavily(e.target.value)} />
          <div className="text-xs text-[var(--ww-text-3)]">不配置时使用 DuckDuckGo 免费搜索兜底。</div>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              void sys('settings.set', { settings: { 'search.braveKey': brave || null, 'search.tavilyKey': tavily || null } })
                .then(() => void message.success('已保存'))
                .catch((e) => void message.error(String(e)))
            }}
          >
            保存
          </Button>
        </div>
      </Card>
      <Card size="small" title="采集黑名单（剪藏/网页采集前拦截）">
        <div className="space-y-2">
          <Input.TextArea
            placeholder={'每行一个域名或子串，如：\nexample.invalid\nads.example.com'}
            value={blacklist}
            onChange={(e) => setBlacklist(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
          <Button
            size="small"
            type="primary"
            onClick={() => {
              void sys('clip.blacklist_set', { items: blacklist.split('\n').map((s) => s.trim()).filter(Boolean) })
                .then(() => void message.success('黑名单已保存'))
                .catch((e) => void message.error(String(e)))
            }}
          >
            保存黑名单
          </Button>
        </div>
      </Card>
    </div>
  )
}

function MediaCard() {
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')

  useEffect(() => {
    sys<{ settings: Record<string, string | null> }>('settings.get', { keys: ['media.asrBaseUrl', 'media.asrKey', 'media.asrModel'] })
      .then((r) => {
        setBaseUrl(r.settings['media.asrBaseUrl'] ?? 'https://api.openai.com/v1')
        setKey(r.settings['media.asrKey'] ?? '')
        setModel(r.settings['media.asrModel'] ?? 'whisper-1')
      })
      .catch(() => undefined)
  }, [])

  return (
    <Card size="small" title="语音转写（ASR，BYOK）">
      <div className="space-y-2">
        <Input addonBefore="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input.Password addonBefore="API Key" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <Input addonBefore="模型" placeholder="whisper-1" value={model} onChange={(e) => setModel(e.target.value)} />
        <div className="text-xs text-[var(--ww-text-3)]">任意 OpenAI 兼容 /audio/transcriptions 端点。OCR 使用本地 tesseract.js，无需配置。</div>
        <Button
          size="small"
          type="primary"
          onClick={() => {
            void sys('settings.set', {
              settings: {
                'media.asrBaseUrl': baseUrl || null,
                'media.asrKey': key || null,
                'media.asrModel': model || null
              }
            })
              .then(() => void message.success('已保存'))
              .catch((e) => void message.error(String(e)))
          }}
        >
          保存
        </Button>
      </div>
    </Card>
  )
}

interface McpServerInfo {
  id: string
  name: string
  command: string
  args: string[]
  envKeys: string[]
  enabled: boolean
  status: string
  toolCount: number
}

interface SkillInfo {
  name: string
  source: 'workspace' | 'global'
  description: string
  enabled: boolean
}

function McpCard() {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [form, setForm] = useState({ name: '', command: '', args: '', env: '' })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    sys<{ items: McpServerInfo[] }>('mcp.servers_list').then((r) => setServers(r.items)).catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])

  const add = async () => {
    if (!form.name.trim() || !form.command.trim()) {
      void message.warning('名称与命令必填')
      return
    }
    setBusy(true)
    try {
      await sys('mcp.servers_save', {
        name: form.name.trim(),
        command: form.command.trim(),
        args: form.args.split(/\s+/).filter(Boolean),
        env: Object.fromEntries(
          form.env
            .split('\n')
            .map((l) => l.split('=').map((s) => s.trim()))
            .filter((kv) => kv[0] && kv[1])
            .map((kv) => [kv[0]!, kv[1]!])
        )
      })
      setForm({ name: '', command: '', args: '', env: '' })
      void message.success('已添加，正在连接…')
      setTimeout(refresh, 1500)
    } catch (e) {
      void message.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card size="small" title="MCP 服务器（stdio）">
      <div className="space-y-3">
        {servers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-md border border-[var(--ww-border)] p-2 text-sm">
            <Switch
              size="small"
              checked={s.enabled}
              onChange={(v) => {
                void sys('mcp.enable', { id: s.id, enabled: v }).then(() => setTimeout(refresh, 1200))
              }}
            />
            <span className="font-medium">{s.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--ww-text-3)]" title={`${s.command} ${s.args.join(' ')}`}>
              {s.command} {s.args.join(' ')}
            </span>
            <Tag color={s.status.startsWith('已连接') ? 'green' : 'default'}>{s.status}</Tag>
            <Button
              size="small"
              onClick={() => {
                void sys('mcp.tools', { serverId: s.id }).then(() => {
                  void message.success('已刷新工具')
                  refresh()
                })
              }}
            >
              刷新
            </Button>
            <Button size="small" danger onClick={() => void sys('mcp.servers_delete', { id: s.id }).then(refresh)}>
              删除
            </Button>
          </div>
        ))}
        <div className="space-y-2 rounded-md border border-dashed border-[var(--ww-border)] p-3 dark:border-[#404040]">
          <div className="text-xs font-medium text-[var(--ww-text-3)]">添加服务器</div>
          <Input size="small" placeholder="名称，如 filesystem" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input size="small" placeholder="命令，如 npx" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
          <Input size="small" placeholder="参数（空格分隔），如 -y @modelcontextprotocol/server-filesystem /path" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} />
          <Input.TextArea
            size="small"
            placeholder={'环境变量（每行 KEY=value，可选）'}
            value={form.env}
            onChange={(e) => setForm({ ...form, env: e.target.value })}
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
          <Button size="small" type="primary" loading={busy} onClick={() => void add()}>
            添加
          </Button>
        </div>
        <div className="text-xs text-[var(--ww-text-3)]">MCP 工具以 mcp__服务器__工具 名义注入 Agent，可直接调用。</div>
      </div>
    </Card>
  )
}

function SkillsCard() {
  const [skills, setSkills] = useState<SkillInfo[]>([])

  const refresh = useCallback(() => {
    sys<{ items: SkillInfo[] }>('skills.list').then((r) => setSkills(r.items)).catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])

  return (
    <Card size="small" title="技能（SKILL.md）">
      <div className="space-y-2">
        {skills.length === 0 && (
          <div className="text-xs text-[var(--ww-text-3)]">
            把 SKILL.md（或含 SKILL.md 的目录）放入 <code>工作区/.whywork/skills/</code> 或 <code>~/.whywork/skills/</code>，
            刷新后自动加载并注入 Agent 提示词。
          </div>
        )}
        {skills.map((s) => (
          <div key={`${s.source}:${s.name}`} className="flex items-center gap-2 rounded-md border border-[var(--ww-border)] p-2 text-sm">
            <Switch
              size="small"
              checked={s.enabled}
              onChange={(v) => void sys('skills.toggle', { name: s.name, enabled: v }).then(refresh)}
            />
            <span className="font-medium">{s.name}</span>
            <Tag>{s.source === 'workspace' ? '工作区' : '全局'}</Tag>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--ww-text-3)]">{s.description}</span>
          </div>
        ))}
        <Button size="small" onClick={() => void sys('skills.reload').then(refresh)}>
          重新扫描
        </Button>
      </div>
    </Card>
  )
}

interface CloudNoteItem {
  noteId: string
  title: string
  updateTime?: number
  hasAudio?: number
}

function IflytekCard() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [devices, setDevices] = useState<{ deviceId: string; deviceName: string; lastLoginTime?: string }[]>([])
  const [notes, setNotes] = useState<CloudNoteItem[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    sys<{ loggedIn: boolean }>('iflytek.status')
      .then((r) => setLoggedIn(r.loggedIn))
      .catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])

  useEffect(() => {
    if (!loggedIn) return
    sys<{ devices: { deviceId: string; deviceName: string; lastLoginTime?: string }[] }>('iflytek.devices')
      .then((r) => setDevices(r.devices))
      .catch((e) => void message.error(String(e)))
    sys<{ notes: CloudNoteItem[] }>('iflytek.notes', { pageIndex: 1, pageSize: 20 })
      .then((r) => setNotes(r.notes))
      .catch(() => undefined)
  }, [loggedIn])

  return (
    <Card size="small" title="科大讯飞智能办公本">
      <div className="space-y-3">
        {loggedIn ? (
          <>
            <div className="text-sm text-green-600">已登录</div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-[var(--ww-text-2)]">绑定设备</div>
              {devices.map((d) => (
                <div key={d.deviceId} className="flex items-center gap-2 text-sm">
                  <Tag color="blue">{d.deviceName}</Tag>
                  <span className="text-xs text-[var(--ww-text-3)]">{d.lastLoginTime ?? ''}</span>
                </div>
              ))}
              {devices.length === 0 && <div className="text-xs text-[var(--ww-text-3)]">无绑定设备</div>}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-[var(--ww-text-2)]">云端笔记（点击导入为本地笔记）</div>
              {notes.slice(0, 10).map((n) => (
                <Button
                  key={n.noteId}
                  size="small"
                  type="text"
                  style={{ paddingInline: 0 }}
                  onClick={() => {
                    void sys<{ noteId: string }>('iflytek.import_note', { noteId: n.noteId, title: n.title })
                      .then(() => void message.success(`已导入「${n.title}」`))
                      .catch((e) => void message.error(String(e)))
                  }}
                >
                  📝 {n.title}
                  {n.hasAudio ? '（含录音）' : ''}
                </Button>
              ))}
              {notes.length === 0 && <div className="text-xs text-[var(--ww-text-3)]">无云端笔记</div>}
            </div>
            <div className="text-xs text-[var(--ww-text-3)]">笔记详情“⋯”菜单可把笔记推送到办公本（读写驿站）。</div>
            <Button size="small" danger onClick={() => void sys('iflytek.logout').then(refresh)}>
              退出登录
            </Button>
          </>
        ) : (
          <>
            <Input placeholder="手机号" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            <Input.Password placeholder="密码（仅本地 MD5 后上传）" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button
              size="small"
              type="primary"
              loading={busy}
              onClick={() => {
                setBusy(true)
                void sys('iflytek.login', { mobile, password })
                  .then(() => {
                    void message.success('讯飞登录成功')
                    setPassword('')
                    refresh()
                  })
                  .catch((e) => void message.error(String(e)))
                  .finally(() => setBusy(false))
              }}
            >
              登录
            </Button>
            <div className="text-xs text-[var(--ww-text-3)]">凭据仅保存在本机（加密）；用于读取办公本云笔记与推送文件。</div>
          </>
        )}
      </div>
    </Card>
  )
}

export default function SettingsView() {
  const [presets, setPresets] = useState<PresetInfo[]>([])
  const [saved, setSaved] = useState<ProviderInfo[]>([])
  const [wsPath, setWsPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    sys<{ items: PresetInfo[] }>('provider.presets').then((r) => setPresets(r.items)).catch(() => undefined)
    sys<{ items: ProviderInfo[] }>('provider.list').then((r) => setSaved(r.items)).catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => {
    sys<{ path: string }>('app.get_workspace').then((r) => setWsPath(r.path))
  }, [])

  const onChange = async () => {
    setBusy(true)
    try {
      const picked = await sys<{ canceled: boolean; path?: string }>('app.pick_folder')
      if (!picked.canceled && picked.path) {
        const r = await sys<{ path: string }>('app.set_workspace', { path: picked.path })
        setWsPath(r.path)
        void message.success(t('settings.changed'))
      }
    } catch (e) {
      void message.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl">
        <Tabs
          items={[
            {
              key: 'providers',
              label: '模型供应商',
              children: (
                <ProviderSettings presets={presets} saved={saved} refresh={refresh}/>
              )
            },
            {
              key: 'search',
              label: '搜索',
              children: <SearchCard />
            },
            {
              key: 'media',
              label: '媒体',
              children: <MediaCard />
            },
            {
              key: 'iflytek',
              label: '讯飞办公本',
              children: <IflytekCard />
            },
            {
              key: 'mcp',
              label: 'MCP',
              children: <McpCard />
            },
            {
              key: 'skills',
              label: '技能',
              children: <SkillsCard />
            },
            {
              key: 'workspace',
              label: t('settings.workspace'),
              children: (
                <Card title={t('settings.workspacePath')} size="small">
                  <Typography.Text code copyable style={{ wordBreak: 'break-all' }}>
                    {wsPath || t('common.loading')}
                  </Typography.Text>
                  <div className="mt-3">
                    <Button icon={<FolderOpenOutlined />} loading={busy} onClick={() => void onChange()}>
                      {t('settings.change')}
                    </Button>
                  </div>
                </Card>
              )
            },
            {
              key: 'about',
              label: t('settings.about'),
              children: (
                <Card size="small">
                  <Typography.Text type="secondary">{t('settings.aboutDesc')}</Typography.Text>
                  <div className="mt-2 text-xs text-[var(--ww-text-3)]">BYOK · 本地运行 · 无账号 · 无云同步</div>
                </Card>
              )
            }
          ]}
        />
      </div>
    </div>
  )
}

void useSysEvent
