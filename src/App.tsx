// Drip: liquid dynamic island core for Windows. Drop in as src/App.tsx of a Tauri 2 + React-TS app.
// Native code, plugins or other apps feed it with `emit("island:push", Act)`; it emits "island:action" back on button clicks.
// [drip] foreground-window awareness (fullscreen retreat, hot-edge over maximized windows,
//        per-app clock card), `peek` (alerts drip out on their own) and a plugin host (see plugins.ts).
import React, { useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startPlugins } from "./plugins";

// peek: ms to auto-open without hover; when: only eligible while the foreground exe matches this regex
export type Act = {
  id: string;
  pri: number;
  title: string;
  icon?: string;
  side?: string;
  sub?: string;
  p?: number;
  color?: string;
  w?: number;
  ttl?: number;
  actions?: string[];
  peek?: number;
  when?: { app: string };
};

export type Fg = {
  exe: string;
  title: string;
  full: boolean;
  max: boolean;
  top: boolean;
  shell: boolean;
};

// [stiffness, damping] per spring: loose droplet, jelly pill, tight cursor smoothing
const K = {
  ix: [180, 16],
  dx: [110, 9],
  dy: [170, 11],
  dw: [200, 13],
  dh: [240, 15],
  ar: [200, 18],
  sx: [260, 28],
  sy: [260, 28],
  cf: [300, 30],
} as const;

type Key = keyof typeof K;
type Sp = { v: number; t: number; x: number };
const RM = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion:reduce)").matches;
const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const $ = (id: string) => document.getElementById(id)!;
const set = (id: string, o: Record<string, number>) => {
  for (const k in o) $(id).setAttribute(k, String(o[k]));
};

// [drip] localStorage "drip.mode": "auto" (default) | "free" (never hot-edge) | "edge" (always hot-edge)
const MODE = (() => {
  try {
    return localStorage.getItem("drip.mode") ?? "auto";
  } catch {
    return "auto";
  }
})();

const APPS: Record<string, [string, string]> = {
  chrome: ["Chrome", "globe"],
  msedge: ["Edge", "globe"],
  firefox: ["Firefox", "globe"],
  brave: ["Brave", "globe"],
  code: ["VS Code", "code"],
  devenv: ["Visual Studio", "code"],
  explorer: ["Files", "folder"],
  spotify: ["Spotify", "music"],
  discord: ["Discord", "chat"],
  slack: ["Slack", "chat"],
  whatsapp: ["WhatsApp", "chat"],
  teams: ["Teams", "chat"],
  windowsterminal: ["Terminal", "terminal"],
  powershell: ["PowerShell", "terminal"],
  winword: ["Word", "doc"],
  excel: ["Excel", "chart"],
  powerpnt: ["PowerPoint", "presentation"],
  notepad: ["Notepad", "doc"],
  vlc: ["VLC", "video"],
  steam: ["Steam", "game"],
};

const ICONS: Record<string, () => React.ReactNode> = {
  clock: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  battery: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  globe: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  code: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  terminal: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  music: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  chat: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  folder: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  doc: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  chart: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  presentation: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  game: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="12" x2="10" y2="12" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="15" y1="13" x2="15.01" y2="13" />
      <line x1="18" y1="11" x2="18.01" y2="11" />
    </svg>
  ),
  video: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  ),
  window: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  ),
};

const EMOJI_MAP: Record<string, string> = {
  "🕓": "clock",
  "⚡": "battery",
  "🌐": "globe",
  "🦊": "globe",
  "🦁": "globe",
  "🧑‍💻": "code",
  "📁": "folder",
  "🎵": "music",
  "💬": "chat",
  "⌨️": "terminal",
  "📝": "doc",
  "📊": "chart",
  "📽️": "presentation",
  "🗒️": "doc",
  "🎬": "video",
  "🎮": "game",
  "🪟": "window",
};

function renderIcon(icon?: string) {
  if (!icon) return null;
  const key = ICONS[icon] ? icon : EMOJI_MAP[icon];
  if (key && ICONS[key]) {
    return ICONS[key]();
  }
  return <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>;
}

// Multimodal feedback: micro-haptic synthesized audio impulse
function hapticTap(type: "snap" | "click" | "pop" = "click") {
  if (RM) return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === "click") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.018);
      gain.gain.setValueAtTime(0.025, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.018);
    } else if (type === "snap") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.035);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.035);
    } else if (type === "pop") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.025);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.025);
    }
  } catch {}
}

const info = (f: Fg) => {
  const [n, i] = APPS[f.exe] ?? [f.exe.replace(/^./, (c) => c.toUpperCase()), "window"];
  return { n, i };
};

