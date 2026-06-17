import { BaseFilesystem, ERRNO_CODES, type FsStats } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import type { PGlite } from '../pglite.js'
import type { OpfsAhpOptions } from '../interface.js'
import { readTarFiles } from './tarUtils.js'
import { DIRTYPE, REGTYPE, type TarFile } from 'tinytar'

export { type OpfsAhpOptions } from '../interface.js'

const HANDLE_OPERATION_STALL_REPORT_MS = 5000
const DEFAULT_HANDLE_BATCH_SIZE = 50
const POOL_TELEMETRY_CHECKPOINT_INTERVAL = 50

interface PoolTelemetrySnapshot {
  checkpoint: string
  poolLen: number
  shSize: number
  fhSize: number
  unsyncedSize: number
  lastOp: string | null
  lastOpMs: number | null
  lastFileNumber: number | null
  totalFiles: number | null
  completedFiles: number | null
  timestamp: number
}

// Module-scope buffer for the most recent snapshot per checkpoint.
// Indexed by checkpoint name so consumers (Meridian, Playwright) can
// read the latest snapshot for any checkpoint via the globalThis export.
const __POOL_TELEMETRY_LAST__: Map<string, PoolTelemetrySnapshot> = new Map()

function emitPoolTelemetry(snapshot: PoolTelemetrySnapshot): void {
  __POOL_TELEMETRY_LAST__.set(snapshot.checkpoint, snapshot)
  console.info(
    `[OpfsAhpFS-pool-telemetry] ${JSON.stringify(snapshot)}`
  )
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
    ((globalThis as unknown as { window: Record<string, unknown> }).window).__MERIDIAN_OPFS_AHP_POOL_TELEMETRY__ =
      Object.fromEntries(__POOL_TELEMETRY_LAST__)
  }
}

// Initialize the globalThis export
if (typeof globalThis !== 'undefined') {
  (globalThis as { __MERIDIAN_OPFS_AHP_POOL_TELEMETRY__?: unknown }).__MERIDIAN_OPFS_AHP_POOL_TELEMETRY__ = {}
}

type DirectMaterializationSubstep =
  | 'getFileHandle(create)'
  | 'createSyncAccessHandle'
  | 'logical state insertion'
  | 'data write'
  | 'flush/close retained-open behavior'
  | 'checkpoint'

type DirectMaterializationSummaryReason = 'failure' | 'stall' | 'emergency-cleanup'

interface DirectMaterializationSubstepTiming {
  substep: DirectMaterializationSubstep
  ms: number
}

interface DirectMaterializationFileTiming {
  fileNumber: number
  totalFiles: number
  logicalPath: string
  bytes: number
  backingFilename?: string
  startedAt: number
  totalMs?: number
  activeSubstep?: DirectMaterializationSubstep
  substeps: DirectMaterializationSubstepTiming[]
}

interface DirectMaterializationSubstepStats {
  count: number
  totalMs: number
  maxMs: number
  bucketLe10Ms: number
  bucketLe100Ms: number
  bucketLe1000Ms: number
  bucketGt1000Ms: number
  slowest?: DirectMaterializationFileTiming
}

// TypeScript doesn't have a built-in type for FileSystemSyncAccessHandle
export interface FileSystemSyncAccessHandle {
  close(): void
  flush(): void
  getSize(): number
  read(buffer: BufferSource, options: { at: number }): number
  truncate(newSize: number): void
  write(buffer: BufferSource, options: { at: number }): number
}

// State

const STATE_FILE = 'state.txt'
const DATA_DIR = 'data'
const INITIAL_MODE = {
  DIR: 16384,
  FILE: 32768,
}

export interface State {
  root: DirectoryNode
  pool: PoolFilenames
}

export type PoolFilenames = Array<string>

declare global {
  // eslint-disable-next-line no-var
  var __MERIDIAN_OPFS_AHP_POOL_TELEMETRY__: Record<string, PoolTelemetrySnapshot> | undefined
}

// WAL

export interface WALEntry {
  opp: string
  args: any[]
}

// Node tree

export type NodeType = 'file' | 'directory'

interface BaseNode {
  type: NodeType
  lastModified: number
  mode: number
}

export interface FileNode extends BaseNode {
  type: 'file'
  backingFilename: string
}

export interface DirectoryNode extends BaseNode {
  type: 'directory'
  children: { [filename: string]: Node }
}

export type Node = FileNode | DirectoryNode

/**
 * PGlite OPFS access handle pool filesystem.
 * Opens a pool of sync access handles and then allocates them as needed.
 */
export class OpfsAhpFS extends BaseFilesystem {
  declare readonly dataDir: string
  readonly initialPoolSize: number
  readonly maintainedPoolSize: number
  readonly maintainRuntimePoolOnInit: boolean
  readonly maxConcurrentHandles: number
  readonly handleBatchDelayMs: number

  #opfsRootAh!: FileSystemDirectoryHandle
  #rootAh!: FileSystemDirectoryHandle
  #dataDirAh!: FileSystemDirectoryHandle

  #stateFH!: FileSystemFileHandle
  #stateSH!: FileSystemSyncAccessHandle

  #fh: Map<string, FileSystemFileHandle> = new Map()
  #sh: Map<string, FileSystemSyncAccessHandle> = new Map()
  #idleHandlesReleased = false

  #handleIdCounter = 0
  #openHandlePaths: Map<number, string> = new Map()
  #openHandleIds: Map<string, number> = new Map()

  #directMaterializationTimings: DirectMaterializationFileTiming[] = []
  #syncAccessHandleModeLogged = false

  state!: State
  lastCheckpoint = 0
  // [NMT CUSTOMIZATION] Reduced from 60 seconds to 5 seconds to minimize data loss window
  // RATIONALE: With the original 60-second interval, data changes could be lost if the user
  // closed the tab, reloaded the page, or the browser crashed before the checkpoint.
  // A 5-second interval provides much better durability while maintaining acceptable performance.
  // Combined with relaxedDurability: false, this ensures near-immediate data persistence.
  checkpointInterval = 1000 * 5 // 5 seconds (was 60 seconds)
  poolCounter = 0

  #unsyncedSH = new Set<FileSystemSyncAccessHandle>()

  constructor(
    dataDir: string,
    {
      // [NMT CUSTOMIZATION] Keep upstream pool defaults for generic OPFS-AHP
      // use. Pathways overrides these to bypass init preallocation while direct
      // materialization is validated.
      initialPoolSize = 1000,
      maintainedPoolSize = 100,
      maintainRuntimePoolOnInit = true,
      maxConcurrentHandles = DEFAULT_HANDLE_BATCH_SIZE,
      handleBatchDelayMs = 16,
      debug = false,
    }: OpfsAhpOptions = {},
  ) {
    super(dataDir, { debug })
    this.initialPoolSize = initialPoolSize
    this.maintainedPoolSize = maintainedPoolSize
    this.maintainRuntimePoolOnInit = maintainRuntimePoolOnInit
    this.maxConcurrentHandles = Math.max(1, Math.floor(maxConcurrentHandles))
    this.handleBatchDelayMs = Math.max(0, Math.floor(handleBatchDelayMs))
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    await this.#init()
    return super.init(pg, opts)
  }

  async syncToFs(relaxedDurability = false) {
    await this.maybeCheckpointState()
    await this.maintainPool()
    if (!relaxedDurability) {
      this.flush()
    }
  }

  get idleHandlesReleased(): boolean {
    return this.#idleHandlesReleased
  }

