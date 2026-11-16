import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs before importing plugins
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { startPlugins } from "../plugins";
import type { Host } from "../plugins";

let activeWorkers: MockWorker[] = [];

class MockWorker {
  url: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  postedMessages: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    activeWorkers.push(this);
  }

  postMessage(data: unknown) {
    this.postedMessages.push(data);
  }

  terminate() {
    this.terminated = true;
    const idx = activeWorkers.indexOf(this);
    if (idx !== -1) activeWorkers.splice(idx, 1);
  }
}

describe("Plugin host resilience (B7)", () => {
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

  beforeEach(() => {
    activeWorkers = [];
    storage.clear();
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-plugin-worker"),
      revokeObjectURL: vi.fn(),
    });
    vi.clearAllMocks();
  });

  it("keeps running plugins when plugins_list fails", async () => {
    const host: Host = {
      push: vi.fn(),
      clear: vi.fn(),
      peek: vi.fn(),
    };

    // First load succeeds with empty disk list, spawning built-in plugins
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const px = startPlugins(host);
    await px.load();
    const initialWorkerCount = activeWorkers.length;
    expect(initialWorkerCount).toBeGreaterThan(0);

    // Second load: invoke throws error
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Disk I/O error"));

    await px.load();

    // Running workers must still be alive!
    expect(activeWorkers.length).toBe(initialWorkerCount);

    px.dispose();
  });

  it("starts ZERO workers if load() resolves after dispose() was called", async () => {
    const host: Host = {
      push: vi.fn(),
      clear: vi.fn(),
      peek: vi.fn(),
    };

    const px = startPlugins(host);

    let resolveInvoke: (val: unknown) => void = () => {};
    const delayedPromise = new Promise((res) => {
      resolveInvoke = res;
    });

    vi.mocked(invoke).mockReturnValueOnce(delayedPromise as any);

    // Call load, but dispose immediately while load() is in-flight
    const loadPromise = px.load();
    px.dispose();

    // Now resolve the delayed invoke
    resolveInvoke([]);
    await loadPromise;

    // Must not have started any workers after dispose!
    expect(activeWorkers.length).toBe(0);
  });
});
