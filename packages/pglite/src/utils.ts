import type { PGliteInterface, Transaction } from './interface.js'
import { serialize as serializeProtocol } from '@electric-sql/pg-protocol'
import { parseDescribeStatementResults } from './parse.js'
import { TEXT } from './types.js'

// =============================================================================
// DIAGNOSTIC LOGGING UTILITIES (Phase 1 - direct console logging)
// =============================================================================
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
const _stamp = (t0: number) => `+${(_now() - t0).toFixed(1)}ms`

export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

let wasmDownloadPromise: Promise<Response> | undefined
let wasmDownloadStartTime: number | undefined

export async function startWasmDownload() {
  if (IN_NODE) {
    console.debug('[PGliteInternal][wasm] startWasmDownload: skipped (Node.js environment)')
    return
  }
  if (wasmDownloadPromise) {
    console.debug('[PGliteInternal][wasm] startWasmDownload: already in progress, reusing existing promise')
    return
  }
  wasmDownloadStartTime = _now()
  const moduleUrl = new URL('../release/pglite.wasm', import.meta.url)
  console.debug(`[PGliteInternal][wasm] startWasmDownload: initiating fetch from ${moduleUrl.href}`)

  wasmDownloadPromise = fetch(moduleUrl).then((response) => {
    const elapsed = _stamp(wasmDownloadStartTime!)
    console.info(`[PGliteInternal][wasm] ${elapsed} fetch completed (status=${response.status}, ok=${response.ok}, type=${response.type})`)
    if (!response.ok) {
      console.error(`[PGliteInternal][wasm] ${elapsed} fetch FAILED: HTTP ${response.status} ${response.statusText}`)
    }
    return response
  }).catch((error) => {
    const elapsed = _stamp(wasmDownloadStartTime!)
    console.error(`[PGliteInternal][wasm] ${elapsed} fetch FAILED with error:`, error)
    throw error
  })
}

// This is a global cache of the PGlite Wasm module to avoid having to re-download or
// compile it on subsequent calls.
let cachedWasmModule: WebAssembly.Module | undefined

export async function instantiateWasm(
  imports: WebAssembly.Imports,
  module?: WebAssembly.Module,
): Promise<{
  instance: WebAssembly.Instance
  module: WebAssembly.Module
}> {
  const t0 = _now()
  const stamp = () => _stamp(t0)

  console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: entry (hasModule=${!!module}, hasCachedModule=${!!cachedWasmModule})`)

  if (module || cachedWasmModule) {
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: using ${module ? 'provided' : 'cached'} module, calling WebAssembly.instantiate()`)
    const instantiateStart = _now()
    const instance = await WebAssembly.instantiate(
      module || cachedWasmModule!,
      imports,
    )
    console.info(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: WebAssembly.instantiate() completed (took ${(_now() - instantiateStart).toFixed(1)}ms)`)
    return {
      instance,
      module: module || cachedWasmModule!,
    }
  }

  const moduleUrl = new URL('../release/pglite.wasm', import.meta.url)
  console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: no cached module, will load from ${moduleUrl.href}`)

  if (IN_NODE) {
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: Node.js path - reading file`)
    const fs = await import('fs/promises')
    const readStart = _now()
    const buffer = await fs.readFile(moduleUrl)
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: file read complete (${buffer.byteLength} bytes, took ${(_now() - readStart).toFixed(1)}ms)`)

    const instantiateStart = _now()
    const { module: newModule, instance } = await WebAssembly.instantiate(
      buffer,
      imports,
    )
    console.info(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: WebAssembly.instantiate() completed (took ${(_now() - instantiateStart).toFixed(1)}ms)`)
    cachedWasmModule = newModule
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: cached module for future use`)
    return {
      instance,
      module: newModule,
    }
  } else {
    // Browser path
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: browser path`)

    if (!wasmDownloadPromise) {
      console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: no existing download promise, starting fetch`)
      wasmDownloadPromise = fetch(moduleUrl)
    } else {
      console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: reusing existing download promise`)
    }

    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: awaiting wasmDownloadPromise...`)
    const responseWaitStart = _now()
    const response = await wasmDownloadPromise
    console.info(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: wasmDownloadPromise resolved (status=${response.status}, ok=${response.ok}, waited ${(_now() - responseWaitStart).toFixed(1)}ms)`)

    if (!response.ok) {
      console.error(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: WASM fetch failed with HTTP ${response.status}`)
    }

    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: calling WebAssembly.instantiateStreaming()...`)
    const streamingStart = _now()
    const { module: newModule, instance } =
      await WebAssembly.instantiateStreaming(response, imports)
    console.info(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: WebAssembly.instantiateStreaming() completed (took ${(_now() - streamingStart).toFixed(1)}ms)`)

    cachedWasmModule = newModule
    console.debug(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: cached module for future use`)
    console.info(`[PGliteInternal][wasm] ${stamp()} instantiateWasm: COMPLETE (total ${(_now() - t0).toFixed(1)}ms)`)
    return {
      instance,
      module: newModule,
    }
  }
}

export async function getFsBundle(): Promise<ArrayBuffer> {
  const t0 = _now()
  const stamp = () => _stamp(t0)

  const fsBundleUrl = new URL('../release/pglite.data', import.meta.url)
  console.debug(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: entry (url=${fsBundleUrl.href})`)

  if (IN_NODE) {
    console.debug(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: Node.js path - reading file`)
    const fs = await import('fs/promises')
    const readStart = _now()
    const fileData = await fs.readFile(fsBundleUrl)
    console.info(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: file read complete (${fileData.byteLength} bytes, took ${(_now() - readStart).toFixed(1)}ms)`)
    return fileData.buffer
  } else {
    console.debug(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: browser path - fetching`)
    const fetchStart = _now()
    const response = await fetch(fsBundleUrl)
    console.debug(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: fetch complete (status=${response.status}, ok=${response.ok}, took ${(_now() - fetchStart).toFixed(1)}ms)`)

    if (!response.ok) {
      console.error(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: fetch FAILED with HTTP ${response.status}`)
    }

    const arrayBufferStart = _now()
    const buffer = await response.arrayBuffer()
    console.info(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: arrayBuffer() complete (${buffer.byteLength} bytes, took ${(_now() - arrayBufferStart).toFixed(1)}ms)`)
    console.info(`[PGliteInternal][fsBundle] ${stamp()} getFsBundle: COMPLETE (total ${(_now() - t0).toFixed(1)}ms)`)
    return buffer
  }
}

