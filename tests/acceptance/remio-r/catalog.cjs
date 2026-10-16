#!/usr/bin/env node
// 由 cases.json 重新生成 docs/TEST-PLAN-REMIO-R.md 的第七、八节（人工/真实用例步骤与完整目录）。
// 用法：node tests/acceptance/remio-r/catalog.cjs
const fs = require('node:fs')
const path = require('node:path')
const REPO = path.resolve(__dirname, '../../..')
const DOC = path.join(REPO, 'docs/TEST-PLAN-REMIO-R.md')
const MARK = '## 七、人工与真实服务用例'
const { cases } = require('./cases.json')

const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const list = a => a.map((x, i) => `${i + 1}. ${cell(x)}`).join('<br>')

const manual = cases.filter(c => c.level === 'MANUAL' || c.level === 'REAL')
const sec7 = [
  MARK, '',
  '见下表（由 `cases.json` 生成）。执行时在报告 `report.json` 对应条目补写结论、截图路径与执行人，或单独记录到 `docs/VISUAL-ACCEPTANCE.md`。', '',
  '| ID | 级别 | 平台 | 标题 | 步骤 | 期望 |', '|---|---|---|---|---|---|',
  ...manual.map(c => `| ${c.id} | ${c.level} | ${c.env} | ${cell(c.title)} | ${list(c.steps)} | ${list(c.expected)} |`), ''
]

const tasks = [...new Set(cases.map(c => c.task))]
const counts = t => cases.filter(c => c.task === t).reduce((m, c) => ((m[c.level] = (m[c.level] ?? 0) + 1), m), {})
const sec8 = ['## 八、完整用例目录', '', '| 任务 | 用例数 | 级别分布 |', '|---|---|---|',
  ...tasks.map(t => `| ${t} | ${cases.filter(c => c.task === t).length} | ${Object.entries(counts(t)).map(([k, v]) => `${k} ${v}`).join('，')} |`), '']
for (const t of tasks) {
  sec8.push(`### ${t}`, '', '| ID | 级别 | 平台 | 标题 | 期望 | 依据 |', '|---|---|---|---|---|---|')
  for (const c of cases.filter(x => x.task === t)) sec8.push(`| ${c.id} | ${c.level} | ${c.env} | ${cell(c.title)} | ${list(c.expected)} | ${cell(c.ref ?? '')} |`)
  sec8.push('')
}

const doc = fs.readFileSync(DOC, 'utf-8')
const at = doc.indexOf(MARK)
if (at < 0) throw new Error('找不到第七节标记')
fs.writeFileSync(DOC, doc.slice(0, at) + [...sec7, ...sec8].join('\n'))
console.log(`已生成：人工/真实 ${manual.length} 条，目录 ${cases.length} 条`)
