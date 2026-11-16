import type { Act } from "../App";

export type StoredAct = Act & {
  _seenIndex: number;
};

export class ActStore {
  private acts: StoredAct[] = [];
  private nextIndex = 0;

  getActs(): Act[] {
    return this.acts;
  }

  upsert(act: Act): { acts: Act[]; changed: boolean } {
    const idx = this.acts.findIndex((a) => a.id === act.id);
    if (idx !== -1) {
      // Replace in place: preserves array index and original _seenIndex
      const existing = this.acts[idx];
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
