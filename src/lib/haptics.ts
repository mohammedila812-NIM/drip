export type HapticType = "snap" | "click" | "pop";

let sharedCtx: AudioContext | null = null;
let listenerAttached = false;
let currentResumeHandler: (() => void) | null = null;

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem("drip.sound") === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem("drip.sound", enabled ? "1" : "0");
  } catch {}
}

export function getAudioContext(): AudioContext | null {
  if (!isSoundEnabled()) return null;
  if (!sharedCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      sharedCtx = new AudioContextClass();
    }
  }
  if (sharedCtx && !listenerAttached && typeof window !== "undefined") {
    listenerAttached = true;
    const resume = async () => {
      if (!sharedCtx) return;
      if (sharedCtx.state === "suspended") {
        try {
          await sharedCtx.resume();
          window.removeEventListener("pointerdown", resume);
          listenerAttached = false;
          currentResumeHandler = null;
        } catch {
          // If resume() rejects, keep the pointerdown listener for the next gesture
        }
      } else {
        window.removeEventListener("pointerdown", resume);
        listenerAttached = false;
        currentResumeHandler = null;
      }
    };
    currentResumeHandler = resume;
    window.addEventListener("pointerdown", resume);
  }
  return sharedCtx;
}

export function _resetHapticsState(): void {
  if (currentResumeHandler && typeof window !== "undefined") {
    window.removeEventListener("pointerdown", currentResumeHandler);
    currentResumeHandler = null;
  }
  sharedCtx = null;
  listenerAttached = false;
}

export function triggerHapticTap(type: HapticType = "click"): void {
  const rm = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (rm) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
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