export const uuid = (): string => {
  // best case, `crypto.randomUUID` is available
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (globalThis.crypto?.getRandomValues) {
    // `crypto.getRandomValues` is available even in non-secure contexts
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // fallback to Math.random, if the Crypto API is completely missing
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Set the 4 most significant bits to 0100
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Set the 2 most significant bits to 10

  const hexValues: string[] = []
  bytes.forEach((byte) => {
    hexValues.push(byte.toString(16).padStart(2, '0'))
  })

  return (
    hexValues.slice(0, 4).join('') +
    '-' +
    hexValues.slice(4, 6).join('') +
    '-' +
    hexValues.slice(6, 8).join('') +
    '-' +
    hexValues.slice(8, 10).join('') +
    '-' +
    hexValues.slice(10).join('')
  )
}

/**
 * Formats a query with parameters
 * Expects that any tables/relations referenced in the query exist in the database
 * due to requiring them to be present to describe the parameters types.
 * `tx` is optional, and to be used when formatQuery is called during a transaction.
 * @param pg - The PGlite instance
 * @param query - The query to format
 * @param params - The parameters to format the query with
 * @param tx - The transaction to use, defaults to the PGlite instance
 * @returns The formatted query
 */
export async function formatQuery(
  pg: PGliteInterface,
  query: string,
  params?: any[] | null,
  tx?: Transaction | PGliteInterface,
) {
  if (!params || params.length === 0) {
    // no params so no formatting needed
    return query
  }

  tx = tx ?? pg

  // Get the types of the parameters
  const messages = []
  try {
    await pg.execProtocol(serializeProtocol.parse({ text: query }), {
      syncToFs: false,
    })

    messages.push(
      ...(
        await pg.execProtocol(serializeProtocol.describe({ type: 'S' }), {
          syncToFs: false,
        })
      ).messages,
    )
  } finally {
    messages.push(
      ...(await pg.execProtocol(serializeProtocol.sync(), { syncToFs: false }))
        .messages,
    )
  }

  const dataTypeIDs = parseDescribeStatementResults(messages)

  // replace $1, $2, etc with  %1L, %2L, etc
  const subbedQuery = query.replace(/\$([0-9]+)/g, (_, num) => {
    return '%' + num + 'L'
  })

  const ret = await tx.query<{
    query: string
  }>(
    `SELECT format($1, ${params.map((_, i) => `$${i + 2}`).join(', ')}) as query`,
    [subbedQuery, ...params],
    { paramTypes: [TEXT, ...dataTypeIDs] },
  )
  return ret.rows[0].query
}

/**
 * Debounce a function to ensure that only one instance of the function is running at
 * a time.
 * - If the function is called while an instance is already running, the new
 * call is scheduled to run after the current instance completes.
 * - If there is already a scheduled call, it is replaced with the new call.
 * @param fn - The function to debounce
 * @returns A debounced version of the function
 */
export function debounceMutex<A extends any[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | void> {
  let next:
    | {
        args: A
        resolve: (value: R | void) => void
        reject: (reason?: any) => void
      }
    | undefined = undefined

  let isRunning = false
  const processNext = async () => {
    if (!next) {
      isRunning = false
      return
    }
    isRunning = true
    const { args, resolve, reject } = next
    next = undefined
    try {
      const ret = await fn(...args)
      resolve(ret)
    } catch (e) {
      reject(e)
    } finally {
      processNext()
    }
  }
  return async (...args: A) => {
    if (next) {
      next.resolve(undefined)
    }
    const promise = new Promise<R | void>((resolve, reject) => {
      next = { args, resolve, reject }
    })
    if (!isRunning) {
      processNext()
    }
    return promise
  }
}

/**
 * Postgresql handles quoted names as CaseSensitive and unquoted as lower case.
 * If input is quoted, returns an unquoted string (same casing)
 * If input is unquoted, returns a lower-case string
 */
export function toPostgresName(input: string): string {
  let output
  if (input.startsWith('"') && input.endsWith('"')) {
    // Postgres sensitive case
    output = input.substring(1, input.length - 1)
  } else {
    // Postgres case insensitive - all to lower
    output = input.toLowerCase()
  }
  return output
}
