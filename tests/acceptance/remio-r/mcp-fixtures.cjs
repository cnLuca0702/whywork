// 伪造 MCP 服务器（仅本机）：
//   node mcp-fixtures.cjs --stdio        45 个工具的 stdio 服务器（工具搜索排序与阈值切换）
//   node mcp-fixtures.cjs --stdio-crash  启动即退出（失败隔离）
//   require(...).startHttpMcp({token})   3 个工具的 Streamable HTTP 服务器（token 认证）
const path = require('node:path')
const http = require('node:http')
const REPO = path.resolve(__dirname, '../../..')
const sdk = p => require(path.join(REPO, 'node_modules/@modelcontextprotocol/sdk/dist/cjs', p))
const { Server } = sdk('server/index.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = sdk('types.js')

const schema = { type: 'object', properties: { q: { type: 'string', description: '参数' } } }

const STDIO_TOOLS = [
  { name: 'export', description: 'Export the current dataset', inputSchema: schema },
  { name: 'export_csv', description: 'Write rows as CSV', inputSchema: schema },
  { name: 'bulk_export_jobs', description: 'Queue background jobs', inputSchema: schema },
  { name: 'archive_records', description: 'Archive and export old records', inputSchema: schema },
  ...Array.from({ length: 41 }, (_, i) => ({ name: `filler_${String(i + 1).padStart(2, '0')}`, description: `Filler tool ${i + 1}`, inputSchema: schema }))
]
const HTTP_TOOLS = [
  { name: 'rt_echo', description: 'Echo text back', inputSchema: schema },
  { name: 'rt_sum', description: 'Add numbers', inputSchema: schema },
  { name: 'rt_time', description: 'Fixed time', inputSchema: schema }
]

function makeServer(tools, name) {
  const server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async req => ({ content: [{ type: 'text', text: `RT-MCP-RESULT ${req.params.name} ${JSON.stringify(req.params.arguments ?? {})}` }] }))
  return server
}

async function startHttpMcp({ token }) {
  const { StreamableHTTPServerTransport } = sdk('server/streamableHttp.js')
  const seen = []
  const httpServer = http.createServer(async (req, res) => {
    const auth = req.headers.authorization ?? ''
    seen.push({ method: req.method, auth: auth ? '[present]' : '' })
    if (auth !== token && auth !== `Bearer ${token}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return }
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : undefined
      const server = makeServer(HTTP_TOOLS, 'rt-http')
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => { transport.close(); server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    })
  })
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${httpServer.address().port}/mcp`, seen, close: () => new Promise(r => httpServer.close(() => r())) }
}

if (require.main === module) {
  if (process.argv.includes('--stdio-crash')) process.exit(1)
  if (process.argv.includes('--stdio')) {
    const { StdioServerTransport } = sdk('server/stdio.js')
    makeServer(STDIO_TOOLS, 'rt-stdio-45').connect(new StdioServerTransport())
  }
}

module.exports = { startHttpMcp, STDIO_TOOLS, HTTP_TOOLS }