const hue = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 85% 62%)`;
};

let FG: Fg | null = null; // latest foreground window, read by clock() and by `when` rules
const ok = (x: Act) => {
  if (!x.when) return true;
  try {
    return new RegExp(x.when.app, "i").test(FG?.exe ?? "");
  } catch {
    return false;
  }
};

// idle card: time + the app you are in (icon, name, window title, per-app accent); width adapts to the context
const clock = (): Act => {
  const f = FG && !FG.shell && FG.exe ? FG : null,
    i = f && info(f);
  return {
    id: "clock",
    pri: 0,
    icon: i?.i ?? "clock",
    title: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    side: i?.n.slice(0, 14),
    sub: f?.title.slice(0, 70) || undefined,
    color: f ? hue(f.exe) : undefined,
    w: f ? 240 : 176,
  };
};

const init = () => {
  const sp = {} as Record<Key, Sp>;
  (Object.keys(K) as Key[]).forEach((k) => (sp[k] = { v: 0, t: 0, x: 0 }));
  sp.ar.v = sp.ar.t = 1.5;
  sp.cf.v = sp.cf.t = 1;
  const a = clock();
  return {
    sp,
    cur: a,
    want: a,
    mx: 0,
    my: 420,
    exp: false,
    big: false,
    snap: false,
    raf: 0,
    wake: () => {},
    pk: 0,
    off: false,
    edge: false,
    eng: false,
    was: false,
    px: null as ReturnType<typeof startPlugins> | null,
  };
};

export default function Island() {
  const S = useRef(init()).current;
  const [acts, setActs] = useState<Act[]>([S.cur]);
  const [a, setShown] = useState<Act>(S.cur);
  const [big, setBig] = useState(false);
  const [ver, bump] = useState(0);
  const setB = (v: boolean) => {
    S.big = v;
    setBig(v);
    S.wake();
  };

  useEffect(() => {
    const win = getCurrentWindow(),
      s = S.sp,
      T = new Map<string, number>();
    const kick = (k: Key, v: number) => {
      if (!RM) s[k].x += v;
    };
    const peek = (ms: number) => {
      if (S.off) return;
      S.pk = performance.now() + Math.min(ms, 10000);
      S.wake();
      setTimeout(S.wake, Math.min(ms, 10000) + 50);
    };
    const push = (x: Act) => {
      setActs((l) => [...l.filter((i) => i.id !== x.id), x]);
      clearTimeout(T.get(x.id));
      if (x.ttl) T.set(x.id, window.setTimeout(() => setActs((l) => l.filter((i) => i.id !== x.id)), x.ttl));
      if (x.peek) peek(x.peek);
    };
    const px = (S.px = startPlugins({
      push,
      peek,
      clear: (id, pre) => setActs((l) => l.filter((i) => (pre ? !i.id.startsWith(id) : i.id !== id))),
    }));

    const onFg = (f: Fg) => {
      FG = f;
      S.off = f.full;
      S.edge = MODE === "edge" || (MODE === "auto" && f.top);
      if (!S.edge) S.eng = false;
      px.fg(f);
      push(clock());
      bump((n) => n + 1);
      S.wake();
    };
    S.mx = innerWidth / 2 + 200;
    s.sx.v = s.sx.t = S.mx;
    s.sy.v = s.sy.t = S.my;
    let last = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const cx = innerWidth / 2,
        w = S.cur.w ?? 200,
        pk = !S.off && now < S.pk;
      const ih = (S.exp ? S.big : pk) ? $("in").offsetHeight : 40;
      if (S.edge) {
        if (S.my <= 5 && Math.abs(S.mx - cx) < 160) S.eng = true;
        else if (S.my > 70) S.eng = false;
      }
      const gate = S.off || (S.edge && !S.exp && !S.eng),
        mx = gate ? cx + 200 : S.mx,
        my = gate ? 420 : S.my;
      if (pk && !S.exp && !S.was) {
        S.snap = false;
        kick("dy", 140);
        kick("dh", -90);
      }
      s.sx.t = mx;
      s.sy.t = my;
      let e = 0,
        q = 0;
      for (let n = 0; n < 2; n++) {
        const h = dt / 2,
          p = cl((280 - Math.hypot(s.sx.v - cx, s.sy.v - 34)) / 210, 0, 1);
        e = p * p * (3 - 2 * p);
        q = cl((e - 0.4) / 0.6, 0, 1);
        if (!S.exp && e > 0.8 && Math.hypot(mx - cx - s.dx.v, my - s.dy.v) < 30) {
          S.exp = true;
          S.snap = false;
          kick("dy", 140);
          kick("dh", -90);
          win.setIgnoreCursorEvents(false);
          $("card").style.pointerEvents = "auto";
        } else if (S.exp && (Math.abs(mx - cx) > s.dw.t / 2 + 70 || my > s.dh.t + 80)) {
          S.exp = false;
          setB(false);
          win.setIgnoreCursorEvents(true);
          $("card").style.pointerEvents = "none";
        }
        if (S.exp || pk) {
          s.dw.t = S.exp && S.big ? Math.max(w, 320) : w;
          s.dh.t = Math.max(40, ih);
          s.dx.t = s.ix.t = s.ar.t = 0;
          s.dy.t = 16 + s.dh.t / 2;
        } else {
          const f = cl((mx - cx) * 0.45, -55, 55) * q;
          s.dx.t = f;
          s.ix.t = f * 0.35;
          s.dy.t = q ** 1.4 * 42 + cl(Math.hypot(s.sx.x, s.sy.x) * 0.008, 0, 12) * q;
          s.dw.t = s.dh.t = q * 30;
          s.ar.t = 1.5 + e * 10 + (S.snap ? 0 : q * 6);
          const k = cl((s.dy.v - 10) / 26, 0, 1);
          if (!S.snap && q > 0.85 && k > 0.9) {
            S.snap = true;
            hapticTap("snap");
            kick("ar", -150);
            kick("dy", -230);
            kick("dw", 170);
            kick("dh", -170);
          } else if (S.snap && q < 0.7) {
            S.snap = false;
            kick("dy", -110);
            kick("ar", 80);
          }
        }
        if (S.cur !== S.want) {
          s.cf.t = 0;
          if (s.cf.v < 0.06) {
            S.cur = S.want;
            setShown(S.cur);
            s.cf.t = 1;
          }
        }
        for (const k of Object.keys(K) as Key[]) {
          const [st, c] = K[k],
            o = s[k];
          o.x += (st * (o.t - o.v) - (RM ? c * 1.5 : c) * o.x) * h;
          o.v += o.x * h;
        }
      }
      S.was = S.exp || pk;

      const X = cx + s.dx.v,
        pw = Math.max(0, s.dw.v),
        ph = Math.max(0, s.dh.v),
        k = cl((s.dy.v - 10) / 26, 0, 1);
      set("anc", { cx: cx + s.ix.v, rx: 72 - q * 28, ry: Math.max(0, s.ar.v) });
      set("drop", { x: X - pw / 2, y: s.dy.v - ph / 2, width: pw, height: ph, rx: Math.min(pw, ph) / 2 });
      set("neck", {
        x1: cx + s.ix.v,
        y1: 0,
        x2: X,
        y2: s.dy.v,
        "stroke-width": S.exp || pk || S.snap ? 0 : (22 * (1 - k) ** 1.5 + 2) * cl(q * 3, 0, 1),
      });

      const c = $("card").style;
      c.transform = `translate(${X - pw / 2}px,${s.dy.v - ph / 2}px)`;
      c.width = pw + "px";
      c.height = ph + "px";
      c.borderRadius = Math.min(pw, ph) / 2 + "px";
      c.opacity = String(cl((pw - 60) / 80, 0, 1));
      $("in").style.opacity = String(cl((pw - 0.75 * w) / 40, 0, 1) * s.cf.v);
      const moving = Object.values(s).some((o) => Math.abs(o.x) > 0.05 || Math.abs(o.t - o.v) > 0.05);
      $("g").setAttribute("filter", moving ? "url(#goo)" : "none");
      S.raf = moving || S.cur !== S.want ? requestAnimationFrame(tick) : 0;
    };

    S.wake = () => {
      if (!S.raf) {
        last = performance.now();
        S.raf = requestAnimationFrame(tick);
      }
    };

    const un = [
      listen<[number, number]>("cursor", ({ payload: [x, y] }) => {
        const far = y > 9000;
        S.mx = far ? innerWidth / 2 + 200 : x;
        S.my = far ? 420 : y;
        S.wake();
      }),
      listen<Act>("island:push", (e) => push(e.payload)),
      listen<string>("island:clear", (e) => setActs((l) => l.filter((i) => i.id !== e.payload))),
      listen<Fg>("island:fg", (e) => onFg(e.payload)),
      listen("island:reload", () => px.load()),
    ];

    invoke<Fg | null>("fg_now").then((f) => f && onFg(f)).catch(() => {});
    px.load();
    const t = setInterval(() => push(clock()), 30000);
    (navigator as unknown as { getBattery?: () => Promise<{ charging: boolean; level: number; onchargingchange: () => void }> })
      .getBattery?.()
      .then((b) => {
        b.onchargingchange = () =>
          b.charging &&
          push({
            id: "bat",
            pri: 5,
            icon: "battery",
            title: Math.round(b.level * 100) + "%",
            side: "Charging",
            p: b.level,
            color: "#30d158",
            w: 184,
            ttl: 6000,
            peek: 3000,
          });
      });

    return () => {
      un.forEach((p) => p.then((f) => f()));
      px.dispose();
      clearInterval(t);
      cancelAnimationFrame(S.raf);
    };
  }, []);

  useEffect(() => {
    S.want = acts.filter(ok).reduce((x, y) => (y.pri >= x.pri ? y : x));
    if (S.cur.id === S.want.id) {
      S.cur = S.want;
      setShown(S.want);
    }
    S.wake();
  }, [acts, ver]);

  const w = a.w ?? 200;

  return (
    <>
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <defs>
          <filter id="goo" filterUnits="userSpaceOnUse" x="-100" y="-60" width="2000" height="500" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="7" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
          </filter>
        </defs>
        <g id="g" fill="#000" stroke="#000" strokeWidth="0" strokeLinecap="round">
          <rect x="-100" y="-60" width="2000" height="60" stroke="none" />
          <ellipse id="anc" cy="0" rx="70" ry="2" stroke="none" />
          <line id="neck" />
          <rect id="drop" stroke="none" />
        </g>
      </svg>

      <div
        id="card"
        onClick={() => {
          hapticTap("pop");
          setB(!S.big);
        }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          overflow: "hidden",
          opacity: 0,
          color: "#ffffff",
          boxShadow: `inset 0 1px 0.5px 0 color-mix(in srgb, ${a.color ?? "#ffffff"} 32%, transparent), inset 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 10px 30px rgba(0, 0, 0, 0.5)`,
          font: "600 15px -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
          pointerEvents: "none",
          cursor: "pointer",
        }}
      >
        <div
          id="in"
          style={{
            position: "absolute",
            left: "50%",
            translate: "-50% 0",
            width: big ? Math.max(w, 320) : w,
            padding: "0 16px 14px",
            boxSizing: "border-box",
            userSelect: "none",
          }}
        >
          {/* Main Status Row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40 }}>
            {/* Luminous Icon Capsule */}
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: a.color
                  ? `color-mix(in srgb, ${a.color} 22%, rgba(255, 255, 255, 0.08))`
                  : "rgba(255, 255, 255, 0.1)",
                color: a.color ?? "#ffffff",
                boxShadow: a.color ? `0 0 10px ${a.color}33` : "none",
                flexShrink: 0,
                transition: "background-color 200ms ease, color 200ms ease",
              }}
            >
              {renderIcon(a.icon)}
            </div>

            {/* Title with Tabular Digits */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
              <b
                style={{
                  fontWeight: 600,
                  fontSize: 16,
                  letterSpacing: "-0.018em",
                  fontVariantNumeric: "tabular-nums",
                  fontFeatureSettings: '"tnum" 1, "cv02" 1, "cv03" 1',
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "#ffffff",
                }}
              >
                {a.title}
              </b>
            </div>

            {/* Frosted App / Status Pill */}
            {a.side && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: 9999,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "rgba(255, 255, 255, 0.75)",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "0.5px solid rgba(255, 255, 255, 0.14)",
                  backdropFilter: "blur(8px)",
                  flexShrink: 0,
                }}
              >
                {a.side}
              </span>
            )}
          </div>

          {/* Subtitle / Active Context */}
          {a.sub && (
            <div
              style={{
                fontSize: 13,
                fontWeight: 450,
                color: "rgba(255, 255, 255, 0.62)",
                marginTop: 2,
                lineHeight: 1.35,
                letterSpacing: "-0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.sub}
            </div>
          )}

          {/* Luminous Capsule Progress Bar */}
          {a.p != null && (
            <div style={{ marginTop: 10, padding: "0 1px" }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 9999,
                  background: "rgba(255, 255, 255, 0.12)",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${cl(a.p * 100, 0, 100)}%`,
                    borderRadius: 9999,
                    background: a.color
                      ? `linear-gradient(90deg, ${a.color}cc, ${a.color})`
                      : "linear-gradient(90deg, #30d158cc, #30d158)",
                    boxShadow: a.color ? `0 0 8px ${a.color}88` : "0 0 8px rgba(48, 209, 88, 0.6)",
                    transition: "width 280ms cubic-bezier(0.23, 1, 0.32, 1)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Tactile Action Buttons */}
          {a.actions && (
            <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
              {a.actions.map((x) => (
                <button
                  key={x}
                  className="drip-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    hapticTap("click");
                    emit("island:action", { id: a.id, action: x });
                    S.px?.action(a.id, x);
                  }}
                >
                  {x}
                </button>
              ))}
            </div>
          )}

          {/* Expanded Context Details when user clicks island */}
          {big && !a.actions && a.id === "clock" && FG && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: "0.5px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "rgba(255, 255, 255, 0.55)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: a.color ?? "#30d158",
                    boxShadow: `0 0 6px ${a.color ?? "#30d158"}`,
                  }}
                />
                Active Target
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{FG.exe}.exe</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
