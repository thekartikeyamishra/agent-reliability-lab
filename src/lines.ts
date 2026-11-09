/**
 * Line reader that never drops input. readline's question() loses lines that arrive in a burst (multi-line paste,
 * piped input); this queues every line and hands them out in order.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { createInterface, type Interface } from 'node:readline';

export class LineReader {
  private rl: Interface;
  private queue: string[] = [];
  private waiters: Array<(l: string | null) => void> = [];
  private closed = false;

  constructor(input: NodeJS.ReadableStream = process.stdin, private readonly output: NodeJS.WritableStream = process.stdout) {
    this.rl = createInterface({ input, crlfDelay: Infinity, terminal: false });
    this.rl.on('line', (l) => {
      const w = this.waiters.shift();
      if (w) w(l);
      else this.queue.push(l);
    });
    this.rl.on('close', () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
  }

  /** Next line, or null when input has ended (Ctrl+Z / Ctrl+D or end of a pipe). */
  next(prompt = ''): Promise<string | null> {
    if (prompt) this.output.write(prompt);
    const q = this.queue.shift();
    if (q !== undefined) return Promise.resolve(q);
    if (this.closed) return Promise.resolve(null);
    return new Promise((res) => this.waiters.push(res));
  }

  close(): void {
    this.rl.close();
  }
}
