import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  MIN_SLUG_LENGTH,
  PRIVATE_COOKIE,
  PRIVATE_TOKEN_PREFIX,
  isPrivatePath,
  privateClearCookieHeader,
  privateCookieHeader,
  privateToken,
  readPrivateConfig,
} from "@/lib/gate/private";
import { GATE_COOKIE, GATE_TOKEN_PREFIX, gateToken } from "@/lib/gate/token";
import { privateUnlockHtml } from "@/lib/gate/private.page";

/**
 * The private endpoint is one unlisted path behind one password. It is not an account
 * system and does not pretend to be — what these tests hold is the small set of
 * properties that make it worth having at all: it is OFF unless deliberately
 * configured, it cannot be configured weakly by accident, and it does not share a
 * session with the maintenance curtain.
 */

const ok = {
  PRIVATE_PREVIEW_SLUG: "s7fQ2x9LmR4bVn8pKd3W",
  PRIVATE_PREVIEW_PASSWORD: "correct-horse-battery",
};

describe("readPrivateConfig — off unless deliberately configured", () => {
  it("returns null on an empty environment, which is every preview build and every fork", () => {
    // The DEFAULT is no private endpoint. A fork of this repo, a Vercel preview and a
    // fresh clone all land here, so this has to be the safe direction rather than the
    // exceptional one.
    expect(readPrivateConfig({})).toBeNull();
  });

  it("returns null when only one half is set", () => {
    expect(readPrivateConfig({ PRIVATE_PREVIEW_SLUG: ok.PRIVATE_PREVIEW_SLUG })).toBeNull();
    expect(readPrivateConfig({ PRIVATE_PREVIEW_PASSWORD: ok.PRIVATE_PREVIEW_PASSWORD })).toBeNull();
  });

  it("REFUSES a guessable slug rather than serving a barely-hidden endpoint", () => {
    // The slug is the first factor. "preview" or "streets" is not a secret, and a
    // deployment configured that way would look configured while being open to anyone
    // who tries the obvious word.
    for (const slug of ["preview", "streets", "demo", "a", "x".repeat(MIN_SLUG_LENGTH - 1)]) {
      expect(readPrivateConfig({ ...ok, PRIVATE_PREVIEW_SLUG: slug })).toBeNull();
    }
    expect(readPrivateConfig({ ...ok, PRIVATE_PREVIEW_SLUG: "x".repeat(MIN_SLUG_LENGTH) })).not.toBeNull();
  });

  it("REFUSES a slug that is not one plain path segment", () => {
    // `/`, `.` and `%` are the shapes that turn a mis-set variable into path traversal
    // or a matcher that swallows more of the site than one route.
    for (const bad of ["with/slash/inside0", "dots.in.the.slug.x", "percent%20encoded1", "has spaces here x"]) {
      expect(readPrivateConfig({ ...ok, PRIVATE_PREVIEW_SLUG: bad })).toBeNull();
    }
  });

  it("REFUSES a trivially short password", () => {
    expect(readPrivateConfig({ ...ok, PRIVATE_PREVIEW_PASSWORD: "1234" })).toBeNull();
    expect(readPrivateConfig({ ...ok, PRIVATE_PREVIEW_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH) })).not.toBeNull();
  });

  it("trims, because these are pasted into a dashboard field by hand", () => {
    // A trailing newline is the commonest way to set a variable to something that
    // looks right and is not — and it would fail as a silent 404, the hardest kind to
    // diagnose from outside.
    const cfg = readPrivateConfig({
      PRIVATE_PREVIEW_SLUG: `  ${ok.PRIVATE_PREVIEW_SLUG}\n`,
      PRIVATE_PREVIEW_PASSWORD: ` ${ok.PRIVATE_PREVIEW_PASSWORD} `,
    });
    expect(cfg).toEqual({ slug: ok.PRIVATE_PREVIEW_SLUG, password: ok.PRIVATE_PREVIEW_PASSWORD });
  });
});

