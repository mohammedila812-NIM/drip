export type FgInfo = {
  exe?: string;
  title?: string;
  full?: boolean;
  max?: boolean;
  top?: boolean;
  shell?: boolean;
  mon?: [number, number, number, number];
  private?: boolean;
};

/**
 * Pure function to redact window titles for privacy.
 * When `fg.private` is true or `hideSetting` is true (e.g. drip.hideTitles = "1"),
 * the title is blanked ("").
 */
export function redactFg<T extends FgInfo | null | undefined>(fg: T, hideSetting?: boolean): T {
  if (!fg) return fg;
  const isPrivate = !!fg.private || hideSetting === true;
  if (isPrivate) {
    return {
      ...fg,
      title: "",
    };
  }
  return fg;
}
