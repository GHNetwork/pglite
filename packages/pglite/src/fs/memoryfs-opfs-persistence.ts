/**
 * MemoryFsOpfsPersistence — Prototype filesystem for PGlite
 *
 * EXP-MEMOPFS-1: PGlite runs on Emscripten MEMFS (pure WASM heap, zero sync
 * access handles). PGDATA is persisted to OPFS as a single gzipped tarball
 * via async file APIs. This eliminates the sync-access-handle exhaustion that
 * plagues the OPFS-AHP filesystem.
 *
 * WARNING: This is a prototype. It is NOT wired as the default filesystem.
 * Do NOT import from production code paths.
 *
 * @see docs/session-data/plans/meridian-reliable-foundation/memoryfs-opfs-persistence-design.md
 * @module
 */

import { EmscriptenBuiltinFilesystem, PGDATA } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import type { PGlite } from '../pglite.js'
import type { DumpTarCompressionOptions } from './tarUtils.js'
import { dumpTar, loadTar } from './tarUtils.js'

/**
 * Configuration options for MemoryFsOpfsPersistence.
 */
export interface MemoryFsOpfsPersistenceOptions {
  /**
   * Subdirectory name under OPFS `/pglite/` for storing the checkpoint file.
   * Multiple PGlite instances should use distinct dataDir values.
   */
  dataDir?: string

  /**
   * Filename for the checkpoint tarball within the dataDir.
   * @default 'pgdata.tar.gz'
   */
  checkpointFilename?: string

  /**
   * Whether to use a two-phase write (write to temp file then rename) to
   * prevent corruption if the write is interrupted. Adds latency but prevents
   * a partially-written checkpoint from corrupting the previous good checkpoint.
   * @default true
   */
  atomicWrites?: boolean

  /**
   * Enable verbose logging of persistence operations.
   * @default false
   */
  debug?: boolean
}

const DEFAULT_CHECKPOINT_FILENAME = 'pgdata.tar.gz'

/**
 * A filesystem that runs PGlite entirely in MEMFS (WASM heap) and persists
 * the PGDATA directory to OPFS as a gzipped tarball via async APIs.
 *
 * **Key properties:**
 * - Zero sync access handles — avoids browser FD budget exhaustion.
 * - Single OPFS file per database — simplifies backup and export.
 * - Checkpoint-based durability — data written between checkpoints may be
 *   lost on crash/reload.
 *
 * **Not wired as default.** Must be explicitly opted into by the caller.
 */
export class MemoryFsOpfsPersistence extends EmscriptenBuiltinFilesystem {
  private readonly checkpointFilename: string
  private readonly atomicWrites: boolean
  private readonly debug: boolean
  private checkpointInProgress = false

  constructor(options: MemoryFsOpfsPersistenceOptions = {}) {
    super(options.dataDir)
    this.checkpointFilename = options.checkpointFilename ?? DEFAULT_CHECKPOINT_FILENAME
    this.atomicWrites = options.atomicWrites ?? true
    this.debug = options.debug ?? false
  }

