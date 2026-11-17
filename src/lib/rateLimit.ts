export type MessageKind = "push" | "clear" | "action" | "peek" | "other";

export interface PendingMessage<T = unknown> {
  payload: T;
  deliver: (payload: T) => void;
}

export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number; // tokens added per second
  private tokens: number;
  private lastRefill: number;
  private droppedCount = 0;
  private coalescedCount = 0;

  // Separate budget for clear and action bypass messages
  private bypassCapacity: number;
  private bypassRefillRate: number;
  private bypassTokens: number;
  private bypassLastRefill: number;

  // Pending coalesced messages per act id
  private pending = new Map<string, PendingMessage<any>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(refillRate = 20, capacity = 50, bypassRefillRate = 10, bypassCapacity = 20) {
    this.refillRate = refillRate;
    this.capacity = capacity;
    this.tokens = capacity;
    this.lastRefill = performance.now();

    this.bypassRefillRate = bypassRefillRate;
    this.bypassCapacity = bypassCapacity;
    this.bypassTokens = bypassCapacity;
    this.bypassLastRefill = performance.now();
  }

  private refill(): void {
    const now = performance.now();
    const elapsedSeconds = Math.max(0, (now - this.lastRefill) / 1000);
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
      this.lastRefill = now;
    }
  }

  private refillBypass(): void {
    const now = performance.now();
    const elapsedSeconds = Math.max(0, (now - this.bypassLastRefill) / 1000);
    if (elapsedSeconds > 0) {
      this.bypassTokens = Math.min(this.bypassCapacity, this.bypassTokens + elapsedSeconds * this.bypassRefillRate);
      this.bypassLastRefill = now;
    }
  }

  consume(kind: MessageKind = "other"): boolean {
    if (kind === "clear" || kind === "action") {
      this.refillBypass();
      if (this.bypassTokens >= 1) {
        this.bypassTokens -= 1;
        return true;
      }
      if (kind === "clear") {
        // clear is never dropped
        return true;
      }
      this.droppedCount++;
      return false;
    }

    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.droppedCount++;
    return false;
  }

  submit<T>(
    kind: MessageKind,
    actId: string | undefined,
    payload: T,
    deliver: (payload: T) => void
  ): boolean {
    if (kind === "clear" || kind === "action") {
      this.refillBypass();
      if (this.bypassTokens >= 1) {
        this.bypassTokens -= 1;
        deliver(payload);
        return true;
      }
      if (kind === "clear") {
        // clear is never dropped
        deliver(payload);
        return true;
      }
      this.droppedCount++;
      return false;
    }

    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      deliver(payload);
      return true;
    }

    // Over-limit push messages coalesce to the latest per act id
    if (actId) {
      if (this.pending.has(actId)) {
        this.coalescedCount++;
      }
      this.pending.set(actId, { payload, deliver });
      this.scheduleFlush();
      return false;
    } else {
      this.droppedCount++;
      return false;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.pending.size === 0) return;

    this.refill();
    const tokensNeeded = 1 - this.tokens;
    const waitMs = tokensNeeded > 0 ? Math.ceil((tokensNeeded / this.refillRate) * 1000) : 0;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, Math.max(1, waitMs));
  }

  flush(): void {
    this.refill();
    while (this.tokens >= 1 && this.pending.size > 0) {
      const [firstKey, item] = this.pending.entries().next().value!;
      this.pending.delete(firstKey);
      this.tokens -= 1;
      try {
        item.deliver(item.payload);
      } catch (e) {
        console.error(e);
      }
    }

    if (this.pending.size > 0) {
      this.scheduleFlush();
    }
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  getCoalescedCount(): number {
    return this.coalescedCount;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  getBypassTokens(): number {
    this.refillBypass();
    return this.bypassTokens;
  }

  reset(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokens = this.capacity;
    this.lastRefill = performance.now();
    this.bypassTokens = this.bypassCapacity;
    this.bypassLastRefill = performance.now();
    this.droppedCount = 0;
    this.coalescedCount = 0;
    this.pending.clear();
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending.clear();
  }
}
