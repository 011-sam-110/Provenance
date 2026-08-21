import { expect, test } from "vitest";
import { needsH2, H2_REQUIRED_HOSTS } from "@/lib/http/h2";
import { isAllowed } from "@/lib/proxy/allowlist";

// This set is a LIABILITY LIST, not a feature list: every host on it is one whose
// HTTP/1.1 we could not parse. It should grow only with a reproduction, and these
// tests exist mostly to make an idle addition feel deliberate.

test("only the hosts with a documented HTTP/1.1 defect are routed over h2", () => {
  expect([...H2_REQUIRED_HOSTS]).toEqual(["its.act.pr.gov"]);
});

test("matches on exact host, never on a suffix", () => {
  expect(needsH2("its.act.pr.gov")).toBe(true);
  // The obvious way to write this rule wrong. An attacker-registered
  // "its.act.pr.gov.example.com" must not inherit special handling.
  expect(needsH2("its.act.pr.gov.example.com")).toBe(false);
  expect(needsH2("evil-its.act.pr.gov")).toBe(false);
  expect(needsH2("act.pr.gov")).toBe(false);
  expect(needsH2("")).toBe(false);
});

// h2 routing is a TRANSPORT choice and must never widen what the proxy will serve.
// Every h2 host still has to earn its place in the image allowlist separately.
test("being an h2 host grants no proxy access by itself", () => {
  for (const host of H2_REQUIRED_HOSTS) {
    expect(isAllowed(new URL(`https://${host}/`))).toBe(false);
    expect(isAllowed(new URL(`https://${host}/etc/passwd`))).toBe(false);
  }
  // ...while the paths the adapter actually emits do pass.
  expect(isAllowed(new URL("https://its.act.pr.gov/images/cameras/SJCAM07.jpg"))).toBe(true);
});
