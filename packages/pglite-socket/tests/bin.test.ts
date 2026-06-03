import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const binScript = path.resolve(__dirname, '../bin/pglite-server.js')
const packageJsonPath = path.resolve(__dirname, '../package.json')
const distScriptPath = path.resolve(__dirname, '../dist/scripts/server.js')
const workspacePGliteDistPath = path.resolve(
  __dirname,
  '../node_modules/@electric-sql/pglite/dist/index.js',
)

describe('pglite-server bin wrapper', () => {
  it('package metadata points the bin to a checked-in wrapper file', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const configuredBinPath = path.resolve(path.dirname(packageJsonPath), packageJson.bin['pglite-server'])

    expect(configuredBinPath).toBe(binScript)
    expect(existsSync(configuredBinPath)).toBe(true)
  })

  it('matches the current workspace CLI state', async () => {
    const child = spawn(process.execPath, [binScript, '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => {
        try {
          const hasWorkspacePGliteDist = existsSync(workspacePGliteDistPath)
          const hasSocketDistScript = existsSync(distScriptPath)

          if (!hasWorkspacePGliteDist) {
            expect(code).toBe(1)
            expect(stdout).toBe('')
            expect(stderr).toContain('Workspace CLI requires built @electric-sql/pglite dist assets')
          } else if (!hasSocketDistScript) {
            expect(code).toBe(1)
            expect(stdout).toBe('')
            expect(stderr).toContain('Missing CLI entrypoint: expected dist/scripts/server.js')
          } else {
            expect(code).toBe(0)
            expect(stderr).toBe('')
            expect(stdout).toContain('PGlite Socket Server')
            expect(stdout).toContain('Usage: pglite-server [options]')
          }
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  }, 10000)
})