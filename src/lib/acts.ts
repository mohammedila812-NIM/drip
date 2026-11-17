import type { Act } from "../App";

export type StoredAct = Act & {
  _seenIndex: number;
};

export function isActShallowEqual(a: Act, b: Act): boolean {
  if (
    a.id !== b.id ||
    a.pri !== b.pri ||
    a.title !== b.title ||
    a.side !== b.side ||
    a.icon !== b.icon ||
    a.sub !== b.sub ||
    a.p !== b.p ||
    a.color !== b.color ||
    a.w !== b.w ||
    a.ttl !== b.ttl ||
    a.peek !== b.peek
  ) {
    return false;
  }
  if (a.when?.app !== b.when?.app) return false;
  if (a.actions !== b.actions) {
    if (!a.actions || !b.actions) return false;
    if (a.actions.length !== b.actions.length) return false;
    for (let i = 0; i < a.actions.length; i++) {
      if (a.actions[i] !== b.actions[i]) return false;
    }
  }
  return true;
}

export class ActStore {
  private acts: StoredAct[] = [];
  private nextIndex = 0;

  getActs(): Act[] {
    return [...this.acts];
  }

  upsert(act: Act): { acts: Act[]; changed: boolean } {
    const idx = this.acts.findIndex((a) => a.id === act.id);
    if (idx !== -1) {
      const existing = this.acts[idx];
      if (isActShallowEqual(existing, act)) {
        return { acts: [...this.acts], changed: false };
      }
      // Replace in place: preserves array index and original _seenIndex
      this.acts[idx] = {
        ...act,
        _seenIndex: existing._seenIndex,
      };
    } else {
      // New act: append at end with new _seenIndex
      this.acts.push({
        ...act,
        _seenIndex: this.nextIndex++,
      });
    }
    return { acts: [...this.acts], changed: true };
  }

  remove(id: string, prefix = false): { acts: Act[]; changed: boolean } {
    const len = this.acts.length;
    this.acts = this.acts.filter((a) => (prefix ? !a.id.startsWith(id) : a.id !== id));
    return { acts: [...this.acts], changed: this.acts.length !== len };
  }

  select(filterFn: (act: Act) => boolean, pinnedId: string | null, fallback: Act): Act {
    const valid = this.acts.filter(filterFn);
    if (pinnedId) {
      const p = valid.find((a) => a.id === pinnedId);
      if (p) return p;
    }
    if (valid.length === 0) return fallback;

    // Highest priority wins; ties broken by stable _seenIndex (first-seen wins)
    return valid.reduce((best, curr) => {
      if (curr.pri > best.pri) return curr;
      if (curr.pri === best.pri) {
        return curr._seenIndex < best._seenIndex ? curr : best;
      }
      return best;
    });
  }

  clear(): void {
    this.acts = [];
    this.nextIndex = 0;
  }
}
