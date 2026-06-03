#!/usr/bin/env node

import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distEntry = path.resolve(__dirname, '../dist/scripts/server.js')
const workspaceMarker = path.resolve(__dirname, '../tsconfig.json')
const workspacePGliteDistEntry = path.resolve(
  __dirname,
  '../node_modules/@electric-sql/pglite/dist/index.js',
)

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function run() {
  if ((await fileExists(workspaceMarker)) && !(await fileExists(workspacePGliteDistEntry))) {
    console.error('[pglite-socket] Workspace CLI requires built @electric-sql/pglite dist assets')
    process.exit(1)
  }

  if (await fileExists(distEntry)) {
    await import(pathToFileURL(distEntry).href)
    return
  }

  console.error('[pglite-socket] Missing CLI entrypoint: expected dist/scripts/server.js')
  process.exit(1)
}

run().catch((error) => {
  console.error(`[pglite-socket] Failed to start CLI: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})