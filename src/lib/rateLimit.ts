export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number; // tokens added per second
  private tokens: number;
  private lastRefill: number;
  private droppedCount = 0;

  constructor(refillRate = 20, capacity = 50) {
    this.refillRate = refillRate;
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = performance.now();
  }

  private refill(): void {
    const now = performance.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
      this.lastRefill = now;
    }
  }

  consume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.droppedCount++;
    return false;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = performance.now();
    this.droppedCount = 0;
  }
}
