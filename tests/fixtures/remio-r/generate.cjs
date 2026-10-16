#!/usr/bin/env node
// 生成 REMIO-R 验收测试集的确定性合成 fixtures（全部为虚构内容，不含真实数据或 remio 文件）。
// 用法：node tests/fixtures/remio-r/generate.cjs        生成并写 manifest.json
//       node tests/fixtures/remio-r/generate.cjs --verify 只校验 manifest 中的 SHA-256
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = __dirname
const IMP = path.join(ROOT, 'importable')
const ORACLE = path.join(ROOT, 'oracle')
const REPO = path.resolve(ROOT, '../../..')
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')

function write(rel, content) {
  const full = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

// ---------- 引用问答语料（R3） ----------
function citationCorpus() {
  write('importable/notes/cite-01_北辰计划.md', [
    '# 北辰计划',
    '',
    '北辰计划由周岚负责。[CITE-F01]',
    '',
    '北辰计划计划于2027年3月18日上线。[CITE-F02]',
    '',
    '北辰计划批准预算为260000元。[CITE-F03]',
    ''
  ].join('\n'))
  write('importable/notes/cite-02_北辰风险.md', [
    '# 北辰计划风险登记',
    '',
    '当前登记的三项风险：供应商延期、数据迁移、合规审查。[CITE-F04]',
    '',
    '风险评审每两周进行一次。[CITE-F05]',
    ''
  ].join('\n'))
  write('importable/notes/cite-03_南岭计划.md', [
    '# 南岭计划（干扰项）',
    '',
    '南岭计划由何川负责，预算为90000元，与北辰计划无关。[CITE-D01]',
    ''
  ].join('\n'))
}

// ---------- 局部编辑目标（R5） ----------
function editTarget() {
  const lines = ['# 编辑目标', '']
  for (let i = 1; i <= 40; i++) lines.push(`第${i}节：内容行 EDIT-L${String(i).padStart(3, '0')}`)
  lines.push('重复行 DUP-LINE')
  lines.push('中间分隔')
  lines.push('重复行 DUP-LINE')
  lines.push('   带首尾空白的行 FUZZY-TARGET   ')
  lines.push('结尾行 EDIT-END')
  write('importable/notes/edit-target.md', lines.join('\n') + '\n')
}

// ---------- 长引用笔记（R2 上下文预算） ----------
function longRefs() {
  for (let n = 1; n <= 4; n++) {
    const markers = { 100: `REF${n}-AT-0100`, 7900: `REF${n}-AT-7900`, 8100: `REF${n}-AT-8100`, 9500: `REF${n}-AT-9500` }
    let body = ''
    while (body.length < 10000) {
      const pos = body.length
      const hit = Object.keys(markers).map(Number).find(p => pos >= p && !body.includes(markers[p]))
      body += hit !== undefined ? markers[hit] : '填'
    }
    write(`importable/notes/long-ref-${n}.md`, body.slice(0, 10000))
  }
}

// ---------- 相关笔记（R10） ----------
function relatedCorpus() {
  write('importable/notes/rel-01_量子退火.md', '# 量子退火调度\n\n关键词：量子退火、调度优化、REL-A\n')
  write('importable/notes/rel-02_调度优化实践.md', '# 调度优化实践\n\n讨论量子退火在调度优化中的应用。REL-B\n')
  write('importable/notes/rel-03_无关.md', '# 园艺记录\n\n番茄育苗。REL-C\n')
}

// ---------- 技能（R2/R13） ----------
function skills() {
  const mk = (dir, name, desc, marker) =>
    write(`importable/skills/${dir}/SKILL.md`, `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${marker}\n`)
  mk('rt-skill-alpha', 'rt-skill-alpha', '验收用技能 A', 'SKILL-MARKER-ALPHA')
  mk('rt-skill-beta', 'rt-skill-beta', '验收用技能 B', 'SKILL-MARKER-BETA')
  mk('rt-skill-gamma', 'rt-skill-gamma', '验收用技能 C', 'SKILL-MARKER-GAMMA')
  mk('rt-skill-delta', 'rt-skill-delta', '验收用技能 D', 'SKILL-MARKER-DELTA')
  mk('dup-alpha', 'rt-skill-alpha', '与 A 重名', 'SKILL-MARKER-DUP')
  write('importable/skills/bad-no-frontmatter/SKILL.md', '# 没有 frontmatter 的技能\n\nSKILL-MARKER-BAD\n')
}

// ---------- 录音词典（R17） ----------
function media() {
  write('importable/media/dictionary.txt', '北辰计划\n周岚\nORION-17\n')
}

// ---------- 扫描版 PDF（R18）：只有一张 JPEG，没有文本层 ----------
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('无法读取 JPEG 尺寸')
}
function scannedPdf() {
  const jpg = fs.readFileSync(path.join(REPO, 'tests/fixtures/work/importable/images/ocr-clean.jpg'))
  const { w, h } = jpegSize(jpg)
  const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`)
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream')])
  ]
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets = []
  let pos = parts[0].length
  objs.forEach((o, idx) => {
    offsets.push(pos)
    const chunk = Buffer.concat([Buffer.from(`${idx + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')])
    parts.push(chunk); pos += chunk.length
  })
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n `)].join('\n') + '\n'
  parts.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`))
  write('importable/pdf/scanned.pdf', Buffer.concat(parts))
}

