import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGliteWorker, worker } from '../src/worker/index.ts'

const nativeDispatchEvent = EventTarget.prototype.dispatchEvent

function createMessageEvent(data: any): Event {
  const event = new Event('message') as Event & { data: any }
  Object.defineProperty(event, 'data', { value: data })
  return event
}

class FakeWorker extends EventTarget {
  terminated = false

  constructor() {
    super()
    queueMicrotask(() => {
      this.dispatchEvent(createMessageEvent({ type: 'here' }))
    })
  }

  postMessage(message: any) {
    if (message.type === 'init') {
      queueMicrotask(() => {
        this.dispatchEvent(createMessageEvent({ type: 'ready', id: 'test-worker' }))
      })
    }
  }

  terminate() {
    this.terminated = true
  }
}

class ImmediateLeaderWorker extends FakeWorker {
  override postMessage(message: any) {
    if (message.type === 'init') {
      queueMicrotask(() => {
        this.dispatchEvent(createMessageEvent({ type: 'ready', id: 'test-worker' }))
        this.dispatchEvent(createMessageEvent({ type: 'leader-now' }))
      })
    }
  }
}

class FakeBroadcastChannel extends EventTarget {
  static registry = new Map<string, FakeBroadcastChannel[]>()

  readonly sentMessages: any[] = []
  onmessage: ((event: Event & { data: any }) => void) | null = null
  closed = false

  constructor(public readonly name: string) {
    super()
    const channels = FakeBroadcastChannel.registry.get(name) ?? []
    channels.push(this)
    FakeBroadcastChannel.registry.set(name, channels)
  }

  postMessage(message: any) {
    this.sentMessages.push(message)
  }

  close() {
    this.closed = true
  }

  emitMessage(message: any) {
    const event = createMessageEvent(message) as Event & { data: any }
    this.dispatchEvent(event)
    this.onmessage?.(event)
  }

  static first(name: string) {
    return this.registry.get(name)?.[0]
  }

  static matching(prefix: string) {
    return [...this.registry.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .flatMap(([, channels]) => channels)
  }

  static reset() {
    this.registry.clear()
  }
}

class FakeErrorEvent extends Event {
  message: string
  error: any

  constructor(type: string, init?: { message?: string; error?: any }) {
    super(type)
    this.message = init?.message ?? ''
    this.error = init?.error
  }
}

describe('PGliteWorker fatal connection handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeBroadcastChannel.reset()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('ErrorEvent', FakeErrorEvent)
    vi.stubGlobal('navigator', {
      locks: {
        request: (_lockId: string, callback: () => Promise<void>) => callback(),
      },
    })
    vi
      .spyOn(EventTarget.prototype, 'dispatchEvent')
      .mockImplementation(function (event: Event) {
        if (event.type === 'error') {
          return true
        }

        return nativeDispatchEvent.call(this, event)
      })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects waitReady and stops leader notify retries after connection-error', async () => {
    const db = new PGliteWorker(new FakeWorker() as unknown as Worker)

    await vi.waitFor(() => {
      expect(FakeBroadcastChannel.first('pglite-broadcast:test-worker')).toBeDefined()
      expect(FakeBroadcastChannel.matching('pglite-tab:')[0]).toBeDefined()
    })

    const broadcastChannel = FakeBroadcastChannel.first('pglite-broadcast:test-worker')
    const tabChannel = FakeBroadcastChannel.matching('pglite-tab:')[0]

    await vi.advanceTimersByTimeAsync(50)

    const countTabHere = () =>
      broadcastChannel!.sentMessages.filter(
        (message) => message.type === 'tab-here',
      ).length

    expect(countTabHere()).toBeGreaterThan(1)

    const waitReadyPromise = db.waitReady
    const waitReadyAssertion = expect(waitReadyPromise).rejects.toThrow(
      'Program terminated with exit(2)',
    )

    tabChannel!.emitMessage({
      type: 'connection-error',
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Database health check failed: Program terminated with exit(2)',
      },
    })

    await waitReadyAssertion

    const retryCountAfterFailure = countTabHere()
    await vi.advanceTimersByTimeAsync(100)

    expect(countTabHere()).toBe(retryCountAfterFailure)
    await expect(db.waitReady).rejects.toThrow('Program terminated with exit(2)')

