// The globe in the Discord pop-up: one dot for each member Discord reports, green for the
// ones online. PURE geometry, so a test can hold "one dot per member" without a canvas.
//
// The dots sit on a Fibonacci sphere, which spaces any number of points evenly. So the ball
// looks right at 265 members and gets denser as the server grows.

/** Past this the canvas is solid white and more dots only cost time. */
export const MAX_DOTS = 3_000;
/** Used when Discord gave no count. Nothing on screen says a dot is a member in that case. */
export const FALLBACK_DOTS = 240;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface GlobeDot {
  x: number;
  y: number;
  z: number;
  online: boolean;
}

export function memberDots(members: number | null, online: number | null): GlobeDot[] {
  const n = Math.min(MAX_DOTS, members !== null && members > 0 ? Math.floor(members) : FALLBACK_DOTS);
  const lit = members === null ? 0 : Math.min(n, Math.max(0, Math.floor(online ?? 0)));
  const litAt = new Set<number>();
  for (let k = 0; k < lit; k++) litAt.add(Math.floor(((k + 0.5) * n) / lit));
  const dots: GlobeDot[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLDEN_ANGLE;
    dots.push({ x: r * Math.cos(a), y, z: r * Math.sin(a), online: litAt.has(i) });
  }
  return dots;
}

/** The dot's size for a ball of this many dots: smaller as the server grows, never unreadable. */
export function dotRadius(count: number, ballRadius: number): number {
  const spacing = ballRadius * Math.sqrt((4 * Math.PI) / Math.max(1, count));
  return Math.min(3.2, Math.max(0.9, spacing * 0.085));
}

/** Turn a dot about the vertical axis, then tip the whole ball towards the viewer. */
export function turnDot(d: Pick<GlobeDot, "x" | "y" | "z">, spin: number, tilt: number) {
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const x = d.x * cs + d.z * ss;
  const z = -d.x * ss + d.z * cs;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return { x, y: d.y * ct - z * st, z: d.y * st + z * ct };
}
