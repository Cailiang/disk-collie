import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { app } from 'electron'
import type { StorageProgress } from '../shared/storage-types'

export class NativeEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  constructor(private readonly progress: (progress: StorageProgress) => void = () => undefined) {}
  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const executable = process.platform === 'win32' ? 'disk-collie-engine.exe' : 'disk-collie-engine'
    const binary = app.isPackaged ? path.join(process.resourcesPath, 'native', executable) : path.join(app.getAppPath(), 'build/native', executable)
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line)
        if (message.event === 'progress') { this.progress(message); return }
        const request = this.pending.get(message.request)
        if (!request) return
        this.pending.delete(message.request)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.result)
      } catch { this.stop('Invalid native engine response') }
    })
    // Drain stderr; engine diagnostics must never block a full pipe.
    child.stderr.on('data', () => undefined)
    const failed = (message: string): void => {
      if (this.child !== child) return
      this.child = null
      for (const p of this.pending.values()) p.reject(new Error(message))
      this.pending.clear()
    }
    child.on('error', (e) => failed(e.message))
    child.on('exit', () => failed('Storage engine stopped; scan again'))
    return child
  }
  request<T>(command: string, args: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = this.start()
      const request = ++this.sequence
      this.pending.set(request, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ request, command, args })}\n`, (error) => {
        if (error) { this.pending.delete(request); reject(error) }
      })
    })
  }
  stop(message = 'Scan cancelled'): void {
    const child = this.child; this.child = null
    for (const p of this.pending.values()) p.reject(new Error(message))
    this.pending.clear(); child?.kill()
  }
}
