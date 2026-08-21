import http2 from "node:http2";

/**
 * A minimal HTTP/2 client, for upstreams whose HTTP/1.1 responses Node refuses to
 * parse.
 *
 * WHY THIS EXISTS, because "we wrote our own HTTP client" needs a better reason
 * than taste. ACT Puerto Rico's IIS emits this, note the leading space:
 *
 *     Referrer-Policy: no-referrer
 *      Permissions-Policy: geolocation=(self), camera=(self), microphone=()
 *
 * Under HTTP/1.1 a line beginning with whitespace is an obs-fold continuation of
 * the previous header, and Node's parser rejects it outright — `fetch()` throws
 * "Response does not match the HTTP/1.1 protocol (Unexpected whitespace after
 * header value)" and you get NOTHING, not a degraded response. curl tolerates it,
 * which is why the endpoint looks fine when you probe it by hand and then fails the
 * moment the adapter runs. That is the entire bug.
 *
 * WHY NOT `insecureHTTPParser: true`, which also works and is one line: it turns
 * off the leniency checks that exist to stop request smuggling, for every response
 * on that connection. Trading a parser-hardening flag for a cosmetic header defect
 * is a bad deal when there is a clean alternative.
 *
 * WHY HTTP/2 IS THAT ALTERNATIVE: h2 carries headers as binary HPACK fields rather
 * than as text lines, so "a line starting with a space" is not a representable
 * defect. The malformed header simply arrives as a normal field. Verified against
 * this host on 2026-08-20 — it negotiates h2 and answers 200 with intact
 * `last-modified`, where HTTP/1.1 fetch throws.
 *
 * WHY NOT `undici`'s `allowH2` dispatcher, the other obvious answer: undici is not
 * importable as a package here (Node's copy is internal) and this repo ships ten
 * production dependencies on purpose. ~90 lines of `node:http2` is the cheaper
 * trade.
 *
 * SCOPE. This is not a general-purpose client and must not become one. It is used
 * for exactly the hosts in H2_REQUIRED_HOSTS below; everything else uses `fetch`.
 * Node runtime only — `node:http2` does not exist on Edge, which is fine because
 * nothing in this app declares the edge runtime.
 */

/**
 * The hosts that are fetched over h2 instead of `fetch`.
 *
 * Add a host here ONLY with a reproduction of the HTTP/1.1 failure, in a comment,
 * the way the ACT entry has one. Anything else belongs on plain `fetch`.
 */
export const H2_REQUIRED_HOSTS: ReadonlySet<string> = new Set([
  // Malformed ` Permissions-Policy` header — see the file header.
  "its.act.pr.gov",
]);

export function needsH2(host: string): boolean {
  return H2_REQUIRED_HOSTS.has(host);
}

export interface H2Response {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface H2RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Open one h2 session to `origin`, hand it to `fn`, and always close it.
 *
 * Exported because the sessions are the expensive part: the ACT adapter makes one
 * POST and ~31 HEADs per round, and doing that as 32 separate TLS handshakes
 * would cost more than the feed is worth. One session multiplexes the lot.
 */
export async function withH2Session<T>(
  origin: string,
  fn: (session: http2.ClientHttp2Session) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const session = await new Promise<http2.ClientHttp2Session>((resolve, reject) => {
    const s = http2.connect(origin, { timeout: timeoutMs });
    const onError = (err: Error) => {
      s.destroy();
      reject(err);
    };
    s.once("error", onError);
    s.once("connect", () => {
      s.off("error", onError);
      resolve(s);
    });
  });
  // A session-level error after connect must not surface as an unhandled event and
  // take the process down; the per-request handlers below own the failure.
  session.on("error", () => {});
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

/** One request on an open session. Never throws for an HTTP status — only for transport failure. */
export function h2Request(
  session: http2.ClientHttp2Session,
  path: string,
  init: H2RequestInit = {},
): Promise<H2Response> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = init;
  return new Promise<H2Response>((resolve, reject) => {
    const req = session.request({
      ":method": method,
      ":path": path,
      ...headers,
      ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
    });
    req.setTimeout(timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      reject(new Error(`h2 request timed out after ${timeoutMs}ms`));
    });
    let status = 0;
    let responseHeaders: Record<string, string | undefined> = {};
    const chunks: Buffer[] = [];
    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
      responseHeaders = h as Record<string, string | undefined>;
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks) }));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** One-shot convenience: open a session, make one request, close. */
export async function h2Fetch(url: string, init: H2RequestInit = {}): Promise<H2Response> {
  const u = new URL(url);
  return withH2Session(
    u.origin,
    (session) => h2Request(session, `${u.pathname}${u.search}`, init),
    init.timeoutMs,
  );
}
