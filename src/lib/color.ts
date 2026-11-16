const COLOR_REGEX = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/a-z-]+\))$/i;

export function isValidColor(color?: string | null): boolean {
  if (!color || typeof color !== "string") return false;
  return COLOR_REGEX.test(color.trim());
}

/**
 * Produces a transparent alpha tint using modern CSS color-mix:
 * color-mix(in srgb, <color> <pct>%, transparent)
 *
 * @param color CSS color string (hex, rgb, hsl)
 * @param pct Fraction between 0 and 1 (or 0 to 100 if > 1)
 * @param fallback Fallback color when input is invalid
 */
export function alpha(color: string | undefined | null, pct: number, fallback = "rgba(255, 255, 255, 0.12)"): string {
  if (!color || !isValidColor(color)) {
    return fallback;
  }
  const cleanColor = color.trim();
  // Normalize percentage: if <= 1 treat as ratio 0..1, else 0..100
  const normalizedPct = pct <= 1 ? pct * 100 : pct;
  const clampedPct = Math.max(0, Math.min(100, Math.round(normalizedPct)));
  return `color-mix(in srgb, ${cleanColor} ${clampedPct}%, transparent)`;
}
