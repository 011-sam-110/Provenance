"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SatelliteInset } from "@/components/admin/SatelliteInset";
import type { Candidate, CameraVerdict, ReviewLedger, SampleCamera } from "@/lib/discovery/types";

/**
 * The review deck: one camera, one decision, next camera.
 *
 * WHY ONE AT A TIME. A grid of thumbnails gets skimmed, and skimming is how a pin 400 m
 * into a field gets approved — the picture looks like a road because every picture
 * looks like a road at 180 px. The unit of work here is a photograph big enough to
 * judge and a coordinate you can check against imagery, and the cost of that choice is
 * that reviewing is slower per camera and much harder to do carelessly. That is the
 * trade the whole subsystem is built around.
 *
 * WHY THE KEYBOARD MATTERS. The bottleneck in this pipeline is a person's attention,
 * and reaching for a mouse between every card spends it on aiming rather than looking.
 * Every verdict is one key, the hand never moves, and the reviewer's eyes stay on the
 * picture.
 *
 * WHAT A VERDICT MEANS. `good` is the only one that counts towards admitting a feed.
 * The three rejections are kept apart rather than folded into one because they mean
 * different things about the FEED: a dead picture is usually one camera, a wrong pin
 * is usually a wrong column and therefore every camera, and "not a camera" usually
 * means the dataset is a list of something else. A reviewer who sees three bad pins in
 * a row should reject the feed, not the cameras — and can only notice that if the
 * three were recorded distinctly.
 */

interface DeckItem {
  candidate: Candidate;
  sample: SampleCamera;
}

const VERDICT_KEYS: Record<string, CameraVerdict["verdict"]> = {
  arrowright: "good",
  g: "good",
  arrowleft: "bad-image",
  b: "bad-image",
  p: "bad-pin",
  n: "not-a-camera",
  u: "unsure",
  arrowup: "unsure",
};

const VERDICT_LABEL: Record<CameraVerdict["verdict"], string> = {
  good: "Good camera",
  "bad-image": "Picture is dead",
  "bad-pin": "Pin is wrong",
  "not-a-camera": "Not a camera",
  unsure: "Not sure",
};

/**
 * Who is reviewing. Typed by the person, kept in their own browser, and sent with
 * every verdict.
 *
 * Deliberately NOT an environment variable. It would have been one line, but this
 * repository fails its own suite for any undeclared `process.env` read, and the
 * exemption list that would silence that is for credentials the deployment owns —
 * which a display name is not. More to the point, an env var records the machine and
 * this records the person, and the ledger's whole value is that a verdict has an
 * author. `discovered.data.ts` carries rows signed by an agent session and rows signed
 * by Sampo, and telling those apart later is only possible if the difference was
 * recorded at the time.
 */
const REVIEWER_KEY = "provenance.reviewer";

