import { ensureWslAgent } from './lib/wsl-agent'

ensureWslAgent().catch(error => {
  console.error('[wsl-agent] build failed')
  console.error(error)
  process.exitCode = 1
})
