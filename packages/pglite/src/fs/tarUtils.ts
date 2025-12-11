import { tar, untar, type TarFile, REGTYPE, DIRTYPE } from 'tinytar'
import type { FS } from '../postgresMod.js'

export type DumpTarCompressionOptions = 'none' | 'gzip' | 'auto'

export async function dumpTar(
  FS: FS,
  pgDataDir: string,
  dbname: string = 'pgdata',
  compression: DumpTarCompressionOptions = 'auto',
): Promise<File | Blob> {
  const tarball = createTarball(FS, pgDataDir)
  const [compressed, zipped] = await maybeZip(tarball, compression)
  const filename = dbname + (zipped ? '.tar.gz' : '.tar')
  const type = zipped ? 'application/x-gzip' : 'application/x-tar'
  if (typeof File !== 'undefined') {
    return new File([compressed as BlobPart], filename, {
      type,
    })
  } else {
    return new Blob([compressed as BlobPart], {
      type,
    })
  }
}

const compressedMimeTypes = [
  'application/x-gtar',
  'application/x-tar+gzip',
  'application/x-gzip',
  'application/gzip',
]

export async function loadTar(
  FS: FS,
  file: File | Blob,
  pgDataDir: string,
): Promise<void> {
  let tarball = new Uint8Array(await file.arrayBuffer())
  const filename =
    typeof File !== 'undefined' && file instanceof File ? file.name : undefined
  const compressed =
    compressedMimeTypes.includes(file.type) ||
    filename?.endsWith('.tgz') ||
    filename?.endsWith('.tar.gz')
  if (compressed) {
    tarball = await unzip(tarball) as Uint8Array<ArrayBuffer>
  }

  let files
  try {
    files = untar(tarball)
  } catch (e) {
    if (e instanceof Error && e.message.includes('File is corrupted')) {
      // The file may be compressed, but had the wrong mime type, try unzipping it
      tarball = await unzip(tarball) as Uint8Array<ArrayBuffer>
      files = untar(tarball)
    } else {
      throw e
    }
  }

  // [NMT CUSTOMIZATION] Track pg_control extraction for debugging
  let pgControlExtracted = false
  let pgControlDataSize = 0

  for (const file of files) {
    const filePath = pgDataDir + file.name

    // Ensure the directory structure exists
    const dirPath = filePath.split('/').slice(0, -1)
    for (let i = 1; i <= dirPath.length; i++) {
      const dir = dirPath.slice(0, i).join('/')
      if (!FS.analyzePath(dir).exists) {
        FS.mkdir(dir)
      }
    }

    // Write the file or directory
    if (file.type === REGTYPE) {
      // [NMT CUSTOMIZATION] Log pg_control extraction details
      if (file.name.endsWith('pg_control') || file.name.includes('/pg_control')) {
        pgControlExtracted = true
        pgControlDataSize = file.data?.length ?? 0
        console.info(
          `[loadTar] Extracting pg_control: name="${file.name}", ` +
          `tarball.size=${file.size ?? 'undefined'}, ` +
          `data.length=${pgControlDataSize}, ` +
          `data is Uint8Array=${file.data instanceof Uint8Array}`
        )
        if (pgControlDataSize > 0 && pgControlDataSize < 100) {
          // Log first few bytes if file is suspiciously small
          console.warn(`[loadTar] pg_control data is suspiciously small! First bytes:`,
            Array.from(file.data.slice(0, Math.min(20, pgControlDataSize))).map(b => b.toString(16).padStart(2, '0')).join(' ')
          )
        } else if (pgControlDataSize === 0) {
          console.error(`[loadTar] pg_control has ZERO data bytes! This will cause _pgl_backend to crash.`)
        }
      }

      FS.writeFile(filePath, file.data)

      // [NMT CUSTOMIZATION] Verify pg_control was written correctly
      if (file.name.endsWith('pg_control') || file.name.includes('/pg_control')) {
        try {
          const stat = FS.stat(filePath)
          console.info(`[loadTar] pg_control stat after write: size=${stat.size}, mode=${stat.mode}`)
          if (stat.size === 0) {
            console.error(`[loadTar] CRITICAL: pg_control has 0 bytes after FS.writeFile! Write failed silently.`)
          } else if (stat.size !== file.data.length) {
            console.warn(`[loadTar] pg_control size mismatch: expected ${file.data.length}, got ${stat.size}`)
          }
        } catch (e) {
          console.error(`[loadTar] Failed to stat pg_control after write:`, e)
        }
      }

      FS.utime(
        filePath,
        dateToUnixTimestamp(file.modifyTime),
        dateToUnixTimestamp(file.modifyTime),
      )
    } else if (file.type === DIRTYPE) {
      FS.mkdir(filePath)
    }
  }

  // [NMT CUSTOMIZATION] Verify pg_control was extracted
  if (!pgControlExtracted) {
    console.error(`[loadTar] pg_control was NOT found in tarball! Files extracted: ${files.length}`)
  } else {
    console.info(`[loadTar] pg_control extraction complete: ${pgControlDataSize} bytes written`)
  }

  // =============================================================================
  // [NMT CUSTOMIZATION] Post-load validation and pg_control state logging
  // =============================================================================
  // RATIONALE: When using loadDataDir with a prebuilt tarball, _pgl_backend()
  // can crash with "RuntimeError: unreachable" if the datadir is invalid or
  // has an unexpected pg_control state. By validating immediately after load
  // and logging the pg_control state, we can:
  // 1. Fail fast on corrupt/incomplete tarballs before initdb runs
  // 2. Capture diagnostic info about the database state for debugging
  //
  // UPSTREAMABLE: This improves error messages and debugging for all users
  // of loadDataDir, especially when using dumpDataDir-generated tarballs.
  //
  // See: docs/debugging/pglite-opfs-root-cause-analysis.md
  // =============================================================================
  const requiredPaths = [
    'PG_VERSION',
    'postgresql.conf',
    'base',
    'global',
    'global/pg_control',
  ]
  const missingPaths: string[] = []

  for (const reqPath of requiredPaths) {
    const fullPath = pgDataDir + '/' + reqPath
    if (!FS.analyzePath(fullPath).exists) {
      missingPaths.push(reqPath)
    }
  }

  if (missingPaths.length > 0) {
    const errorMsg = `[loadTar] VALIDATION FAILED: Missing required paths: ${missingPaths.join(', ')}`
    console.error(errorMsg)
    throw new Error(`Invalid PGlite datadir: missing required paths: ${missingPaths.join(', ')}`)
  }

  // Log pg_control state for debugging
  // pg_control structure (from PostgreSQL src/include/catalog/pg_control.h):
  // Offset 0-7:   system_identifier (uint64)
  // Offset 8-11:  pg_control_version (uint32)
  // Offset 12-15: catalog_version_no (uint32)
  // Offset 16-19: state (DBState enum = uint32)
  //
  // DBState values:
  // 0 = DB_STARTUP, 1 = DB_SHUTDOWNED, 2 = DB_SHUTDOWNED_IN_RECOVERY,
  // 3 = DB_SHUTDOWNING, 4 = DB_IN_CRASH_RECOVERY, 5 = DB_IN_ARCHIVE_RECOVERY,
  // 6 = DB_IN_PRODUCTION
  try {
    const pgControlPath = pgDataDir + '/global/pg_control'
    const pgControlData = FS.readFile(pgControlPath, { encoding: 'binary' })
    const fileSize = pgControlData.length

    // First check file size - pg_control should be 8192 bytes
    if (fileSize === 0) {
      console.error(`[loadTar] pg_control file is EMPTY (0 bytes)! This will cause _pgl_backend to crash.`)
    } else if (fileSize < 20) {
      console.error(`[loadTar] pg_control file is too small (${fileSize} bytes, need at least 20)! Corrupt tarball?`)
    } else {
      // pg_control state is at offset 16, stored as uint32 (4 bytes, little-endian)
      const stateView = new DataView(new Uint8Array(pgControlData).buffer)
      const state = stateView.getUint32(16, true) // little-endian, OFFSET 16
      const stateNames: Record<number, string> = {
        0: 'DB_STARTUP',
        1: 'DB_SHUTDOWNED',
        2: 'DB_SHUTDOWNED_IN_RECOVERY',
        3: 'DB_SHUTDOWNING',
        4: 'DB_IN_CRASH_RECOVERY',
        5: 'DB_IN_ARCHIVE_RECOVERY',
        6: 'DB_IN_PRODUCTION',
      }
      console.info(
        `[loadTar] pg_control state = ${state} (${stateNames[state] || 'UNKNOWN'}), ` +
        `size = ${fileSize} bytes`
      )
    }
  } catch (e) {
    console.warn(`[loadTar] Could not read pg_control state:`, e)
  }

  console.info(`[loadTar] Validation passed: all ${requiredPaths.length} required paths present`)
}