// ---------- 表格（R19） ----------
async function workbook() {
  const ExcelJS = require(path.join(REPO, 'node_modules/exceljs'))
  const wb = new ExcelJS.Workbook()
  wb.creator = 'whywork-remio-r-fixture'
  wb.created = new Date('2026-01-01T00:00:00Z'); wb.modified = wb.created
  const orders = wb.addWorksheet('订单')
  orders.addRow(['订单号', '客户', '城市', '金额', '状态', '备注'])
  for (let i = 1; i <= 600; i++) {
    orders.addRow([`ORD-${String(i).padStart(4, '0')}`, `客户${i % 37}`, ['上海', '北京', '深圳', '成都'][i % 4], i * 10, i % 5 === 0 ? '退款' : '完成', `备注文本${'长'.repeat(20)}#${i}`])
  }
  const sum = wb.addWorksheet('汇总')
  sum.addRow(['城市', '订单数'])
  for (const c of ['上海', '北京', '深圳', '成都']) sum.addRow([c, 150])
  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  // ExcelJS 写入包含时间戳的 docProps，统一固定后再写盘以保证可复现
  write('importable/office/rt-sheets.xlsx', buf)
}

function pptOutline() {
  write('importable/office/ppt-outline.json', JSON.stringify({
    title: '北辰计划汇报',
    slides: [
      { title: '项目概况', bullets: ['负责人：周岚', '上线：2027年3月18日'] },
      { title: '预算', bullets: ['批准预算 260000 元'] },
      { title: '风险', bullets: ['供应商延期', '数据迁移', '合规审查'] }
    ]
  }, null, 2))
}

