interface QueueJob<T> {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export class OutlineGenerationQueue {
  private readonly jobs: QueueJob<unknown>[] = []
  private running = false

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ run, resolve: resolve as (value: unknown) => void, reject })
      void this.drain()
    })
  }

  get pendingCount(): number {
    return this.jobs.length + (this.running ? 1 : 0)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    const job = this.jobs.shift()
    if (!job) return
    this.running = true
    try {
      job.resolve(await job.run())
    } catch (error) {
      job.reject(error)
    } finally {
      this.running = false
      void this.drain()
    }
  }
}

export const outlineGenerationQueue = new OutlineGenerationQueue()
