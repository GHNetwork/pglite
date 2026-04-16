import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGliteWorker } from '../src/worker/index.ts'

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

class FakeBroadcastChannel extends EventTarget {
  static registry = new Map<string, FakeBroadcastChannel[]>()

  readonly sentMessages: any[] = []
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
    this.dispatchEvent(createMessageEvent(message))
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
})