// ---------- 答案（只供执行器读取，不得导入或监控） ----------
function oracle() {
  write('oracle/expected.json', JSON.stringify({
    scope: 'oracle 目录不可导入、不可监控、不可作为引用；只由执行器读取',
    citation: [
      { id: 'CQ01', question: '北辰计划由谁负责？', answer: '周岚', sourceFile: 'notes/cite-01_北辰计划.md', marker: 'CITE-F01', distractor: 'notes/cite-03_南岭计划.md' },
      { id: 'CQ02', question: '北辰计划什么时候上线？', answer: '2027年3月18日', sourceFile: 'notes/cite-01_北辰计划.md', marker: 'CITE-F02' },
      { id: 'CQ03', question: '北辰计划登记了哪些风险？', answer: ['供应商延期', '数据迁移', '合规审查'], sourceFile: 'notes/cite-02_北辰风险.md', marker: 'CITE-F04' },
      { id: 'CQ04', question: '北辰计划的实际利润是多少？', answer: '资料中没有利润数据，应说明不足且不给出来源编号', sourceFile: null, marker: null }
    ],
    longRefBudget: { perNote: 8000, total: 24000, mustContain: ['REF1-AT-0100', 'REF1-AT-7900'], mustNotContain: ['REF1-AT-8100', 'REF1-AT-9500'] },
    xlsx: { sheets: [{ name: '订单', rows: 601, cols: 6 }, { name: '汇总', rows: 5, cols: 2 }], charBudget: 20000 },
    mcpRanking: { query: 'export', expectedOrder: ['export', 'export_csv', 'bulk_export_jobs', 'archive_records'] },
    ocrScannedPdf: ['ORION-17', 'OCR_MARKER_742'],
    ocrNote: '扫描 PDF 的期望文字取自 tests/fixtures/work 的 ocr_expected，若该数据集更新需同步'
  }, null, 2))
  write('oracle/edit-cases.json', JSON.stringify({
    note: 'base 为 importable/notes/edit-target.md 的正文（去掉首行标题后由产品存储）。index 为 1 起计；实现若输出 edits[0] 风格也接受',
    cases: [
      { id: 'E01', edits: [{ oldText: 'EDIT-L001', newText: 'EDIT-L001-NEW' }, { oldText: 'EDIT-L040', newText: 'EDIT-L040-NEW' }], expect: { ok: true, contains: ['EDIT-L001-NEW', 'EDIT-L040-NEW'], notContains: [] } },
      { id: 'E02', edits: [{ oldText: '重复行 DUP-LINE', newText: 'x' }], expect: { ok: false, kind: 'multiple', index: 1, keywords: ['多次'] } },
      { id: 'E03', edits: [{ oldText: '第1节：内容行', newText: 'a' }, { oldText: '内容行 EDIT-L001', newText: 'b' }], expect: { ok: false, kind: 'overlap', index: 2, keywords: ['重叠'] } },
      { id: 'E04', edits: [{ oldText: 'EDIT-L001', newText: 'ok' }, { oldText: '不存在的文本 NOPE', newText: 'x' }], expect: { ok: false, kind: 'not_found', index: 2, keywords: ['未找到'] } },
      { id: 'E05', edits: [{ oldText: '带首尾空白的行 FUZZY-TARGET', newText: '已模糊匹配 FUZZY-DONE' }], expect: { ok: true, contains: ['FUZZY-DONE'], notContains: ['FUZZY-TARGET'] } },
      { id: 'E06', edits: [{ oldText: 'EDIT-L002', newText: 'EDIT-L003' }, { oldText: 'EDIT-L003', newText: 'EDIT-L003-B' }], expect: { ok: true, contains: ['EDIT-L003-B'], note: '按原文匹配而不是逐条累积：第 2 条只替换原有的 L003，第 1 条产出的 L003 保留', countOf: { 'EDIT-L003': 1, 'EDIT-L003-B': 1 } } }
    ]
  }, null, 2))
}

function listFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

function manifest() {
  const files = [...listFiles(IMP), ...listFiles(ORACLE)].sort().map(f => {
    const buf = fs.readFileSync(f)
    return { path: path.relative(ROOT, f).split(path.sep).join('/'), bytes: buf.length, sha256: sha(buf) }
  })
  return { dataset: 'TEST_REMIO_R', synthetic: true, generator: 'tests/fixtures/remio-r/generate.cjs', product_execution: 'NOT_RUN', files }
}

async function main() {
  if (process.argv.includes('--verify')) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'))
    let bad = 0
    for (const f of m.files) {
      if (f.path.endsWith('.xlsx')) continue // ExcelJS 压缩输出不保证逐字节一致，由执行器按内容校验
      const full = path.join(ROOT, f.path)
      if (!fs.existsSync(full) || sha(fs.readFileSync(full)) !== f.sha256) { console.error('MISMATCH', f.path); bad++ }
    }
    console.log(bad ? `FAIL ${bad} 个文件不一致` : `OK ${m.files.length} 个文件`)
    process.exit(bad ? 1 : 0)
  }
  fs.rmSync(IMP, { recursive: true, force: true })
  fs.rmSync(ORACLE, { recursive: true, force: true })
  citationCorpus(); editTarget(); longRefs(); relatedCorpus(); skills(); media(); scannedPdf(); pptOutline()
  await workbook()
  oracle()
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n')
  console.log('fixtures generated')
}
main().catch(e => { console.error(e); process.exit(1) })
