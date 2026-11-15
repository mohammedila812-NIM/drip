// Drip plugin host. Plugins live in %APPDATA%\dev.drip.app\plugins\<id>\plugin.json and come in two kinds:
//   { "name": "..", "main": "index.js", "permissions": [] }                 sandboxed Web Worker; talks through the global `drip`
//   { "name": "..", "exec": ["powershell","-File","x.ps1"], "permissions": [] }   child process; one JSON object per line on stdout / stdin
// permissions: "fg" = receives foreground app + window title, "peek" = may open the island by itself.
// Both kinds speak the same protocol and everything they send is sanitised here: ids are namespaced "<plugin>:<id>",
// priority is clamped to 1..9 (core alerts own 10+), text is length-limited, colours are validated.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Act } from "./App";

type Man = { id: string; name?: string; main?: string; exec?: string[]; code?: string; permissions?: string[]; enabled?: boolean };
type Host = { push(a: Act): void; clear(id: string, prefix?: boolean): void; peek(ms: number): void };
type Live = { m: Man; post(x: unknown): void; kill(): void };

// worker prelude = the whole plugin API: drip.push / clear / peek / on("action"|"fg") / every / store.get / store.set
const PRE = `(()=>{const H={},S={},P=m=>postMessage(m);
self.drip={push:a=>P({push:a}),clear:i=>P({clear:i}),peek:ms=>P({peek:ms}),on:(e,f)=>(H[e]??=[]).push(f),every:(ms,f)=>setInterval(f,ms),store:{get:k=>S[k],set:(k,v)=>{S[k]=v;P({store:[k,v]})}}};
onmessage=e=>{const m=e.data;if(m.init)Object.assign(S,m.init.store);else(H[m.ev]||[]).forEach(f=>f(m.data))}})();`;

const COL = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/a-z]+\))$/i;

export function startPlugins(h: Host) {
  const live = new Map<string, Live>();
  let fg: unknown = null, gen = 0;
  const can = (m: Man, p: string) => !!m.permissions?.includes(p);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);

  const clean = (m: Man, a: any): Act | null => {
    if (!a || typeof a.title !== "string") return null;
    return {
      id: m.id + ":" + (str(a.id, 40) ?? "main"), pri: num(a.pri, 1, 9) ?? 2, title: a.title.slice(0, 60),
      icon: str(a.icon, 8), side: str(a.side, 24), sub: str(a.sub, 120), p: num(a.p, 0, 1),
      color: typeof a.color === "string" && COL.test(a.color) ? a.color : undefined,
      w: num(a.w, 170, 380), ttl: num(a.ttl, 500, 3600000),
      peek: can(m, "peek") ? num(a.peek, 500, 10000) : undefined,
      when: typeof a.when?.app === "string" ? { app: a.when.app.slice(0, 80) } : undefined,
      actions: Array.isArray(a.actions) ? a.actions.slice(0, 3).map((x: unknown) => String(x).slice(0, 16)) : undefined,
    };
  };

  const onMsg = (m: Man, d: any) => {
    if (!d || typeof d !== "object") return;
    if ("push" in d) { const a = clean(m, d.push); a && h.push(a); }
    else if ("clear" in d) h.clear(m.id + ":" + String(d.clear).slice(0, 40));
    else if ("peek" in d) { if (can(m, "peek")) h.peek(num(d.peek, 500, 10000) ?? 3000); }
    else if ("store" in d && Array.isArray(d.store)) { try { localStorage.setItem(`drip:${m.id}:${String(d.store[0]).slice(0, 40)}`, JSON.stringify(d.store[1])); } catch {} }
    else if (typeof d.title === "string") { const a = clean(m, d); a && h.push(a); }   // a bare Act line from an exec plugin
  };

  const sendFg = (p: Live) => { if (fg && can(p.m, "fg")) p.post({ ev: "fg", data: fg }); };

  const run = (m: Man) => {
    if (typeof m.main === "string" && typeof m.code === "string") {
      const url = URL.createObjectURL(new Blob([PRE + "\n" + m.code], { type: "text/javascript" }));
      const w = new Worker(url), pre = `drip:${m.id}:`, store: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith(pre)) try { store[k.slice(pre.length)] = JSON.parse(localStorage.getItem(k)!); } catch {} }
      w.onmessage = e => onMsg(m, e.data);
      w.onerror = e => console.warn(`[drip:${m.id}]`, e.message);
      const p: Live = { m, post: x => w.postMessage(x), kill: () => { w.terminate(); URL.revokeObjectURL(url); } };
      live.set(m.id, p); p.post({ init: { store } }); sendFg(p);
    } else if (m.exec) {
      const p: Live = { m, post: x => { invoke("plugin_send", { id: m.id, line: JSON.stringify(x) }).catch(() => {}); }, kill: () => { invoke("plugin_stop", { id: m.id }).catch(() => {}); } };
      live.set(m.id, p);
      invoke("plugin_run", { id: m.id }).then(() => sendFg(p)).catch(e => console.warn(`[drip:${m.id}]`, e));
    }
  };

  const stop = () => { gen++; live.forEach((p, id) => { p.kill(); h.clear(id + ":", true); }); live.clear(); };
  const un = listen<{ id: string; line: string }>("island:plugin", e => { const p = live.get(e.payload.id); if (p) try { onMsg(p.m, JSON.parse(e.payload.line)); } catch {} });

  return {
    // (re)load every enabled plugin from disk
    async load() {
      stop(); const g = gen;
      const list = await invoke<Man[]>("plugins_list").catch(() => [] as Man[]);
      if (g === gen) list.filter(m => m.enabled !== false).forEach(run);
    },
    fg(f: unknown) { fg = f; live.forEach(sendFg); },
    action(id: string, action: string) { const i = id.indexOf(":"); if (i > 0) live.get(id.slice(0, i))?.post({ ev: "action", data: { id: id.slice(i + 1), action } }); },
    dispose() { stop(); un.then(f => f()); },
  };
}
