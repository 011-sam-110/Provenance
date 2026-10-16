// A GET for the few upstreams Node's global fetch cannot read, used ONLY as a fallback
// after fetch has failed in the specific way it fixes.
//
// WHY NOT fetch(), in two measured cases (2026-10-16):
//   - Every usembassy.gov response carries a ~16 KB Content-Security-Policy header. Node's
//     fetch refuses any response whose headers pass 16 KB (UND_ERR_HEADERS_OVERFLOW), so
//     the embassy alert feeds cannot be read with it at all. `maxHeaderSize` fixes that
//     for one request only.
//   - Some free APIs have no IPv6 support but publish an AAAA record. `family: 4` pins
//     one request to IPv4 without changing name resolution for the whole process.
//
// WHY A FALLBACK AND NOT THE FIRST CALL. Every adapter's failure path is tested by
// stubbing the global fetch (tests/unit/signals-outcome.test.ts). An adapter that went
// straight to node:https would skip the stub and reach the real network from a unit
// test. So adapters call fetch first, and come here only on the failure this fixes;
// `fallbackWorth()` says which failures those are.
//
// WHY process.getBuiltinModule AND NOT AN IMPORT. Client components import the signals
// registry, so an `import ... from "node:https"` here would put a Node builtin into the
// browser bundle and break `next build` (tests/unit/client-bundle-node-builtins.test.ts).
// getBuiltinModule (Node 20.16+, 22.3+) loads it at call time, on the server only.
//
// Never throws: any failure resolves to null. Follows up to three redirects and gunzips
// a gzip body.

export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  family?: 4 | 6;
  /** Largest response header block accepted, in bytes. Node's default is 16 KB. */
  maxHeaderSize?: number;
  /** Abort a body larger than this many bytes. */
  maxBytes?: number;
}

export interface HttpGetResult {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
  /** The URL that answered, after redirects. */
  url: string;
}

/** The request options node:https gets. Pure, exported for the tests. */
export function httpGetOptions(opts: HttpGetOptions = {}): {
  method: "GET";
  headers: Record<string, string>;
  timeout: number;
  family?: 4 | 6;
  maxHeaderSize?: number;
} {
  return {
    method: "GET",
    headers: { "Accept-Encoding": "gzip", ...(opts.headers ?? {}) },
    timeout: opts.timeoutMs ?? 20_000,
    ...(opts.family ? { family: opts.family } : {}),
    ...(opts.maxHeaderSize ? { maxHeaderSize: opts.maxHeaderSize } : {}),
  };
}

/**
 * Pure: is this fetch failure one the fallback fixes? Node's fetch throws a TypeError
 * whose `cause.code` names the low-level failure. A plain error with no such code (a
 * test stub, an abort) is not retried.
 */
export function fallbackWorth(err: unknown, codes: readonly string[]): boolean {
  const code = (err as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && codes.includes(code);
}

// Minimal structural types, so no `node:` specifier appears in this file's imports.
interface IncomingLike {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(ev: "data", cb: (c: Uint8Array) => void): void;
  on(ev: "end" | "error", cb: () => void): void;
  resume(): void;
}
interface RequestLike {
  on(ev: "timeout" | "error", cb: () => void): void;
  destroy(err?: Error): void;
  end(): void;
}
interface HttpsLike {
  request(url: string, opts: object, cb: (res: IncomingLike) => void): RequestLike;
}
interface ZlibLike {
  gunzipSync(buf: Uint8Array): Uint8Array;
}

function builtin<T>(id: string): T | undefined {
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  return typeof get === "function" ? (get(id) as T | undefined) : undefined;
}

export function httpGet(url: string, opts: HttpGetOptions = {}, redirectsLeft = 3): Promise<HttpGetResult | null> {
  const https = builtin<HttpsLike>("node:https");
  const zlib = builtin<ZlibLike>("node:zlib");
  if (!https || !zlib) return Promise.resolve(null);
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: HttpGetResult | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = https.request(url, httpGetOptions(opts), (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && typeof location === "string" && redirectsLeft > 0) {
          res.resume();
          httpGet(new URL(location, url).toString(), opts, redirectsLeft - 1).then(done, () => done(null));
          return;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error("too large"));
            done(null);
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          try {
            let buf: Uint8Array = Buffer.concat(chunks);
            if (String(res.headers["content-encoding"] ?? "").toLowerCase() === "gzip" && buf.length > 0) {
              buf = zlib.gunzipSync(buf);
            }
            const headers: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
            done({ status, headers, body: Buffer.from(buf).toString("utf8"), url });
          } catch {
            done(null);
          }
        });
        res.on("error", () => done(null));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => done(null));
      req.end();
    } catch {
      done(null);
    }
  });
}
