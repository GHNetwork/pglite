import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pgliteSource = () =>
  readFileSync(new URL('../src/pglite.ts', import.meta.url), 'utf8')

const opfsAhpSource = () =>
  readFileSync(new URL('../src/fs/opfs-ahp.ts', import.meta.url), 'utf8')

describe('NMT init-stage timeout budget', () => {
  it('keeps PGlite init stage guards aligned with the 90s worker budget', () => {
    const source = pgliteSource()

    expect(source).toContain('const INIT_STAGE_TIMEOUT_MS = 90000')
    expect(source).not.toMatch(/withInitStageGuard\([\s\S]*?,\s*30000\s*[,)]/)
    expect(source).not.toMatch(/withInitStageGuard\([\s\S]*?,\s*60000\s*[,)]/)
    expect(source).toContain('fs.init')
  })

  it('clears completed stage timeout handles instead of leaving stale timers behind', () => {
    const source = pgliteSource()

    expect(source).toContain('let timeoutId: ReturnType<typeof setTimeout> | undefined')
    expect(source).toContain('clearTimeout(timeoutId)')
  })

  it('keeps OPFS-AHP post-state-handle progress observable inside fs.init', () => {
    const source = opfsAhpSource()

    expect(source).toContain('#init: state sync access handle created successfully')
    expect(source).toContain('#init: state loaded')
    expect(source).toContain('#init: WAL replay complete')
    expect(source).toContain('creating retained pool files')
    expect(source).toContain('#init: COMPLETE')
  })

  it('does not burst OPFS-AHP handle operations with Promise.all batches', () => {
    const source = opfsAhpSource()

    expect(source).not.toContain('Promise.all(batch.map(operation))')
    expect(source).toContain('HANDLE_OPERATION_STALL_REPORT_MS')
    expect(source).toContain('still pending after')
  })

  it('creates backing files on-demand during direct materialization instead of pre-growing a pool', () => {
    const source = opfsAhpSource()

    // The old burst-prone pattern pre-created the entire pool before writing.
    expect(source).not.toContain('await this.maintainPool(requiredPoolSize)')
    expect(source).not.toContain('const requiredPoolSize = regularFiles.length')
    expect(source).not.toContain('const requiredPoolSize = this.state.pool.length + regularFiles.length')

    // On-demand creation avoids the 1,500+ handle creation burst.
    expect(source).toContain('#createMaterializedBackingFile')
    expect(source).toContain('#materializeRegularFileOnDemand')
    expect(source).toContain('await this.#createMaterializedBackingFile()')
    expect(source).not.toContain('await this.#runInHandleBatches(regularFiles')
    expect(source).toContain('one file at a time')
    expect(source).toContain('direct materialization file')
  })
})
