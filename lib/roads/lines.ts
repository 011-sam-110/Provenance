// Road lines as the console sends them: no finer than the map can show. Pure, pinned by
// tests/unit/roads-digitraffic.test.ts.
//
// The operators send their roads at survey detail (Fintraffic's road works: 106,444 points
// on 27 Oct 2026). The console draws a road notice as a pattern on the road, so a point
// every few metres buys nothing on screen and costs every visitor the download. Each line
// is simplified to about 10 m and rounded to 5 decimals (about 1 m) before it leaves.

/** About 10 m in degrees: a line is drawn no finer than this. */
export const SIMPLIFY_DEG = 0.0001;

/** Distance from p to the segment a-b, in degrees (flat: lines here are short). */
function offset(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

/**
 * Pure: Ramer-Douglas-Peucker. Keeps both ends and every point that lies more than
 * `tolerance` degrees off the line through its neighbours, then rounds to 5 decimals.
 */
export function simplifyLine(line: readonly [number, number][], tolerance = SIMPLIFY_DEG): [number, number][] {
  if (line.length <= 2) return line.map(([x, y]) => [round5(x), round5(y)]);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = offset(line[k], line[i], line[j]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at > 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return line.filter((_, k) => keep[k] === 1).map(([x, y]) => [round5(x), round5(y)]);
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
