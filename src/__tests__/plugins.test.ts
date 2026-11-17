import { describe, it, expect, vi, beforeEach } from "vitest";

const registeredListeners = new Map<string, Function[]>();

// Mock Tauri APIs before importing plugins
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: Function) => {
    if (!registeredListeners.has(event)) registeredListeners.set(event, []);
    registeredListeners.get(event)!.push(handler);
    return Promise.resolve(() => {
      const list = registeredListeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    });
  }),
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

describe("Plugin host resilience and differential loading (B7 / 3.1 / 3.2)", () => {
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
    registeredListeners.clear();
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Disk I/O error"));

    await px.load();

    expect(warnSpy).toHaveBeenCalledWith(
      "[drip:plugins] failed to list plugins; keeping current running plugins:",
      expect.any(Error)
    );
    warnSpy.mockRestore();

    // Running workers must still be alive!
    expect(activeWorkers.length).toBe(initialWorkerCount);

    px.dispose();
  });

  it("requests code via plugin_code only for new or changed hashes", async () => {
    const host: Host = {
      push: vi.fn(),
      clear: vi.fn(),
      peek: vi.fn(),
    };

    const px = startPlugins(host);

    // 1st load: new plugin p1 with hash h1
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "plugins_list") {
        return [{ id: "p1", hash: "hash-v1", main: "index.js", name: "P1" }];
      }
      if (cmd === "plugin_code" && args?.id === "p1") {
        return "console.log('v1');";
      }
      return [];
    });

    await px.load();
    expect(invoke).toHaveBeenCalledWith("plugin_code", { id: "p1" });
    vi.mocked(invoke).mockClear();

    // 2nd load: p1 has same hash "hash-v1"
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "plugins_list") {
        return [{ id: "p1", hash: "hash-v1", main: "index.js", name: "P1" }];
      }
      return [];
    });

    await px.load();
    // Must NOT call plugin_code again for unchanged hash!
    expect(invoke).not.toHaveBeenCalledWith("plugin_code", { id: "p1" });
    vi.mocked(invoke).mockClear();

    // 3rd load: p1 has new hash "hash-v2"
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "plugins_list") {
        return [{ id: "p1", hash: "hash-v2", main: "index.js", name: "P1" }];
      }
      if (cmd === "plugin_code" && args?.id === "p1") {
        return "console.log('v2');";
      }
      return [];
    });

    await px.load();
    // Must call plugin_code for modified hash!
    expect(invoke).toHaveBeenCalledWith("plugin_code", { id: "p1" });

    px.dispose();
  });

  it("handles broken manifests gracefully without crashing", async () => {
    const host: Host = {
      push: vi.fn(),
      clear: vi.fn(),
      peek: vi.fn(),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: "broken-manifest", error: "unexpected EOF at line 1" },
    ]);

    const px = startPlugins(host);
    await px.load();

    expect(warnSpy).toHaveBeenCalledWith("[drip:broken-manifest] plugin error: unexpected EOF at line 1");
    warnSpy.mockRestore();
    px.dispose();
  });

  it("clears acts with prefix and stops plugin on island:plugin-exit", async () => {
    const host: Host = {
      push: vi.fn(),
      clear: vi.fn(),
      peek: vi.fn(),
    };

    const px = startPlugins(host);
    const exitHandlers = registeredListeners.get("island:plugin-exit");
    expect(exitHandlers).toBeDefined();
    expect(exitHandlers?.length).toBeGreaterThan(0);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Fire island:plugin-exit
    exitHandlers![0]({ payload: { id: "worker-proc", code: 0 } });

    expect(host.clear).toHaveBeenCalledWith("worker-proc:", true);
    expect(logSpy).toHaveBeenCalledWith("[drip:plugin-exit]", "worker-proc", 0);

    logSpy.mockRestore();
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