describe("isPrivatePath", () => {
  const slug = ok.PRIVATE_PREVIEW_SLUG;

  it("matches the slug and everything under it", () => {
    expect(isPrivatePath(`/${slug}`, slug)).toBe(true);
    expect(isPrivatePath(`/${slug}/`, slug)).toBe(true);
    expect(isPrivatePath(`/${slug}/anything/deeper`, slug)).toBe(true);
  });

  it("does not match a path that merely STARTS with the slug", () => {
    // `/<slug>evil` must not be inside the gate — but more importantly it must not be
    // treated as private and rewritten to the console either.
    expect(isPrivatePath(`/${slug}extra`, slug)).toBe(false);
  });

  it("does not match the unlock endpoint, so the door cannot lock its own key inside", () => {
    // The form posts to /api/private. If that path were ever inside the gate, opening
    // the gate would require already being through it.
    expect(isPrivatePath("/api/private", slug)).toBe(false);
  });

  it("is case SENSITIVE, because folding case would shrink the search space", () => {
    expect(isPrivatePath(`/${slug.toLowerCase()}`, slug)).toBe(false);
  });

  it("leaves the ordinary site alone", () => {
    for (const p of ["/", "/app", "/api/cameras", "/camera/tfl:JamCams_00001.01234"]) {
      expect(isPrivatePath(p, slug)).toBe(false);
    }
  });
});

describe("the private session is NOT the maintenance session", () => {
  it("uses a different cookie name", () => {
    expect(PRIVATE_COOKIE).not.toBe(GATE_COOKIE);
  });

  it("derives a DIFFERENT token from the same password, so neither cookie can be replayed at the other gate", () => {
    // This is the privilege leak the two-cookie design exists to prevent: letting
    // someone through a maintenance window must not silently hand them the
    // unreleased surface as well. If the prefixes ever collided, a maintenance cookie
    // would validate at the private endpoint and nobody would think to look.
    expect(PRIVATE_TOKEN_PREFIX).not.toBe(GATE_TOKEN_PREFIX);
  });

  it("and proves it on a real hash rather than on the constants alone", async () => {
    const password = "the-same-password-in-both";
    const [priv, maint] = await Promise.all([privateToken(password), gateToken(password)]);
    expect(priv).not.toBe(maint);
    expect(priv).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, so every instance validates it with the env var and no server state", async () => {
    expect(await privateToken("abc")).toBe(await privateToken("abc"));
    expect(await privateToken("abc")).not.toBe(await privateToken("abd"));
  });

  it("never puts the password itself in the cookie", async () => {
    const password = "correct-horse-battery";
    expect(await privateToken(password)).not.toContain(password);
  });
});

describe("cookie headers", () => {
  it("is HttpOnly and SameSite=Lax, and Secure only over https", () => {
    const secure = privateCookieHeader("t", true);
    expect(secure).toContain("HttpOnly");
    expect(secure).toContain("SameSite=Lax");
    expect(secure).toContain("Secure");
    // Local development is http, and a Secure cookie there is simply never stored —
    // which would look like the password being refused.
    expect(privateCookieHeader("t", false)).not.toContain("Secure");
  });

  it("expires in days, not the maintenance gate's month", () => {
    const maxAge = Number(/Max-Age=(\d+)/.exec(privateCookieHeader("t", true))![1]);
    expect(maxAge).toBe(60 * 60 * 24 * 7);
  });

  it("clears with Max-Age=0 so a stale cookie from a rotated password can be shed", () => {
    // Without this, a browser holding the old cookie is refused at the edge forever
    // and the form appears to accept the new password and then bounce.
    expect(privateClearCookieHeader(true)).toContain("Max-Age=0");
    expect(privateClearCookieHeader(true)).toContain(`${PRIVATE_COOKIE}=;`);
  });
});

describe("the unlock page", () => {
  const html = privateUnlockHtml({ next: "/somewhere", denied: false });

  it("is noindex, which is the OPPOSITE of the maintenance curtain's deliberate choice", () => {
    // The curtain omits noindex on purpose: it answers 503 so crawlers keep ~20k
    // camera pages in the index. Nothing is meant to find this page at all.
    expect(html).toContain("noindex");
  });

  it("offers the source, because AGPL section 13 covers whoever reaches the DOOR", () => {
    expect(html).toContain("github.com/011-sam-110/Provenance");
  });

  it("names nothing behind it", () => {
    // Someone who guessed the path should learn only that a password exists.
    expect(html.toLowerCase()).not.toContain("streets");
    expect(html.toLowerCase()).not.toContain("unreleased");
  });

  it("escapes `next` into the hidden field rather than trusting the caller", () => {
    const evil = privateUnlockHtml({ next: '/x"><script>alert(1)</script>', denied: false });
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&quot;");
  });

  it("says so when a password was refused, and stays quiet otherwise", () => {
    expect(html).not.toContain("not accepted");
    expect(privateUnlockHtml({ next: "/x", denied: true })).toContain("not accepted");
  });
});
