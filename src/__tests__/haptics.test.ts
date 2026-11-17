import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  triggerHapticTap,
  isSoundEnabled,
  setSoundEnabled,
  getAudioContext,
  _resetHapticsState,
} from "../lib/haptics";

describe("Haptics and sound setting (B1 / 2.6)", () => {
  let createdCount = 0;
  const storage = new Map<string, string>();
  let registeredListeners: { [event: string]: Function[] } = {};

  const mockLocalStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    get length() {
      return storage.size;
    },
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
  };

  class MockAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    resumeFn = vi.fn().mockImplementation(() => {
      this.state = "running";
      return Promise.resolve();
    });
    constructor() {
      createdCount++;
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
    }
    resume() {
      return this.resumeFn();
    }
  }

  beforeEach(() => {
    storage.clear();
    createdCount = 0;
    registeredListeners = {};
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("window", {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn((event: string, handler: Function) => {
        if (!registeredListeners[event]) registeredListeners[event] = [];
        registeredListeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        if (registeredListeners[event]) {
          registeredListeners[event] = registeredListeners[event].filter((h) => h !== handler);
        }
      }),
    });
    _resetHapticsState();
  });

  it("is OFF by default", () => {
    expect(isSoundEnabled()).toBe(false);
  });

  it("creates ZERO AudioContext instances across 100 calls when sound is OFF", () => {
    setSoundEnabled(false);
    for (let i = 0; i < 100; i++) {
      triggerHapticTap("click");
      triggerHapticTap("snap");
      triggerHapticTap("pop");
    }
    expect(createdCount).toBe(0);
  });

  it("creates EXACTLY ONE shared AudioContext across 100 calls when sound is ON", () => {
    setSoundEnabled(true);
    for (let i = 0; i < 100; i++) {
      triggerHapticTap("click");
      triggerHapticTap("snap");
      triggerHapticTap("pop");
    }
    expect(createdCount).toBe(1);
  });

  it("keeps pointerdown listener if resume() rejects, removing it only once resume() succeeds", async () => {
    setSoundEnabled(true);
    const ctx = getAudioContext() as unknown as MockAudioContext;
    expect(ctx).toBeDefined();
    expect(registeredListeners["pointerdown"]?.length).toBe(1);

    // Make resume reject on first gesture
    ctx.resumeFn = vi.fn().mockRejectedValueOnce(new Error("Audio playback disallowed"));

    // Fire first pointerdown event
    const handler = registeredListeners["pointerdown"][0];
    await handler();

    // Context should still be suspended and listener must NOT be removed
    expect(registeredListeners["pointerdown"]?.length).toBe(1);

    // Second gesture: resume succeeds
    ctx.resumeFn = vi.fn().mockImplementationOnce(() => {
      ctx.state = "running";
      return Promise.resolve();
    });

    await handler();

    // Now listener must be removed!
    expect(registeredListeners["pointerdown"]?.length).toBe(0);
  });
});