    await db.close()
  })

  it('captures leader-now when it arrives immediately after ready', async () => {
    const db = new PGliteWorker(new ImmediateLeaderWorker() as unknown as Worker)

    await vi.waitFor(() => {
      expect(db.isLeader).toBe(true)
    })

    await db.close()
  })

  it('deduplicates repeated tab-here messages while database initialization is pending', async () => {
    const workerGlobal = new EventTarget()
    vi.stubGlobal('addEventListener', workerGlobal.addEventListener.bind(workerGlobal))
    vi.stubGlobal('postMessage', vi.fn())

    let resolveInit!: (db: any) => void
    const fakeDb = {
      waitReady: Promise.resolve(),
      query: vi.fn(async () => ({ rows: [{ health_check: 1 }] })),
      onNotification: vi.fn(),
    }
    const init = vi.fn(async () => new Promise<any>((resolve) => {
      resolveInit = resolve
    }))

    const workerPromise = worker({ init })
    workerGlobal.dispatchEvent(createMessageEvent({
      type: 'init',
      options: { id: 'dedupe-worker' },
    }))

    await vi.waitFor(() => {
      expect(FakeBroadcastChannel.first('pglite-broadcast:dedupe-worker')).toBeDefined()
    })

    const broadcastChannel = FakeBroadcastChannel.first('pglite-broadcast:dedupe-worker')!
    for (let i = 0; i < 8; i++) {
      broadcastChannel.emitMessage({ type: 'tab-here', id: 'tab-a' })
    }

    expect(FakeBroadcastChannel.matching('pglite-tab:tab-a')).toHaveLength(0)
    resolveInit(fakeDb)

    await vi.waitFor(() => {
      expect(FakeBroadcastChannel.matching('pglite-tab:tab-a')).toHaveLength(1)
    })
    await workerPromise

    expect(init).toHaveBeenCalledOnce()
    expect(fakeDb.query).toHaveBeenCalledOnce()
  })

  it('forwards only allowlisted worker-local extension namespace methods', async () => {
    const workerGlobal = new EventTarget()
    vi.stubGlobal('addEventListener', workerGlobal.addEventListener.bind(workerGlobal))
    vi.stubGlobal('postMessage', vi.fn())

    const fakeDb = {
      waitReady: Promise.resolve(),
      query: vi.fn(async () => ({ rows: [{ health_check: 1 }] })),
      onNotification: vi.fn(),
      meridianProjection: {
        snapshot: vi.fn(async (tableName: string) => [{ id: 'row-1', tableName }]),
        reset: vi.fn(),
      },
    }
    const init = vi.fn(async () => fakeDb)

    const workerPromise = worker({ init })
    workerGlobal.dispatchEvent(createMessageEvent({
      type: 'init',
      options: {
        id: 'extension-rpc-worker',
        extensionRpcAllowlist: { meridianProjection: ['snapshot'] },
      },
    }))

    await vi.waitFor(() => {
      expect(FakeBroadcastChannel.first('pglite-broadcast:extension-rpc-worker')).toBeDefined()
    })

    const broadcastChannel = FakeBroadcastChannel.first('pglite-broadcast:extension-rpc-worker')!
    broadcastChannel.emitMessage({ type: 'tab-here', id: 'extension-tab' })

    await vi.waitFor(() => {
      expect(FakeBroadcastChannel.matching('pglite-tab:extension-tab')).toHaveLength(1)
    })

    const tabChannel = FakeBroadcastChannel.matching('pglite-tab:extension-tab')[0]
    tabChannel.emitMessage({
      type: 'rpc-call',
      callId: 'allowed-call',
      method: '_callExtensionMethod',
      args: ['meridianProjection', 'snapshot', ['users']],
    })

    await vi.waitFor(() => {
      expect(tabChannel.sentMessages).toContainEqual({
        type: 'rpc-return',
        callId: 'allowed-call',
        result: [{ id: 'row-1', tableName: 'users' }],
      })
    })

    tabChannel.emitMessage({
      type: 'rpc-call',
      callId: 'denied-call',
      method: '_callExtensionMethod',
      args: ['meridianProjection', 'reset', []],
    })

    await vi.waitFor(() => {
      expect(tabChannel.sentMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'rpc-error',
          callId: 'denied-call',
          error: expect.objectContaining({
            message: 'Extension RPC method not allowed: meridianProjection.reset',
          }),
        }),
      ]))
    })

    expect(fakeDb.meridianProjection.snapshot).toHaveBeenCalledWith('users')
    expect(fakeDb.meridianProjection.reset).not.toHaveBeenCalled()
    await workerPromise
  })
})