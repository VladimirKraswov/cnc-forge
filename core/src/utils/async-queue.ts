export class AsyncQueue<T = any> {
  private queue: T[] = [];
  private processing = false;

  enqueue(item: T): void {
    this.queue.push(item);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  async process(processor: (item: T) => Promise<void>): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    while (!this.isEmpty()) {
      const item = this.dequeue();
      if (item) {
        try {
          await processor(item);
        } catch (error) {
          console.error('Error processing queue item:', error);
        }
      }
    }
    
    this.processing = false;
  }
}