function readDirectory(FS: FS, path: string) {
  const files: TarFile[] = []

  const traverseDirectory = (currentPath: string) => {
    const entries = FS.readdir(currentPath)
    entries.forEach((entry) => {
      if (entry === '.' || entry === '..') {
        return
      }
      const fullPath = currentPath + '/' + entry
      const stats = FS.stat(fullPath)
      const data = FS.isFile(stats.mode)
        ? FS.readFile(fullPath, { encoding: 'binary' })
        : new Uint8Array(0)
      files.push({
        name: fullPath.substring(path.length), // remove the root path
        mode: stats.mode,
        size: stats.size,
        type: FS.isFile(stats.mode) ? REGTYPE : DIRTYPE,
        modifyTime: stats.mtime,
        data,
      })
      if (FS.isDir(stats.mode)) {
        traverseDirectory(fullPath)
      }
    })
  }

  traverseDirectory(path)
  return files
}

export function createTarball(FS: FS, directoryPath: string) {
  const files = readDirectory(FS, directoryPath)
  const tarball = tar(files)
  return tarball
}

export async function maybeZip(
  file: Uint8Array,
  compression: DumpTarCompressionOptions = 'auto',
): Promise<[Uint8Array, boolean]> {
  if (compression === 'none') {
    return [file, false]
  } else if (typeof CompressionStream !== 'undefined') {
    return [await zipBrowser(file), true]
  } else if (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
  ) {
    return [await zipNode(file), true]
  } else if (compression === 'auto') {
    return [file, false]
  } else {
    throw new Error('Compression not supported in this environment')
  }
}