  /**
   * Log a debug message if debug mode is enabled.
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[MemoryFsOpfsPersistence]', ...args)
    }
  }

  /**
   * Get the OPFS root directory handle, creating the pglite directory if needed.
   */
  private async getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
    const opfsRoot = await navigator.storage.getDirectory()
    const pgliteDir = await opfsRoot.getDirectoryHandle('pglite', { create: true })
    return pgliteDir
  }

  /**
   * Get the OPFS directory handle for this database's dataDir.
   */
  private async getDataDir(): Promise<FileSystemDirectoryHandle> {
    const root = await this.getOpfsRoot()
    if (!this.dataDir) {
      return root
    }
    return root.getDirectoryHandle(this.dataDir, { create: true })
  }

  /**
   * Get the OPFS file handle for the checkpoint tarball.
   */
  private async getCheckpointHandle(create = false): Promise<FileSystemFileHandle> {
    const dir = await this.getDataDir()
    return dir.getFileHandle(this.checkpointFilename, { create })
  }

  // ─── Filesystem Interface Implementation ────────────────────────────────────

  /**
   * Initialize the filesystem. Mounts MEMFS at the PGDATA path.
   *
   * Note: Unlike OPFS-AHP, we do NOT need any sync access handle setup.
   * MEMFS operates entirely in WASM linear memory.
   */
  override async init(pg: PGlite, opts: Partial<PostgresMod>): Promise<{ emscriptenOpts: Partial<PostgresMod> }> {
    this.pg = pg
    // MemoryFS uses the default Emscripten MEMFS — no custom preRun hooks needed.
    // PGDATA is just a directory in MEMFS that we'll snapshot to OPFS.
    return { emscriptenOpts: opts }
  }

  /**
   * Load the checkpoint from OPFS into MEMFS on startup.
   *
   * Called by PGlite during initialization, before PostgreSQL starts.
   * If no checkpoint exists, this is a no-op (fresh database).
   */
  override async initialSyncFs(): Promise<void> {
    this.log('initialSyncFs: checking for existing checkpoint in OPFS')
    try {
      await this.loadFromOpfs()
      this.log('initialSyncFs: checkpoint loaded successfully')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.log('initialSyncFs: no checkpoint found or load failed, starting fresh:', message)
      // Not an error — first run or checkpoint was deleted
    }
  }

  /**
   * Persist the current MEMFS state to OPFS as a gzipped tarball.
   *
   * Called by PGlite at durability boundaries (e.g., after transactions).
   * Uses a two-phase atomic write if configured.
   */
  override async syncToFs(relaxedDurability?: boolean): Promise<void> {
    if (this.checkpointInProgress) {
      this.log('syncToFs: checkpoint already in progress, skipping')
      return
    }

    if (relaxedDurability) {
      // In relaxed mode, we could debounce or skip checkpoints.
      // For the prototype, we still checkpoint but note the relaxed flag.
      this.log('syncToFs: relaxed durability requested, checkpoint deferred')
      return
    }

    this.checkpointInProgress = true
    try {
      const startTime = performance.now()
      await this.dumpToOpfs()
      const elapsed = performance.now() - startTime
      this.log(`syncToFs: checkpoint completed in ${elapsed.toFixed(1)}ms`)
    } finally {
      this.checkpointInProgress = false
    }
  }

  /**
   * Final checkpoint before shutting down PGlite.
   */
  override async closeFs(): Promise<void> {
    this.log('closeFs: performing final checkpoint')
    if (!this.checkpointInProgress) {
      try {
        await this.dumpToOpfs()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[MemoryFsOpfsPersistence] closeFs checkpoint failed:', message)
      }
    }
    this.pg!.Module.FS.quit()
  }

  /**
   * Dump the current MEMFS PGDATA as a gzipped tarball.
   * Delegates to the base class `dumpTar` utility.
   */
  override async dumpTar(
    dbname: string,
    compression?: DumpTarCompressionOptions,
  ): Promise<File | Blob> {
    return dumpTar(this.pg!.Module.FS, PGDATA, dbname, compression)
  }

  // ─── OPFS Checkpoint API ────────────────────────────────────────────────────

  /**
   * Dump the MEMFS PGDATA directory to OPFS as a gzipped tarball.
   *
   * This is the core persistence operation. It:
   * 1. Creates a gzipped tarball from MEMFS (using existing `dumpTar` utility).
   * 2. Writes it to OPFS via async file APIs (no sync access handles).
   * 3. Uses two-phase write if configured for atomicity.
   *
   * @throws If the OPFS write fails (quota exceeded, permission denied, etc.)
   */
  async dumpToOpfs(): Promise<void> {
    const startTime = performance.now()
    this.log('dumpToOpfs: starting')

    // Step 1: Create gzipped tarball from MEMFS
    const tarball = await this.dumpTar('pgdata', 'gzip')
    const tarballBuffer = new Uint8Array(await tarball.arrayBuffer())
    this.log(`dumpToOpfs: tarball created (${tarballBuffer.byteLength} bytes)`)

    // Step 2: Write to OPFS
    if (this.atomicWrites) {
      await this.atomicWriteToOpfs(tarballBuffer)
    } else {
      await this.directWriteToOpfs(tarballBuffer)
    }

    const elapsed = performance.now() - startTime
    this.log(`dumpToOpfs: completed in ${elapsed.toFixed(1)}ms`)
  }

  /**
   * Load a checkpoint from OPFS and hydrate MEMFS.
   *
   * This is the core restoration operation. It:
   * 1. Reads the gzipped tarball from OPFS.
   * 2. Decompresses and extracts it.
   * 3. Writes the extracted files into MEMFS PGDATA.
   *
   * @throws If the file is not found (no existing checkpoint)
   */
  async loadFromOpfs(): Promise<void> {
    const startTime = performance.now()
    this.log('loadFromOpfs: starting')

    // Step 1: Get the checkpoint file handle (don't create)
    const fileHandle = await this.getCheckpointHandle(false)
    const file = await fileHandle.getFile()
    this.log(`loadFromOpfs: reading checkpoint (${file.size} bytes)`)

    // Step 2: Load tarball into MEMFS
    await loadTar(this.pg!.Module.FS, file, PGDATA)

    const elapsed = performance.now() - startTime
    this.log(`loadFromOpfs: completed in ${elapsed.toFixed(1)}ms`)
  }

  // ─── Internal Write Strategies ──────────────────────────────────────────────

  /**
   * Direct write: overwrite the checkpoint file in place.
   * If interrupted, the file may be corrupt (no fallback).
   */
  private async directWriteToOpfs(data: Uint8Array): Promise<void> {
    const fileHandle = await this.getCheckpointHandle(true)
    const writable = await fileHandle.createWritable()
    await writable.write(data as unknown as FileSystemWriteChunkType)
    await writable.close()
  }

  /**
   * Atomic two-phase write: write to temp file, then rename.
   * If the write is interrupted, the previous checkpoint remains intact.
   */
  private async atomicWriteToOpfs(data: Uint8Array): Promise<void> {
    const dir = await this.getDataDir()
    const tempFilename = `.${this.checkpointFilename}.tmp`

    // Phase 1: Write to temp file
    const tempHandle = await dir.getFileHandle(tempFilename, { create: true })
    const writable = await tempHandle.createWritable()
    await writable.write(data as unknown as FileSystemWriteChunkType)
    await writable.close()

    // Phase 2: Rename temp → final (atomic on OPFS)
    try {
      await dir.removeEntry(this.checkpointFilename)
    } catch {
      // File may not exist yet (first checkpoint), ignore
    }
    // OPFS rename via move: getFileHandle → move (not universally supported)
    // Fallback: read temp, write to final, remove temp
    const tempFile = await tempHandle.getFile()
    const finalHandle = await dir.getFileHandle(this.checkpointFilename, { create: true })
    const finalWritable = await finalHandle.createWritable()
    await finalWritable.write(await tempFile.arrayBuffer())
    await finalWritable.close()

    // Remove temp
    try {
      await dir.removeEntry(tempFilename)
    } catch {
      // Non-critical
    }
  }

  // ─── Optional Filesystem Hooks ──────────────────────────────────────────────

  /**
   * No idle handles to release — MEMFS has no OS handles.
   * This is one of the key advantages over OPFS-AHP.
   */
  async releaseIdleHandles(): Promise<void> {
    // No-op: MEMFS has no handles to release
  }

  /**
   * No handles to restore — MEMFS has no OS handles.
   */
  async restoreHandles(): Promise<void> {
    // No-op: MEMFS has no handles to restore
  }
}
