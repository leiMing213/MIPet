import { execSync } from 'node:child_process'

delete process.env.ELECTRON_RUN_AS_NODE

execSync('npx electron-vite dev', {
  stdio: 'inherit',
  env: process.env
})