export async function zipBrowser(file: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const reader = cs.readable.getReader()

  writer.write(file as BufferSource)
  writer.close()

  const chunks: Uint8Array[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const compressed = new Uint8Array(
    chunks.reduce((acc, chunk) => acc + chunk.length, 0),
  )
  let offset = 0
  chunks.forEach((chunk) => {
    compressed.set(chunk, offset)
    offset += chunk.length
  })

  return compressed
}

export async function zipNode(file: Uint8Array): Promise<Uint8Array> {
  const { promisify } = await import('util')
  const { gzip } = await import('zlib')
  const gzipPromise = promisify(gzip)
  return await gzipPromise(file)
}

export async function unzip(file: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    return await unzipBrowser(file)
  } else if (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
  ) {
    return await unzipNode(file)
  } else {
    throw new Error('Unsupported environment for decompression')
  }
}

export async function unzipBrowser(file: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  writer.write(file as BufferSource)
  writer.close()

  const chunks: Uint8Array[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const decompressed = new Uint8Array(
    chunks.reduce((acc, chunk) => acc + chunk.length, 0),
  )
  let offset = 0
  chunks.forEach((chunk) => {
    decompressed.set(chunk, offset)
    offset += chunk.length
  })

  return decompressed
}

export async function unzipNode(file: Uint8Array): Promise<Uint8Array> {
  const { promisify } = await import('util')
  const { gunzip } = await import('zlib')
  const gunzipPromise = promisify(gunzip)
  return await gunzipPromise(file)
}

function dateToUnixTimestamp(date: Date | number | undefined): number {
  if (!date) {
    return Math.floor(Date.now() / 1000)
  } else {
    return typeof date === 'number' ? date : Math.floor(date.getTime() / 1000)
  }
}