  async restoreHandles(): Promise<void> {
    if (!this.#idleHandlesReleased) {
      return
    }

    const filenames: string[] = []
    const restoreBackingFile = async (filename: string) => {
      if (this.#sh.has(filename)) {
        return
      }
      const fh = this.#fh.get(filename) ?? await this.#dataDirAh.getFileHandle(filename)
      const sh = await this.#createSyncAccessHandle(fh)
      this.#fh.set(filename, fh)
      this.#sh.set(filename, sh)
    }

    const walk = (node: Node) => {
      if (node.type === 'file') {
        filenames.push(node.backingFilename)
        return
      }
      for (const child of Object.values(node.children)) {
        walk(child)
      }
    }

    walk(this.state.root)
    for (const filename of this.state.pool) {
      filenames.push(filename)
    }

    await this.#runInHandleBatches(filenames, restoreBackingFile, 'restoring idle handles')
    this.#idleHandlesReleased = false
  }

  async releaseIdleHandles(): Promise<void> {
    if (this.#idleHandlesReleased || this.#sh.size === 0) {
      return
    }

    this.flush()

    let closedCount = 0
    for (const [filename, sh] of this.#sh.entries()) {
      try {
        sh.close()
        closedCount++
      } catch (e) {
        console.warn('[OpfsAhpFS] releaseIdleHandles: failed to close handle', filename, e)
      }
    }

    this.#sh.clear()
    this.#unsyncedSH.clear()
    this.#idleHandlesReleased = true

    if (closedCount > 0) {
      console.info(`[OpfsAhpFS] releaseIdleHandles: closed ${closedCount} idle sync access handles`)
    }
  }

