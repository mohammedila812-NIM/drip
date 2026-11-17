import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TokenBucketRateLimiter } from "../lib/rateLimit";

describe("Token bucket rate limiter (2.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bursts up to capacity then limits drops", () => {
    const burstCapacity = 50;
    const refillRate = 20;
    const limiter = new TokenBucketRateLimiter(refillRate, burstCapacity);

    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if (limiter.consume()) {
        allowed++;
      }
    }

    expect(allowed).toBe(50);
    expect(limiter.getDroppedCount()).toBe(50);
    limiter.dispose();
  });

  it("refills tokens over time", () => {
    const limiter = new TokenBucketRateLimiter(20, 20);
    // Drain all 20 tokens
    for (let i = 0; i < 20; i++) {
      expect(limiter.consume()).toBe(true);
    }
    expect(limiter.consume()).toBe(false);

    // Advance 500ms (should restore 10 tokens at 20 tokens/sec)
    vi.advanceTimersByTime(500);
    expect(limiter.getTokens()).toBeCloseTo(10, 1);

    // Advance another 500ms (should restore remaining to 20 tokens)
    vi.advanceTimersByTime(500);
    expect(limiter.getTokens()).toBeCloseTo(20, 1);
    limiter.dispose();
  });

  it("steady 20 msg/s passes untouched without drops or coalescing", () => {
    const limiter = new TokenBucketRateLimiter(20, 20);
    // Drain bucket to steady state
    for (let i = 0; i < 20; i++) {
      limiter.consume();
    }
    expect(limiter.getDroppedCount()).toBe(0);

    let delivered = 0;
    // Send 40 messages over 2000ms at 50ms intervals (exact 20 msg/s rate)
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(50);
      limiter.submit("push", `act-${i}`, i, () => {
        delivered++;
      });
    }

    expect(delivered).toBe(40);
    expect(limiter.getDroppedCount()).toBe(0);
    expect(limiter.getCoalescedCount()).toBe(0);
    limiter.dispose();
  });

  it("1000 pushes to one id deliver the latest value upon refill", () => {
    const limiter = new TokenBucketRateLimiter(20, 20);
    const delivered: number[] = [];

    // Drain initial capacity
    for (let i = 0; i < 20; i++) {
      limiter.submit("push", "initial", i, (val) => delivered.push(val));
    }
    expect(delivered.length).toBe(20);

    // Now send 1000 pushes to the SAME act id ("counter") in an instant burst
    for (let i = 1; i <= 1000; i++) {
      limiter.submit("push", "counter", i, (val) => delivered.push(val));
    }

    // Since bucket is empty, the first one was queued pending, and 999 were coalesced!
    expect(limiter.getCoalescedCount()).toBe(999);
    expect(delivered.length).toBe(20); // Not delivered yet

    // Advance time to allow token refill and flush timer to fire (50ms per token)
    vi.advanceTimersByTime(60);

    // Flush should have delivered the latest value (1000)!
    expect(delivered.length).toBe(21);
    expect(delivered[delivered.length - 1]).toBe(1000);
    limiter.dispose();
  });

  it("clear is never dropped, even when bucket and bypass bucket are exhausted", () => {
    const limiter = new TokenBucketRateLimiter(20, 20, 10, 5);
    const cleared: string[] = [];

    // Exhaust main bucket
    for (let i = 0; i < 30; i++) {
      limiter.consume("other");
    }

    // Exhaust bypass bucket with actions
    for (let i = 0; i < 10; i++) {
      limiter.consume("action");
    }

    // Send 100 clear messages
    for (let i = 0; i < 100; i++) {
      limiter.submit("clear", `id-${i}`, `clear-${i}`, (id) => {
        cleared.push(id);
      });
    }

    // All 100 clear messages must be delivered immediately
    expect(cleared.length).toBe(100);
    expect(cleared[0]).toBe("clear-0");
    expect(cleared[99]).toBe("clear-99");
    limiter.dispose();
  });
});
