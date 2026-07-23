#!/usr/bin/env node
/**
 * Local OpenAI-compatible mock server for testing the AI commit flow.
 * Any POST (e.g. /chat/completions) waits 5s, then returns a valid chat
 * completion — long enough to watch the "正在生成提交信息…" spinner.
 *
 *   node scripts/mock-ai-server.mjs           # listens on http://127.0.0.1:8787
 *   PORT=9000 node scripts/mock-ai-server.mjs
 *
 * Point GDP AI settings at:  Base URL = http://127.0.0.1:8787/v1  (key = anything)
 */
import http from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const DELAY_MS = Number(process.env.DELAY_MS || 5000)

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true,"hint":"POST /chat/completions"}')
    return
  }

  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let model = 'mock-model'
    try { model = JSON.parse(body).model || model } catch { /* ignore */ }
    console.log(`[mock-ai] ${req.url} model=${model} — replying in ${DELAY_MS}ms`)

    setTimeout(() => {
      const payload = {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: 0,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                'feat: 接入自定义 AI 生成提交信息\n\n' +
                '这是来自本地 mock server 的示例提交描述，用于验证生成流程与加载动画。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }, DELAY_MS)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-ai] listening on http://127.0.0.1:${PORT} (delay ${DELAY_MS}ms)`)
})
