import { describe, it, expect } from "vitest";
import { TokenBucketRateLimiter } from "../lib/rateLimit";

describe("Token bucket rate limiter (B8)", () => {
  it("delivers at most the bucket size on a 1000-message instant burst and tracks drops", () => {
    const burstCapacity = 50;
    const refillRate = 20; // 20 msg/sec
    const limiter = new TokenBucketRateLimiter(refillRate, burstCapacity);

    let allowed = 0;
    for (let i = 0; i < 1000; i++) {
      if (limiter.consume()) {
        allowed++;
      }
    }

    // In a synchronous burst with 0ms elapsed, only the initial bucket capacity should pass
    expect(allowed).toBe(burstCapacity);
    expect(limiter.getDroppedCount()).toBe(1000 - burstCapacity);
  });
});
