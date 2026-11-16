import { describe, it, expect, beforeEach, vi } from "vitest";
import { triggerHapticTap, isSoundEnabled, setSoundEnabled, _resetHapticsState } from "../lib/haptics";

describe("Haptics and sound setting (B1)", () => {
  let createdCount = 0;
  const storage = new Map<string, string>();

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
      this.state = "running";
      return Promise.resolve();
    }
  }

  beforeEach(() => {
    storage.clear();
    createdCount = 0;
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("window", {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
});