  async loadDataDirFromTar(file: File | Blob, pgDataDir: string): Promise<void> {
    if (this.#pathExists(`${pgDataDir}/PG_VERSION`)) {
      throw new Error('Database already exists, cannot load from tarball')
    }

    const files = await readTarFiles(file)
    // EXP-G01 telemetry: pool state at loadDataDirFromTar entry
    emitPoolTelemetry({
      checkpoint: 'loadDataDirFromTar-start',
      poolLen: this.state.pool.length,
      shSize: this.#sh.size,
      fhSize: this.#fh.size,
      unsyncedSize: this.#unsyncedSH.size,
      lastOp: null,
      lastOpMs: null,
      lastFileNumber: null,
      totalFiles: files.length,
      completedFiles: null,
      timestamp: Date.now(),
    })
    console.info(`[OpfsAhpFS] direct materialization: importing ${files.length} tar entr${files.length === 1 ? 'y' : 'ies'}`)
    const materializationStart = Date.now()
    this.#directMaterializationTimings = []

    const regularFiles: TarFile[] = []
    for (const entry of files) {
      const filePath = pgDataDir + entry.name
      this.#ensureParentDirectories(filePath)

      if (entry.type === DIRTYPE) {
        this.#ensureDirectoryPath(filePath, entry.mode, entry.modifyTime)
        continue
      }
      if (entry.type !== REGTYPE) {
        continue
      }

      regularFiles.push(entry)
    }

    if (regularFiles.length > 0) {
      console.info(
        `[OpfsAhpFS] direct materialization: starting ${regularFiles.length} regular file(s) one file at a time`
      )
    }

    let importedRegularFiles = 0
    try {
      for (const [index, entry] of regularFiles.entries()) {
        const fileNumber = index + 1
        const filePath = pgDataDir + entry.name
        // EXP-G01 telemetry: every Nth file at loop entry
        if (index % POOL_TELEMETRY_CHECKPOINT_INTERVAL === 0) {
          emitPoolTelemetry({
            checkpoint: 'loadDataDirFromTar-file',
            poolLen: this.state.pool.length,
            shSize: this.#sh.size,
            fhSize: this.#fh.size,
            unsyncedSize: this.#unsyncedSH.size,
            lastOp: '#materializeRegularFileOnDemand',
            lastOpMs: null,
            lastFileNumber: fileNumber,
            totalFiles: regularFiles.length,
            completedFiles: importedRegularFiles,
            timestamp: Date.now(),
          })
        }
        const timing = this.#createDirectMaterializationTiming(
          fileNumber,
          regularFiles.length,
          filePath,
          entry.data.length,
        )
        const fileLabel =
          `direct materialization file ${fileNumber}/${regularFiles.length}: ` +
          `${entry.name} (${entry.data.length} bytes)`
        await this.#runHandleOperationWithDiagnostics(fileLabel, async () => {
          await this.#materializeRegularFileOnDemand(filePath, entry, timing)
        })
        timing.totalMs = Date.now() - timing.startedAt
        importedRegularFiles = fileNumber
        // EXP-G01 telemetry: post-materialization with measured cost (every Nth file)
        if (index % POOL_TELEMETRY_CHECKPOINT_INTERVAL === 0) {
          emitPoolTelemetry({
            checkpoint: 'loadDataDirFromTar-file-done',
            poolLen: this.state.pool.length,
            shSize: this.#sh.size,
            fhSize: this.#fh.size,
            unsyncedSize: this.#unsyncedSH.size,
            lastOp: '#materializeRegularFileOnDemand',
            lastOpMs: timing.totalMs ?? null,
            lastFileNumber: fileNumber,
            totalFiles: regularFiles.length,
            completedFiles: importedRegularFiles,
            timestamp: Date.now(),
          })
        }
        if (this.debug) {
          console.debug(`[OpfsAhpFS] ${this.#formatDirectMaterializationTiming(timing)}`)
        }
      }

      const checkpointTiming = this.#createDirectMaterializationTiming(
        importedRegularFiles,
        regularFiles.length,
        `${pgDataDir}/<checkpoint>`,
        0,
      )
      await this.#timeDirectMaterializationSubstep(
        checkpointTiming,
        'checkpoint',
        async () => { await this.checkpointState() },
      )
      checkpointTiming.totalMs = Date.now() - checkpointTiming.startedAt
      this.#validateMaterializedDataDir(pgDataDir)
      // EXP-G01 telemetry: after data dir validation
      emitPoolTelemetry({
        checkpoint: 'loadDataDirFromTar-checkpoint',
        poolLen: this.state.pool.length,
        shSize: this.#sh.size,
        fhSize: this.#fh.size,
        unsyncedSize: this.#unsyncedSH.size,
        lastOp: 'validateMaterializedDataDir',
        lastOpMs: checkpointTiming.totalMs ?? null,
        lastFileNumber: importedRegularFiles,
        totalFiles: regularFiles.length,
        completedFiles: importedRegularFiles,
        timestamp: Date.now(),
      })
    } catch (error) {
      this.#logDirectMaterializationTimingSummary('failure')
      ;(globalThis as { __MERIDIAN_OPFS_AHP_TIMING__?: unknown }).__MERIDIAN_OPFS_AHP_TIMING__ = {
        mode: 'direct-materialization',
        filesTotal: regularFiles.length,
        filesCompleted: importedRegularFiles,
        perFileMs: this.#directMaterializationTimings.map((t) => t.totalMs ?? 0),
        totalMs: Date.now() - materializationStart,
        terminalState: 'error',
        failureReason: error instanceof Error ? error.message : String(error),
      }
      if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
        ((globalThis as unknown as { window: Record<string, unknown> }).window).__MERIDIAN_OPFS_AHP_TIMING__ =
          (globalThis as { __MERIDIAN_OPFS_AHP_TIMING__?: unknown }).__MERIDIAN_OPFS_AHP_TIMING__
      }
      throw error
    }
    console.info(
      `[OpfsAhpFS] direct materialization: complete ` +
      `(${importedRegularFiles} regular file(s), ${Date.now() - materializationStart}ms total)`
    )
    ;(globalThis as { __MERIDIAN_OPFS_AHP_TIMING__?: unknown }).__MERIDIAN_OPFS_AHP_TIMING__ = {
      mode: 'direct-materialization',
      filesTotal: regularFiles.length,
      filesCompleted: importedRegularFiles,
      perFileMs: this.#directMaterializationTimings.map((t) => t.totalMs ?? 0),
      totalMs: Date.now() - materializationStart,
      terminalState: 'ok',
      failureReason: null,
    }
    if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
      ((globalThis as unknown as { window: Record<string, unknown> }).window).__MERIDIAN_OPFS_AHP_TIMING__ =
        (globalThis as { __MERIDIAN_OPFS_AHP_TIMING__?: unknown }).__MERIDIAN_OPFS_AHP_TIMING__
    }

    // Ensure a small runtime spare pool exists after materialization.
    // This was deliberately deferred from init so that direct materialization
    // does not pay a 1,500+ handle creation burst up-front.
    if (this.maintainedPoolSize > 0) {
      await this.maintainPool(this.maintainedPoolSize)
    }
    // EXP-G01 telemetry: end of loadDataDirFromTar
    emitPoolTelemetry({
      checkpoint: 'loadDataDirFromTar-end',
      poolLen: this.state.pool.length,
      shSize: this.#sh.size,
      fhSize: this.#fh.size,
      unsyncedSize: this.#unsyncedSH.size,
      lastOp: 'maintainPool',
      lastOpMs: null,
      lastFileNumber: importedRegularFiles,
      totalFiles: regularFiles.length,
      completedFiles: importedRegularFiles,
      timestamp: Date.now(),
    })
  }

  async #delayBetweenHandleBatches(): Promise<void> {
    if (this.handleBatchDelayMs <= 0) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, this.handleBatchDelayMs))
  }

  async #runHandleOperationWithDiagnostics(
    label: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const startedAt = Date.now()
    console.info(`[OpfsAhpFS] ${label}: starting`)

    let completed = false
    const stallTimer = setTimeout(() => {
      if (!completed) {
        console.warn(
          `[OpfsAhpFS] ${label}: still pending after ${HANDLE_OPERATION_STALL_REPORT_MS}ms`
        )
        this.#logDirectMaterializationTimingSummary('stall')
      }
    }, HANDLE_OPERATION_STALL_REPORT_MS)

    try {
      await operation()
      console.info(`[OpfsAhpFS] ${label}: completed in ${Date.now() - startedAt}ms`)
    } catch (error) {
      console.error(`[OpfsAhpFS] ${label}: failed after ${Date.now() - startedAt}ms`, error)
      throw error
    } finally {
      completed = true
      clearTimeout(stallTimer)
    }
  }

  async #runInHandleBatches<T>(
    items: readonly T[],
    operation: (item: T) => Promise<void>,
    label = 'handle batch operation',
  ): Promise<void> {
    const total = items.length
    if (total > 0) {
      console.info(
        `[OpfsAhpFS] ${label}: starting ${total} sequential operation(s) ` +
        `(batchSize=${this.maxConcurrentHandles}, delay=${this.handleBatchDelayMs}ms)`
      )
    }

    for (let offset = 0; offset < items.length; offset += this.maxConcurrentHandles) {
      const batch = items.slice(offset, offset + this.maxConcurrentHandles)
      const batchNumber = Math.floor(offset / this.maxConcurrentHandles) + 1
      const batchCount = Math.ceil(total / this.maxConcurrentHandles)
      const batchStart = Date.now()
      console.info(
        `[OpfsAhpFS] ${label}: starting batch ${batchNumber}/${batchCount} ` +
        `(items ${offset + 1}-${Math.min(offset + batch.length, total)} of ${total})`
      )
      for (const [index, item] of batch.entries()) {
        const itemNumber = offset + index + 1
        let completed = false
        const stallTimer = setTimeout(() => {
          if (!completed) {
            console.warn(
              `[OpfsAhpFS] ${label}: item ${itemNumber}/${total} still pending after ` +
              `${HANDLE_OPERATION_STALL_REPORT_MS}ms (batch ${batchNumber}/${batchCount})`
            )
          }
        }, HANDLE_OPERATION_STALL_REPORT_MS)

        try {
          await operation(item)
        } finally {
          completed = true
          clearTimeout(stallTimer)
        }
      }
      console.info(
        `[OpfsAhpFS] ${label}: completed ${Math.min(offset + batch.length, total)}/${total} ` +
        `(batch ${batchNumber}, ${Date.now() - batchStart}ms)`
      )
      if (offset + this.maxConcurrentHandles < items.length) {
        await this.#delayBetweenHandleBatches()
      }
    }
  }

  async #openBackingFile(filename: string): Promise<void> {
    const fh = await this.#dataDirAh.getFileHandle(filename)
    const sh = await this.#createSyncAccessHandle(fh)
    this.#fh.set(filename, fh)
    this.#sh.set(filename, sh)
  }

  async #createSyncAccessHandle(fh: FileSystemFileHandle): Promise<FileSystemSyncAccessHandle> {
    const createSyncAccessHandle = (fh as any).createSyncAccessHandle
    try {
      const sh = await createSyncAccessHandle.call(fh, { mode: 'readwrite-unsafe' })
      this.#logSyncAccessHandleMode('readwrite-unsafe')
      return sh
    } catch (error) {
      if (error instanceof TypeError) {
        const sh = await createSyncAccessHandle.call(fh)
        this.#logSyncAccessHandleMode('default')
        return sh
      }
      throw error
    }
  }

  async #createPoolFile(): Promise<void> {
    const filename = this.#nextBackingFilename()
    const fh = await this.#dataDirAh.getFileHandle(filename, {
      create: true,
    })
    const sh = await this.#createSyncAccessHandle(fh)
    this.#fh.set(filename, fh)
    this.#sh.set(filename, sh)
    this.#logWAL({
      opp: 'createPoolFile',
      args: [filename],
    })
    this.state.pool.push(filename)
  }

  async #deletePoolFile(): Promise<void> {
    const filename = this.state.pool.pop()!
    this.#logWAL({
      opp: 'deletePoolFile',
      args: [filename],
    })
    const fh = this.#fh.get(filename)!
    const sh = this.#sh.get(filename)
    sh?.close()
    await this.#dataDirAh.removeEntry(fh.name)
    this.#fh.delete(filename)
    this.#sh.delete(filename)
  }

  async closeFs(): Promise<void> {
    for (const sh of this.#sh.values()) {
      sh.close()
    }
    this.#stateSH.flush()
    this.#stateSH.close()
    this.pg!.Module.FS.quit()
  }

  // =============================================================================
  // [NMT CUSTOMIZATION] Emergency cleanup of all access handles
  // =============================================================================
  // RATIONALE: If PGlite crashes during initialization (e.g., _pgl_backend()
  // throws "RuntimeError: unreachable"), closeFs() is never called and all
  // OPFS-AHP sync access handles are leaked. This causes subsequent connection
  // attempts to fail with "NoModificationAllowedError: Access handle is already open".
  //
  // This method differs from closeFs() in that it:
  // 1. Catches and logs errors for each handle (doesn't throw on first error)
  // 2. Clears internal maps to prevent reuse of stale handles
  // 3. Does NOT call FS.quit() since the FS may be in an inconsistent state
  //
  // UPSTREAMABLE: This fixes a real bug where handles leak on crash.
  //
  // See: docs/debugging/pglite-opfs-root-cause-analysis.md
  // =============================================================================
  async emergencyCloseAllHandles(diagnosticsReason?: DirectMaterializationSummaryReason): Promise<void> {
    if (diagnosticsReason) {
      this.#logDirectMaterializationTimingSummary(diagnosticsReason)
    }

    console.info('[OpfsAhpFS] emergencyCloseAllHandles: starting emergency cleanup...')
    let closedCount = 0
    let errorCount = 0

    // Close all sync access handles from the main pool
    for (const [path, sh] of this.#sh.entries()) {
      try {
        sh.close()
        closedCount++
        console.debug(`[OpfsAhpFS] emergencyCloseAllHandles: closed handle for ${path}`)
      } catch (e) {
        console.warn(`[OpfsAhpFS] emergencyCloseAllHandles: error closing handle for ${path}:`, e)
        errorCount++
      }
    }
    this.#sh.clear()

    // Clear file handles map (these don't need explicit closing, but clear for consistency)
    this.#fh.clear()

    // Clear open handle tracking
    this.#openHandlePaths.clear()
    this.#openHandleIds.clear()

    // Close any unsynced handles
    for (const sh of this.#unsyncedSH) {
      try {
        sh.close()
        closedCount++
      } catch (e) {
        console.warn('[OpfsAhpFS] emergencyCloseAllHandles: error closing unsynced handle:', e)
        errorCount++
      }
    }
    this.#unsyncedSH.clear()

    // Close state handle (critical for releasing the lock on state.txt)
    if (this.#stateSH) {
      try {
        this.#stateSH.flush()
        this.#stateSH.close()
        console.debug('[OpfsAhpFS] emergencyCloseAllHandles: closed state handle')
        closedCount++
      } catch (e) {
        console.warn('[OpfsAhpFS] emergencyCloseAllHandles: error closing state handle:', e)
        errorCount++
      }
    }

    console.info(
      `[OpfsAhpFS] emergencyCloseAllHandles: complete (closed=${closedCount}, errors=${errorCount})`
    )
  }

  async #init() {
    // =============================================================================
    // [NMT CUSTOMIZATION] Handle creation logging for debugging
    // =============================================================================
    // RATIONALE: When debugging Access Handle leaks or initialization failures,
    // it's helpful to see exactly when handles are created. This logging helps
    // trace the handle lifecycle and identify where leaks occur.
    //
    // UPSTREAMABLE: Pure diagnostics, no behavior change.
    //
    // See: docs/debugging/pglite-opfs-root-cause-analysis.md
    // =============================================================================
    console.info(`[OpfsAhpFS] #init: starting OPFS-AHP initialization for dataDir=${this.dataDir}`)

    // EXP-G01 telemetry: baseline pool state at #init() entry
    emitPoolTelemetry({
      checkpoint: '#init-start',
      poolLen: this.state?.pool?.length ?? 0,
      shSize: this.#sh.size,
      fhSize: this.#fh.size,
      unsyncedSize: this.#unsyncedSH.size,
      lastOp: null,
      lastOpMs: null,
      lastFileNumber: null,
      totalFiles: null,
      completedFiles: null,
      timestamp: Date.now(),
    })

    this.#opfsRootAh = await navigator.storage.getDirectory()
    console.debug('[OpfsAhpFS] #init: got OPFS root directory handle')

    this.#rootAh = await this.#resolveOpfsDirectory(this.dataDir!, {
      create: true,
    })
    console.debug(`[OpfsAhpFS] #init: resolved root directory handle for ${this.dataDir}`)

    this.#dataDirAh = await this.#resolveOpfsDirectory(DATA_DIR, {
      from: this.#rootAh,
      create: true,
    })
    console.debug(`[OpfsAhpFS] #init: resolved data directory handle for ${DATA_DIR}`)

    this.#stateFH = await this.#rootAh.getFileHandle(STATE_FILE, {
      create: true,
    })
    console.debug(`[OpfsAhpFS] #init: got file handle for ${STATE_FILE}`)

    // This is a critical point - creating the sync access handle acquires an exclusive lock
    console.info('[OpfsAhpFS] #init: creating state sync access handle (exclusive lock)...')
    this.#stateSH = await this.#createSyncAccessHandle(this.#stateFH)
    console.info('[OpfsAhpFS] #init: state sync access handle created successfully')

    const stateAB = new ArrayBuffer(this.#stateSH.getSize())
    this.#stateSH.read(stateAB, { at: 0 })
    let state: State
    const stateLines = new TextDecoder().decode(stateAB).split('\n')
    // Line 1 is a base state object.
    // Lines 1+n are WAL entries.

    let isNewState = false
    try {
      state = JSON.parse(stateLines[0])
    } catch (e) {
      state = {
        root: {
          type: 'directory',
          lastModified: Date.now(),
          mode: INITIAL_MODE.DIR,
          children: {},
        },
        pool: [],
      }
      // write new state to file
      this.#stateSH.truncate(0)
      this.#stateSH.write(new TextEncoder().encode(JSON.stringify(state)), {
        at: 0,
      })
      isNewState = true
    }
    this.state = state
    console.info(
      `[OpfsAhpFS] #init: state loaded ` +
      `(isNewState=${isNewState}, pool=${this.state.pool.length}, walEntries=${Math.max(0, stateLines.length - 1)})`
    )

    // Apply WAL entries
    const wal = stateLines
      .slice(1)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    for (const entry of wal) {
      const methodName = `_${entry.opp}State`
      if (typeof this[methodName as keyof this] === 'function') {
        try {
          const method = this[methodName as keyof this] as any
          method.bind(this)(...entry.args)
        } catch (e) {
          console.warn('Error applying OPFS AHP WAL entry', entry, e)
        }
      }
    }
    console.info(`[OpfsAhpFS] #init: WAL replay complete (${wal.length} entr${wal.length === 1 ? 'y' : 'ies'})`)

    // Open all file handles for the dir tree using bounded batches. The sync
    // access handle API is async only at open time; PGlite requires the opened
    // handles before synchronous query IO.
    const backingFilenames: string[] = []
    const walk = (node: Node) => {
      if (node.type === 'file') {
        backingFilenames.push(node.backingFilename)
      } else {
        for (const child of Object.values(node.children)) {
          walk(child)
        }
      }
    }
    walk(this.state.root)
    console.info(`[OpfsAhpFS] #init: discovered ${backingFilenames.length} existing backing file handle(s) to open`)
    await this.#runInHandleBatches(
      backingFilenames,
      async (filename) => {
        try {
          await this.#openBackingFile(filename)
        } catch (e) {
          console.error('Error opening file handle for backing file', filename, e)
        }
      },
      'opening existing backing files',
    )

    // [NMT CUSTOMIZATION] Existing databases may have been created with a much
    // larger historical pool. Trim closed pool files before opening them so a
    // warm start does not transiently acquire hundreds/thousands of stale sync
    // access handles only to close them immediately afterwards.
    if (!isNewState) {
      console.info(`[OpfsAhpFS] #init: trimming closed pool files to maintained size ${this.maintainedPoolSize}`)
      await this.#trimClosedPoolFiles(this.maintainedPoolSize)
    }

    // Open remaining runtime spare pool file handles.
    console.info(`[OpfsAhpFS] #init: opening ${this.state.pool.length} retained pool handle(s)`)
    await this.#runInHandleBatches(
      this.state.pool,
      async (filename) => {
        if (this.#fh.has(filename)) {
          console.warn('File handle already exists for pool file', filename)
        }
        await this.#openBackingFile(filename)
      },
      'opening retained pool files',
    )

    if (isNewState) {
      console.info(`[OpfsAhpFS] #init: maintaining init preallocation pool to target size ${this.initialPoolSize}`)
      await this.maintainPool(this.initialPoolSize)
      // EXP-G01 telemetry: pool state after initial pool growth
      emitPoolTelemetry({
        checkpoint: '#init-after-maintainPool',
        poolLen: this.state.pool.length,
        shSize: this.#sh.size,
        fhSize: this.#fh.size,
        unsyncedSize: this.#unsyncedSH.size,
        lastOp: `maintainPool(${this.initialPoolSize})`,
        lastOpMs: null,
        lastFileNumber: null,
        totalFiles: null,
        completedFiles: null,
        timestamp: Date.now(),
      })
    } else if (this.maintainRuntimePoolOnInit) {
      console.info(`[OpfsAhpFS] #init: maintaining runtime spare pool to target size ${this.maintainedPoolSize}`)
      await this.maintainPool(this.maintainedPoolSize)
      // EXP-G01 telemetry: pool state after runtime pool maintenance
      emitPoolTelemetry({
        checkpoint: '#init-after-maintainedPool-runtime',
        poolLen: this.state.pool.length,
        shSize: this.#sh.size,
        fhSize: this.#fh.size,
        unsyncedSize: this.#unsyncedSH.size,
        lastOp: `maintainPool(${this.maintainedPoolSize})`,
        lastOpMs: null,
        lastFileNumber: null,
        totalFiles: null,
        completedFiles: null,
        timestamp: Date.now(),
      })
    } else {
      console.info(
        `[OpfsAhpFS] #init: skipping runtime spare pool growth during initialization ` +
        `(current=${this.state.pool.length}, target=${this.maintainedPoolSize})`
      )
    }
    console.info(
      `[OpfsAhpFS] #init: COMPLETE ` +
      `(pool=${this.state.pool.length}, openHandles=${this.#sh.size}, unsynced=${this.#unsyncedSH.size})`
    )
  }

  async maintainPool(size?: number) {
    const targetSize = size ?? this.maintainedPoolSize
    const change = targetSize - this.state.pool.length
    if (change > 0) {
      console.info(
        `[OpfsAhpFS] maintainPool: growing pool by ${change} ` +
        `(current=${this.state.pool.length}, target=${targetSize})`
      )
      // Populate work items without opening handles yet; #runInHandleBatches
      // owns sequential batching and per-item stall reporting.
      await this.#runInHandleBatches(
        Array.from({ length: change }),
        async () => { await this.#createPoolFile() },
        'creating retained pool files',
      )
      return
    }
    if (change < 0) {
      console.info(
        `[OpfsAhpFS] maintainPool: shrinking pool by ${Math.abs(change)} ` +
        `(current=${this.state.pool.length}, target=${targetSize})`
      )
      await this.#runInHandleBatches(
        Array.from({ length: Math.abs(change) }),
        async () => { await this.#deletePoolFile() },
        'deleting retained pool files',
      )
    }
  }

  async #trimClosedPoolFiles(size: number) {
    const targetSize = Math.max(0, size)
    const removeCount = this.state.pool.length - targetSize
    if (removeCount <= 0) {
      return
    }

    const failedRemovals: string[] = []
    for (let i = 0; i < removeCount; i++) {
      const filename = this.state.pool.pop()
      if (!filename) break

      try {
        await this.#dataDirAh.removeEntry(filename)
      } catch (e) {
        console.warn('Error trimming OPFS AHP pool file', filename, e)
        failedRemovals.push(filename)
      }
    }

    this.state.pool.push(...failedRemovals)
    await this.checkpointState()
  }

  _createPoolFileState(filename: string) {
    this.state.pool.push(filename)
  }

  _deletePoolFileState(filename: string) {
    const index = this.state.pool.indexOf(filename)
    if (index > -1) {
      this.state.pool.splice(index, 1)
    }
  }

  async maybeCheckpointState() {
    if (Date.now() - this.lastCheckpoint > this.checkpointInterval) {
      await this.checkpointState()
    }
  }

  async checkpointState() {
    const stateAB = new TextEncoder().encode(JSON.stringify(this.state))
    this.#stateSH.truncate(0)
    this.#stateSH.write(stateAB, { at: 0 })
    this.#stateSH.flush()
    this.lastCheckpoint = Date.now()
  }

  flush() {
    for (const sh of this.#unsyncedSH) {
      try {
        sh.flush()
      } catch (e) {
        // The file may have been closed if it was deleted
      }
    }
    this.#unsyncedSH.clear()
  }

  // Filesystem API:

  chmod(path: string, mode: number): void {
    this.#tryWithWAL({ opp: 'chmod', args: [path, mode] }, () => {
      this._chmodState(path, mode)
    })
  }

  _chmodState(path: string, mode: number): void {
    const node = this.#resolvePath(path)
    node.mode = mode
  }

  close(fd: number): void {
    const path = this.#getPathFromFd(fd)
    this.#openHandlePaths.delete(fd)
    this.#openHandleIds.delete(path)
  }

  fstat(fd: number): FsStats {
    const path = this.#getPathFromFd(fd)
    return this.lstat(path)
  }

  lstat(path: string): FsStats {
    const node = this.#resolvePath(path)
    const sh = node.type === 'file' ? this.#sh.get(node.backingFilename) : null
    if (node.type === 'file' && !sh) {
      throw new FsError('EBADF', 'OPFS-AHP sync access handles are not active')
    }
    const size =
      node.type === 'file' ? sh!.getSize() : 0
    const blksize = 4096
    return {
      dev: 0,
      ino: 0,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize,
      blocks: Math.ceil(size / blksize),
      atime: node.lastModified,
      mtime: node.lastModified,
      ctime: node.lastModified,
    }
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    this.#tryWithWAL({ opp: 'mkdir', args: [path, options] }, () => {
      this._mkdirState(path, options)
    })
  }

  _mkdirState(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): void {
    const parts = this.#pathParts(path)
    const newDirName = parts.pop()!
    const currentPath: string[] = []
    let node = this.state.root
    for (const part of parts) {
      currentPath.push(path)
      if (!Object.prototype.hasOwnProperty.call(node.children, part)) {
        if (options?.recursive) {
          this.mkdir(currentPath.join('/'))
        } else {
          throw new FsError('ENOENT', 'No such file or directory')
        }
      }
      if (node.children[part].type !== 'directory') {
        throw new FsError('ENOTDIR', 'Not a directory')
      }
      node = node.children[part] as DirectoryNode
    }
    if (Object.prototype.hasOwnProperty.call(node.children, newDirName)) {
      throw new FsError('EEXIST', 'File exists')
    }
    const newDir: DirectoryNode = {
      type: 'directory',
      lastModified: Date.now(),
      mode: options?.mode || INITIAL_MODE.DIR,
      children: {},
    }
    node.children[newDirName] = newDir
  }

  open(path: string, _flags?: string, _mode?: number): number {
    const node = this.#resolvePath(path)
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Is a directory')
    }
    const handleId = this.#nextHandleId()
    this.#openHandlePaths.set(handleId, path)
    this.#openHandleIds.set(path, handleId)
    return handleId
  }

  readdir(path: string): string[] {
    const node = this.#resolvePath(path)
    if (node.type !== 'directory') {
      throw new FsError('ENOTDIR', 'Not a directory')
    }
    return Object.keys(node.children)
  }

  read(
    fd: number,
    buffer: Uint8Array, // Buffer to read into
    offset: number, // Offset in buffer to start writing to
    length: number, // Number of bytes to read
    position: number, // Position in file to read from
  ): number {
    const path = this.#getPathFromFd(fd)
    const node = this.#resolvePath(path)
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Is a directory')
    }
    const sh = this.#sh.get(node.backingFilename)!
    return sh.read(new Uint8Array(buffer.buffer as ArrayBuffer, offset, length), {
      at: position,
    })
  }

  rename(oldPath: string, newPath: string): void {
    this.#tryWithWAL({ opp: 'rename', args: [oldPath, newPath] }, () => {
      this._renameState(oldPath, newPath, true)
    })
  }

  _renameState(oldPath: string, newPath: string, doFileOps = false): void {
    const oldPathParts = this.#pathParts(oldPath)
    const oldFilename = oldPathParts.pop()!
    const oldParent = this.#resolvePath(oldPathParts.join('/')) as DirectoryNode
    if (
      !Object.prototype.hasOwnProperty.call(oldParent.children, oldFilename)
    ) {
      throw new FsError('ENOENT', 'No such file or directory')
    }
    const newPathParts = this.#pathParts(newPath)
    const newFilename = newPathParts.pop()!
    const newParent = this.#resolvePath(newPathParts.join('/')) as DirectoryNode
    if (
      doFileOps &&
      Object.prototype.hasOwnProperty.call(newParent.children, newFilename)
    ) {
      // Overwrite, so return the underlying file to the pool
      const node = newParent.children[newFilename]! as FileNode
      const sh = this.#sh.get(node.backingFilename)!
      sh.truncate(0)
      this.state.pool.push(node.backingFilename)
    }
    newParent.children[newFilename] = oldParent.children[oldFilename]!
    delete oldParent.children[oldFilename]
  }

  rmdir(path: string): void {
    this.#tryWithWAL({ opp: 'rmdir', args: [path] }, () => {
      this._rmdirState(path)
    })
  }

  _rmdirState(path: string): void {
    const pathParts = this.#pathParts(path)
    const dirName = pathParts.pop()!
    const parent = this.#resolvePath(pathParts.join('/')) as DirectoryNode
    if (!Object.prototype.hasOwnProperty.call(parent.children, dirName)) {
      throw new FsError('ENOENT', 'No such file or directory')
    }
    const node = parent.children[dirName]!
    if (node.type !== 'directory') {
      throw new FsError('ENOTDIR', 'Not a directory')
    }
    if (Object.keys(node.children).length > 0) {
      throw new FsError('ENOTEMPTY', 'Directory not empty')
    }
    delete parent.children[dirName]
  }

  truncate(path: string, len = 0): void {
    const node = this.#resolvePath(path)
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Is a directory')
    }
    const sh = this.#sh.get(node.backingFilename)
    if (!sh) {
      throw new FsError('ENOENT', 'No such file or directory')
    }
    sh.truncate(len)
    this.#unsyncedSH.add(sh)
  }

  unlink(path: string): void {
    this.#tryWithWAL({ opp: 'unlink', args: [path] }, () => {
      this._unlinkState(path, true)
    })
  }

  _unlinkState(path: string, doFileOps = false): void {
    const pathParts = this.#pathParts(path)
    const filename = pathParts.pop()!
    const dir = this.#resolvePath(pathParts.join('/')) as DirectoryNode
    if (!Object.prototype.hasOwnProperty.call(dir.children, filename)) {
      throw new FsError('ENOENT', 'No such file or directory')
    }
    const node = dir.children[filename]!
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Is a directory')
    }
    delete dir.children[filename]
    if (doFileOps) {
      const sh = this.#sh.get(node.backingFilename)!
      // We don't delete the file, it's truncated and returned to the pool
      sh?.truncate(0)
      this.#unsyncedSH.add(sh)
      if (this.#openHandleIds.has(path)) {
        this.#openHandlePaths.delete(this.#openHandleIds.get(path)!)
        this.#openHandleIds.delete(path)
      }
    }
    this.state.pool.push(node.backingFilename)
  }

  utimes(path: string, atime: number, mtime: number): void {
    this.#tryWithWAL({ opp: 'utimes', args: [path, atime, mtime] }, () => {
      this._utimesState(path, atime, mtime)
    })
  }

  _utimesState(path: string, _atime: number, mtime: number): void {
    const node = this.#resolvePath(path)
    node.lastModified = mtime
  }

  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ): void {
    const pathParts = this.#pathParts(path)
    const filename = pathParts.pop()!
    const parent = this.#resolvePath(pathParts.join('/')) as DirectoryNode

    if (!Object.prototype.hasOwnProperty.call(parent.children, filename)) {
      if (this.state.pool.length === 0) {
        // EXP-G01 telemetry: critical evidence capture before pool exhaustion throw
        emitPoolTelemetry({
          checkpoint: 'writeFile-throw-no-pool',
          poolLen: this.state.pool.length,
          shSize: this.#sh.size,
          fhSize: this.#fh.size,
          unsyncedSize: this.#unsyncedSH.size,
          lastOp: 'writeFile',
          lastOpMs: null,
          lastFileNumber: null,
          totalFiles: null,
          completedFiles: null,
          timestamp: Date.now(),
        })
        throw new Error('No more file handles available in the pool')
      }
      const node: Node = {
        type: 'file',
        lastModified: Date.now(),
        mode: options?.mode || INITIAL_MODE.FILE,
        backingFilename: this.state.pool.pop()!,
      }
      parent.children[filename] = node
      this.#logWAL({
        opp: 'createFileNode',
        args: [path, node],
      })
    } else {
      const node = parent.children[filename] as FileNode
      node.lastModified = Date.now()
      this.#logWAL({
        opp: 'setLastModified',
        args: [path, node.lastModified],
      })
    }
    const node = parent.children[filename] as FileNode
    const sh = this.#sh.get(node.backingFilename)!
    // Files in pool are empty, only write if data is provided
    if (data.length > 0) {
      sh.write(
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : new Uint8Array(data),
        { at: 0 },
      )
      if (path.startsWith('/pg_wal')) {
        this.#unsyncedSH.add(sh)
      }
    }
  }

  _createFileNodeState(path: string, node: FileNode): FileNode {
    const pathParts = this.#pathParts(path)
    const filename = pathParts.pop()!
    const parent = this.#resolvePath(pathParts.join('/')) as DirectoryNode
    parent.children[filename] = node
    // remove backingFilename from pool
    const index = this.state.pool.indexOf(node.backingFilename)
    if (index > -1) {
      this.state.pool.splice(index, 1)
    }
    return node
  }

  _setLastModifiedState(path: string, lastModified: number): void {
    const node = this.#resolvePath(path)
    node.lastModified = lastModified
  }

  write(
    fd: number,
    buffer: Uint8Array, // Buffer to read from
    offset: number, // Offset in buffer to start reading from
    length: number, // Number of bytes to write
    position: number, // Position in file to write to
  ): number {
    const path = this.#getPathFromFd(fd)
    const node = this.#resolvePath(path)
    if (node.type !== 'file') {
      throw new FsError('EISDIR', 'Is a directory')
    }
    const sh = this.#sh.get(node.backingFilename)
    if (!sh) {
      throw new FsError('EBADF', 'Bad file descriptor')
    }
    // Note: buffer is actually an ArrayBuffer passed from base.ts (buffer.buffer)
    // This is intentional - base.ts extracts the underlying ArrayBuffer from Int8Array
    // and we create a Uint8Array view into it here
    const ret = sh.write(new Uint8Array(buffer as unknown as ArrayBuffer, offset, length), {
      at: position,
    })
    if (path.startsWith('/pg_wal')) {
      this.#unsyncedSH.add(sh)
    }
    return ret
  }

  // Internal methods:

  #nextBackingFilename(): string {
    ++this.poolCounter
    return `${(Date.now() - 1704063600).toString(16).padStart(8, '0')}-${this.poolCounter.toString(16).padStart(8, '0')}`
  }

  #pathExists(path: string): boolean {
    try {
      this.#resolvePath(path)
      return true
    } catch (error) {
      if (error instanceof FsError && error.code === ERRNO_CODES.ENOENT) {
        return false
      }
      throw error
    }
  }

  #ensureParentDirectories(path: string): void {
    const parts = this.#pathParts(path)
    parts.pop()
    this.#ensureDirectoryPath(parts.join('/'))
  }

  #ensureDirectoryPath(path: string, mode = INITIAL_MODE.DIR, modifyTime?: Date | number): DirectoryNode {
    let node = this.state.root
    const lastModified = this.#dateToUnixMs(modifyTime)
    for (const part of this.#pathParts(path)) {
      const existing = node.children[part]
      if (!existing) {
        const next: DirectoryNode = {
          type: 'directory',
          lastModified,
          mode: mode || INITIAL_MODE.DIR,
          children: {},
        }
        node.children[part] = next
        node = next
        continue
      }
      if (existing.type !== 'directory') {
        throw new FsError('ENOTDIR', 'Not a directory')
      }
      node = existing
    }
    return node
  }

  /**
   * Create a backing file and sync access handle for materialization.
   * Does NOT log a WAL entry or add to the pool — materialized files are
   * part of the persisted directory tree, not spare pool entries.
   */
  async #createMaterializedBackingFile(timing: DirectMaterializationFileTiming): Promise<string> {
    const filename = this.#nextBackingFilename()
    timing.backingFilename = filename
    const fh = await this.#timeDirectMaterializationSubstep(
      timing,
      'getFileHandle(create)',
      async () => await this.#dataDirAh.getFileHandle(filename, {
        create: true,
      }),
    )
    const sh = await this.#timeDirectMaterializationSubstep(
      timing,
      'createSyncAccessHandle',
      async () => await this.#createSyncAccessHandle(fh),
    )
    this.#fh.set(filename, fh)
    this.#sh.set(filename, sh)
    return filename
  }

  async #materializeRegularFileOnDemand(
    path: string,
    file: TarFile,
    timing: DirectMaterializationFileTiming,
  ): Promise<void> {
    // EXP-G01 telemetry: start of per-file materialization
    emitPoolTelemetry({
      checkpoint: '#materializeRegularFileOnDemand-start',
      poolLen: this.state.pool.length,
      shSize: this.#sh.size,
      fhSize: this.#fh.size,
      unsyncedSize: this.#unsyncedSH.size,
      lastOp: '#materializeRegularFileOnDemand',
      lastOpMs: null,
      lastFileNumber: timing.fileNumber,
      totalFiles: timing.totalFiles,
      completedFiles: null,
      timestamp: Date.now(),
    })
    const pathParts = this.#pathParts(path)
    const filename = pathParts.pop()!
    const parent = this.#ensureDirectoryPath(pathParts.join('/'))
    if (Object.prototype.hasOwnProperty.call(parent.children, filename)) {
      throw new FsError('EEXIST', `File already exists during direct materialization: ${path}`)
    }

    // Create a backing file on demand instead of pulling from a pre-grown pool.
    // This avoids the 1,500+ handle creation burst that stalls browsers during
    // direct materialization while still keeping the fast write-through-handle path.
    const backingFilename = await this.#createMaterializedBackingFile(timing)
    const sh = this.#sh.get(backingFilename)
    if (!sh) {
      throw new FsError('EBADF', `Missing sync access handle for backing file: ${backingFilename}`)
    }

    this.#timeDirectMaterializationSubstep(timing, 'logical state insertion', () => {
      parent.children[filename] = {
        type: 'file',
        lastModified: this.#dateToUnixMs(file.modifyTime),
        mode: file.mode || INITIAL_MODE.FILE,
        backingFilename,
      }
    })

    if (file.data.length > 0) {
      this.#timeDirectMaterializationSubstep(timing, 'data write', () => {
        sh.write(new Uint8Array(file.data), { at: 0 })
      })
      this.#timeDirectMaterializationSubstep(timing, 'flush/close retained-open behavior', () => {
        // Direct materialization intentionally keeps handles open for the PGlite runtime.
        // WAL writes remain marked unsynced; no per-file flush/close is performed here.
        if (path.startsWith('/pg_wal')) {
          this.#unsyncedSH.add(sh)
        }
      })
    } else {
      this.#timeDirectMaterializationSubstep(timing, 'data write', () => {})
      this.#timeDirectMaterializationSubstep(timing, 'flush/close retained-open behavior', () => {})
    }
    // EXP-G01 telemetry: end of per-file materialization with measured cost
    emitPoolTelemetry({
      checkpoint: '#materializeRegularFileOnDemand-end',
      poolLen: this.state.pool.length,
      shSize: this.#sh.size,
      fhSize: this.#fh.size,
      unsyncedSize: this.#unsyncedSH.size,
      lastOp: '#materializeRegularFileOnDemand',
      lastOpMs: Date.now() - timing.startedAt,
      lastFileNumber: timing.fileNumber,
      totalFiles: timing.totalFiles,
      completedFiles: timing.fileNumber,
      timestamp: Date.now(),
    })
  }

  #createDirectMaterializationTiming(
    fileNumber: number,
    totalFiles: number,
    logicalPath: string,
    bytes: number,
  ): DirectMaterializationFileTiming {
    const timing: DirectMaterializationFileTiming = {
      fileNumber,
      totalFiles,
      logicalPath,
      bytes,
      startedAt: Date.now(),
      substeps: [],
    }
    this.#directMaterializationTimings.push(timing)
    return timing
  }

  async #timeDirectMaterializationSubstep<T>(
    timing: DirectMaterializationFileTiming,
    substep: DirectMaterializationSubstep,
    operation: () => Promise<T>,
  ): Promise<T>
  #timeDirectMaterializationSubstep<T>(
    timing: DirectMaterializationFileTiming,
    substep: DirectMaterializationSubstep,
    operation: () => T,
  ): T
  #timeDirectMaterializationSubstep<T>(
    timing: DirectMaterializationFileTiming,
    substep: DirectMaterializationSubstep,
    operation: () => T | Promise<T>,
  ): T | Promise<T> {
    const startedAt = Date.now()
    timing.activeSubstep = substep
    const finish = () => {
      timing.substeps.push({ substep, ms: Date.now() - startedAt })
      if (timing.activeSubstep === substep) {
        delete timing.activeSubstep
      }
    }

    try {
      const result = operation()
      if (result instanceof Promise) {
        return result.finally(finish)
      }
      finish()
      return result
    } catch (error) {
      finish()
      throw error
    }
  }

  #logDirectMaterializationTimingSummary(reason: DirectMaterializationSummaryReason): void {
    if (this.#directMaterializationTimings.length === 0) {
      return
    }

    const stats = new Map<DirectMaterializationSubstep, DirectMaterializationSubstepStats>()
    for (const timing of this.#directMaterializationTimings) {
      for (const substepTiming of timing.substeps) {
        const current = stats.get(substepTiming.substep) ?? {
          count: 0,
          totalMs: 0,
          maxMs: 0,
          bucketLe10Ms: 0,
          bucketLe100Ms: 0,
          bucketLe1000Ms: 0,
          bucketGt1000Ms: 0,
        }
        current.count++
        current.totalMs += substepTiming.ms
        if (substepTiming.ms <= 10) current.bucketLe10Ms++
        else if (substepTiming.ms <= 100) current.bucketLe100Ms++
        else if (substepTiming.ms <= 1000) current.bucketLe1000Ms++
        else current.bucketGt1000Ms++
        if (substepTiming.ms > current.maxMs) {
          current.maxMs = substepTiming.ms
          current.slowest = timing
        }
        stats.set(substepTiming.substep, current)
      }
    }

    const histogram = Array.from(stats.entries()).map(([substep, stat]) => {
      const avgMs = stat.count === 0 ? 0 : Math.round(stat.totalMs / stat.count)
      const slowest = stat.slowest
        ? `slowest=file ${stat.slowest.fileNumber}/${stat.slowest.totalFiles} ` +
          `${stat.slowest.logicalPath} backing=${stat.slowest.backingFilename ?? 'n/a'}`
        : 'slowest=n/a'
      return `${substep}: count=${stat.count}, avg=${avgMs}ms, max=${stat.maxMs}ms, ` +
        `buckets(<=10/<=100/<=1000/>1000ms)=` +
        `${stat.bucketLe10Ms}/${stat.bucketLe100Ms}/${stat.bucketLe1000Ms}/${stat.bucketGt1000Ms}, ${slowest}`
    })

    console.warn(
      `[OpfsAhpFS] direct materialization ${reason} substep timing histogram: ` +
      (histogram.length > 0 ? histogram.join(' | ') : 'no completed substeps')
    )

    const active = this.#directMaterializationTimings.find((timing) => timing.activeSubstep)
    if (active) {
      console.warn(
        `[OpfsAhpFS] direct materialization active operation: ` +
        `file=${active.fileNumber}/${active.totalFiles}, logicalPath=${active.logicalPath}, ` +
        `bytes=${active.bytes}, backing=${active.backingFilename ?? 'n/a'}, ` +
        `activeSubstep=${active.activeSubstep}, elapsed=${Date.now() - active.startedAt}ms`
      )
    }
  }

  #formatDirectMaterializationTiming(timing: DirectMaterializationFileTiming): string {
    const substeps = timing.substeps
      .map(({ substep, ms }) => `${substep}=${ms}ms`)
      .join(', ')
    return `direct materialization timing: file=${timing.fileNumber}/${timing.totalFiles}, ` +
      `logicalPath=${timing.logicalPath}, bytes=${timing.bytes}, ` +
      `backing=${timing.backingFilename ?? 'n/a'}, total=${timing.totalMs ?? 'n/a'}ms, ` +
      `substeps=[${substeps}]`
  }

  #logSyncAccessHandleMode(mode: 'readwrite-unsafe' | 'default'): void {
    if (this.#syncAccessHandleModeLogged) {
      return
    }
    this.#syncAccessHandleModeLogged = true
    if (mode === 'readwrite-unsafe') {
      console.info('[OpfsAhpFS] createSyncAccessHandle: readwrite-unsafe mode succeeded')
    } else {
      console.warn('[OpfsAhpFS] createSyncAccessHandle: readwrite-unsafe unsupported; fell back to default mode')
    }
  }

  #validateMaterializedDataDir(pgDataDir: string): void {
    const missing = ['PG_VERSION', 'postgresql.conf', 'base', 'global', 'global/pg_control']
      .filter((requiredPath) => !this.#pathExists(`${pgDataDir}/${requiredPath}`))
    if (missing.length > 0) {
      throw new Error(`Invalid PGlite datadir: missing required paths: ${missing.join(', ')}`)
    }

    const pgControl = this.#resolvePath(`${pgDataDir}/global/pg_control`)
    if (pgControl.type !== 'file') {
      throw new Error('Invalid PGlite datadir: global/pg_control is not a file')
    }
    const sh = this.#sh.get(pgControl.backingFilename)
    if (!sh || sh.getSize() < 20) {
      throw new Error(`Invalid PGlite datadir: global/pg_control is too small (${sh?.getSize() ?? 0} bytes)`)
    }
  }

  #dateToUnixMs(date: Date | number | undefined): number {
    if (!date) return Date.now()
    return typeof date === 'number' ? date * 1000 : date.getTime()
  }

  #tryWithWAL(entry: WALEntry, fn: () => void) {
    const offset = this.#logWAL(entry)
    try {
      fn()
    } catch (e) {
      // Rollback WAL entry
      this.#stateSH.truncate(offset)
      throw e
    }
  }

  #logWAL(entry: WALEntry) {
    const entryJSON = JSON.stringify(entry)
    const stateAB = new TextEncoder().encode(`\n${entryJSON}`)
    const offset = this.#stateSH.getSize()
    this.#stateSH.write(stateAB, { at: offset })
    this.#unsyncedSH.add(this.#stateSH)
    return offset
  }

  #pathParts(path: string): string[] {
    return path.split('/').filter(Boolean)
  }

  #resolvePath(path: string, from?: DirectoryNode): Node {
    const parts = this.#pathParts(path)
    let node: Node = from || this.state.root
    for (const part of parts) {
      if (node.type !== 'directory') {
        throw new FsError('ENOTDIR', 'Not a directory')
      }
      if (!Object.prototype.hasOwnProperty.call(node.children, part)) {
        throw new FsError('ENOENT', 'No such file or directory')
      }
      node = node.children[part]!
    }
    return node
  }

  #getPathFromFd(fd: number): string {
    const path = this.#openHandlePaths.get(fd)
    if (!path) {
      throw new FsError('EBADF', 'Bad file descriptor')
    }
    return path
  }

  #nextHandleId(): number {
    const id = ++this.#handleIdCounter
    while (this.#openHandlePaths.has(id)) {
      this.#handleIdCounter++
    }
    return id
  }

  async #resolveOpfsDirectory(
    path: string,
    options?: {
      from?: FileSystemDirectoryHandle
      create?: boolean
    },
  ): Promise<FileSystemDirectoryHandle> {
    const parts = this.#pathParts(path)
    let ah = options?.from || this.#opfsRootAh
    for (const part of parts) {
      ah = await ah.getDirectoryHandle(part, { create: options?.create })
    }
    return ah
  }
}

class FsError extends Error {
  code?: number
  constructor(code: number | keyof typeof ERRNO_CODES | null, message: string) {
    super(message)
    if (typeof code === 'number') {
      this.code = code
    } else if (typeof code === 'string') {
      this.code = ERRNO_CODES[code]
    }
  }
}
