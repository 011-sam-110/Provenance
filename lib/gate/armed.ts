/**
 * Is the maintenance curtain armed?
 *
 * WHY THIS IS A FUNCTION AND NOT `if (process.env.MAINTENANCE_MODE)`.
 *
 * It was that expression, and the expression was correct on Vercel, where a variable is
 * a row in a dashboard: you ARM the gate by adding `MAINTENANCE_MODE`, and you DISARM it
 * by deleting the row. There is no third state, so "set at all" and "on" mean the same
 * thing and truthiness is the whole rule.
 *
 * Self-hosted, the variable is a line in a file that a person edits by hand, and the
 * universal idiom in that file is `VAR=0` for off. Under the old expression `"0"` is a
 * non-empty string, so it is TRUTHY, so writing the most natural possible way of saying
 * "off" takes the entire site down and serves a curtain to everyone. Nothing errors and
 * nothing logs; the site is simply gone, in exactly the way the author was trying to
 * prevent. The gate already has one incident of this shape on its record — it was
 * reported as "the password not working" when in fact the variable had never been set,
 * so no password was being checked at all.
 *
 * So the migration changed the interface, and this meets the new interface: the words a
 * person writes in a .env file to mean "off" mean off. Everything else still arms it,
 * including any value not on the list, because the failure direction has not changed —
 * an unrecognised value leaves the site DOWN and costing nothing, never UP and billing.
 */
const OFF = new Set(["", "0", "false", "off", "no"]);

export function isMaintenanceArmed(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.MAINTENANCE_MODE;
  if (raw === undefined) return false;
  return !OFF.has(raw.trim().toLowerCase());
}