export function ReviewDeck({
  candidates,
  ledger: initialLedger,
}: {
  candidates: Candidate[];
  ledger: ReviewLedger;
}) {
  const [ledger, setLedger] = useState(initialLedger);
  const [reviewer, setReviewer] = useState("");
  const [index, setIndex] = useState(0);
  const [imageNonce, setImageNonce] = useState(0);
  const [imageState, setImageState] = useState<"loading" | "ok" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The two fields discovery cannot get right and must not fake. Pre-filled with the
  // catalogue's best offer, which on the first live run was a mailbox and an Esri
  // account slug — so they are inputs, not labels.
  const [operator, setOperator] = useState("");
  const [attribution, setAttribution] = useState("");

  // Undecided feeds only, best candidate first, and every sample of each in turn.
  const deck = useMemo<DeckItem[]>(() => {
    const decided = new Set(ledger.feeds.filter((f) => f.verdict !== "hold").map((f) => f.candidateId));
    return candidates
      .filter((c) => !decided.has(c.id))
      .filter((c) => !c.gates.some((g) => g.status === "fail"))
      .flatMap((candidate) => candidate.samples.map((sample) => ({ candidate, sample })));
    // `ledger.feeds` is deliberately NOT in the dependency list of the item ordering:
    // admitting a feed mid-session would otherwise re-cut the deck under the
    // reviewer's cursor and jump them to a different camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const item = deck[index];
  const verdictFor = useCallback(
    (candidateId: string, nativeId: string) =>
      ledger.cameras.find((v) => v.candidateId === candidateId && v.nativeId === nativeId)?.verdict,
    [ledger],
  );

  useEffect(() => {
    setImageState("loading");
    setImageNonce(0);
  }, [index]);

  useEffect(() => {
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) ?? "");
  }, []);

  const nameReviewer = useCallback((name: string) => {
    setReviewer(name);
    window.localStorage.setItem(REVIEWER_KEY, name);
  }, []);

  const post = useCallback(async (body: Record<string, unknown>, path: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, by: reviewer }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Request failed with " + res.status);
        return null;
      }
      if (json.ledger) setLedger(json.ledger as ReviewLedger);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [reviewer]);

  const currentCandidateId = deck[index]?.candidate.id;
  useEffect(() => {
    const c = deck.find((d) => d.candidate.id === currentCandidateId)?.candidate;
    setOperator(c?.descriptor.name ?? "");
    setAttribution(c?.descriptor.attribution ?? "");
  }, [currentCandidateId, deck]);

  const judge = useCallback(
    async (verdict: CameraVerdict["verdict"]) => {
      if (!item) return;
      // Advance immediately rather than after the round trip. The write is a local
      // file and it does not fail in practice, and making the reviewer wait for it
      // between every card is the difference between reviewing 200 cameras and 40.
      setIndex((i) => Math.min(i + 1, deck.length));
      await post(
        { kind: "camera", candidateId: item.candidate.id, nativeId: item.sample.nativeId, verdict },
        "/api/admin/verdict",
      );
    },
    [item, deck.length, post],
  );

  const undo = useCallback(async () => {
    const prev = Math.max(0, index - 1);
    setIndex(prev);
    const target = deck[prev];
    if (target) {
      await post(
        { kind: "camera", candidateId: target.candidate.id, nativeId: target.sample.nativeId, verdict: null },
        "/api/admin/verdict",
      );
    }
  }, [index, deck, post]);

  const decideFeed = useCallback(
    async (verdict: "admit" | "reject" | "hold") => {
      if (!item) return;
      let reason: string | undefined;
      if (verdict !== "admit") {
        const answer = window.prompt("Why " + verdict + " " + item.candidate.descriptor.key + "?");
        if (answer === null) return;
        if (!answer.trim()) {
          setError("A reason is required to reject or hold a feed.");
          return;
        }
        reason = answer.trim();
      }
      const done = await post(
        {
          kind: "feed",
          candidateId: item.candidate.id,
          verdict,
          reason,
          name: operator.trim(),
          attribution: attribution.trim(),
        },
        "/api/admin/verdict",
      );
      if (!done) return;
      // Skip past every remaining camera of a feed that has just been decided.
      const nextIndex = deck.findIndex((d, i) => i > index && d.candidate.id !== item.candidate.id);
      setIndex(nextIndex === -1 ? deck.length : nextIndex);
    },
    [item, deck, index, post, operator, attribution],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "backspace") {
        e.preventDefault();
        void undo();
        return;
      }
      if (key === "r") {
        e.preventDefault();
        setImageState("loading");
        setImageNonce((n) => n + 1);
        return;
      }
      if (key === "a" && e.shiftKey) {
        e.preventDefault();
        void decideFeed("admit");
        return;
      }
      if (key === "x" && e.shiftKey) {
        e.preventDefault();
        void decideFeed("reject");
        return;
      }
      const verdict = VERDICT_KEYS[key];
      if (verdict) {
        e.preventDefault();
        void judge(verdict);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [judge, undo, decideFeed]);

  const tally = useMemo(() => {
    if (!item) return { good: 0, seen: 0 };
    const mine = ledger.cameras.filter((v) => v.candidateId === item.candidate.id);
    return { good: mine.filter((v) => v.verdict === "good").length, seen: mine.length };
  }, [ledger, item]);

  if (!reviewer) {
    return (
      <form
        className="adm-empty"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("name");
          if (typeof value === "string" && value.trim()) nameReviewer(value.trim());
        }}
      >
        <p>Who is reviewing?</p>
        <p style={{ fontSize: 13 }}>
          Every verdict is signed with this name and committed to the ledger. Use the name you want
          to see beside a camera network in six months, not a handle nobody will recognise.
        </p>
        <p>
          <input name="name" className="adm-input" placeholder="Your name" autoFocus />{" "}
          <button className="adm-btn" type="submit" style={{ display: "inline-flex" }}>
            Start reviewing
          </button>
        </p>
      </form>
    );
  }

  if (deck.length === 0) {
    return (
      <div className="adm-empty">
        <p>Nothing waiting.</p>
        <p style={{ fontSize: 13 }}>
          Every queued candidate has a feed verdict, or none passed the gates. Run discovery from the
          Overview to look for more.
        </p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="adm-empty">
        <p>End of the deck — {deck.length} cameras reviewed this session.</p>
        <p style={{ fontSize: 13 }}>
          Feeds you admitted are recorded in the ledger. Promote them from the Overview to write
          <code> lib/sources/discovered.data.ts</code>, then read the diff before committing.
        </p>
      </div>
    );
  }

  const { candidate, sample } = item;
  const media = sample.imageUrl ?? sample.streamUrl;
  const proxied = sample.imageUrl
    ? "/api/admin/image?url=" + encodeURIComponent(sample.imageUrl) + (imageNonce ? "&n=" + imageNonce : "")
    : null;
  const existing = verdictFor(candidate.id, sample.nativeId);

  return (
    <>
      <div className="adm-progress">
        <span>
          {index + 1} / {deck.length}
        </span>
        <span className="adm-progress-track">
          <span className="adm-progress-fill" style={{ width: ((index + 1) / deck.length) * 100 + "%" }} />
        </span>
        <span>{candidate.descriptor.key}</span>
      </div>

      {error && <div className="adm-note">{error}</div>}

      <div className="adm-review">
        <div>
          <div className="adm-frame">
            {proxied ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={proxied}
                  src={proxied}
                  alt={sample.name}
                  onLoad={() => setImageState("ok")}
                  onError={() => setImageState("error")}
                  style={{ display: imageState === "error" ? "none" : "block" }}
                />
                {imageState === "error" && (
                  <p className="adm-frame-msg">
                    This picture did not load.
                    <br />
                    That is a verdict, not a bug — press B.
                  </p>
                )}
              </>
            ) : (
              <p className="adm-frame-msg">
                Video only, no still image.
                <br />
                {sample.streamUrl}
              </p>
            )}
          </div>

          <div className="adm-verdicts" style={{ marginTop: 12 }}>
            <button className="adm-btn adm-btn-good" onClick={() => void judge("good")} disabled={busy}>
              Good camera <kbd>&rarr;</kbd>
            </button>
            <button className="adm-btn adm-btn-bad" onClick={() => void judge("bad-image")} disabled={busy}>
              Picture is dead <kbd>&larr;</kbd>
            </button>
            <button className="adm-btn adm-btn-bad" onClick={() => void judge("bad-pin")} disabled={busy}>
              Pin is wrong <kbd>P</kbd>
            </button>
            <button className="adm-btn adm-btn-bad" onClick={() => void judge("not-a-camera")} disabled={busy}>
              Not a camera <kbd>N</kbd>
            </button>
            <button className="adm-btn" onClick={() => void judge("unsure")} disabled={busy}>
              Not sure <kbd>U</kbd>
            </button>
            <button className="adm-btn" onClick={() => void undo()} disabled={busy || index === 0}>
              Back <kbd>&#9003;</kbd>
            </button>
          </div>
        </div>

        <aside className="adm-side">
          <h2 className="adm-cam-name">{sample.name}</h2>
          <p className="adm-cam-sub">
            {candidate.descriptor.name} · {candidate.descriptor.country}
            {sample.road ? " · " + sample.road : ""}
          </p>

          <SatelliteInset lat={sample.lat} lon={sample.lon} />

          <dl className="adm-kv">
            <dt>Coordinate</dt>
            <dd>
              {sample.lat.toFixed(5)}, {sample.lon.toFixed(5)}{" "}
              <a
                href={`https://www.openstreetmap.org/?mlat=${sample.lat}&mlon=${sample.lon}#map=17/${sample.lat}/${sample.lon}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                OSM
              </a>
            </dd>
            <dt>Licence</dt>
            <dd>{candidate.descriptor.license}</dd>
            <dt>Found via</dt>
            <dd>
              <a href={candidate.provenance.discoveredVia} target="_blank" rel="noreferrer noopener">
                {candidate.provenance.probe}
              </a>
            </dd>
            <dt>Media</dt>
            <dd>
              <a href={media} target="_blank" rel="noreferrer noopener">
                {media}
              </a>
            </dd>
            <dt>Parsed</dt>
            <dd>
              {candidate.parsed.valid} of {candidate.parsed.rows} rows · confidence {candidate.confidence}
            </dd>
          </dl>

          <div className="adm-gates">
            {candidate.gates
              .filter((g) => g.status !== "pass")
              .map((g) => (
                <span key={g.gate} className={"adm-gate adm-gate-" + g.status}>
                  <span className="adm-gate-dot" />
                  <span>
                    <strong>{g.gate}</strong> — {g.detail}
                  </span>
                </span>
              ))}
            {candidate.gates.every((g) => g.status === "pass") && (
              <span className="adm-gate adm-gate-pass">
                <span className="adm-gate-dot" />
                <span>Every gate passed.</span>
              </span>
            )}
          </div>

          {(candidate.notes ?? []).length > 0 && (
            <div className="adm-note" style={{ marginBottom: 12 }}>
              <strong>Worked out, not read:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {(candidate.notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="adm-field">
            <span>Operator</span>
            <input
              className="adm-input"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="The operator's own name for itself"
            />
          </label>
          <label className="adm-field">
            <span>Attribution line</span>
            <input
              className="adm-input"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              placeholder="What appears under the picture"
            />
          </label>

          <div className="adm-verdicts">
            <button
              className="adm-btn adm-btn-good adm-btn-wide"
              onClick={() => void decideFeed("admit")}
              disabled={busy || tally.good === 0}
              title={tally.good === 0 ? "Judge at least one camera good before admitting the feed." : undefined}
            >
              Admit this whole feed <kbd>&#8679;A</kbd>
            </button>
            <button className="adm-btn adm-btn-bad" onClick={() => void decideFeed("reject")} disabled={busy}>
              Reject feed <kbd>&#8679;X</kbd>
            </button>
            <button className="adm-btn" onClick={() => void decideFeed("hold")} disabled={busy}>
              Hold
            </button>
          </div>

          <div className="adm-tally">
            <span>seen {tally.seen}</span>
            <span>good {tally.good}</span>
            <span>this camera: {existing ? VERDICT_LABEL[existing] : "undecided"}</span>
            <button
              type="button"
              className="adm-linkbtn"
              onClick={() => nameReviewer("")}
              title="Change who these verdicts are signed by"
            >
              signed {reviewer}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
