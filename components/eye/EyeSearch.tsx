"use client";
// The pill at the top left: places, and the cameras and vessels in the scene now. lib/eye/search.ts
// holds the ranking and the rules; this file holds the box, the geocoder's round trip and the keys.
//
// A place is a plain link and a full page load, like every way into this page. A camera or a
// vessel is a button: EyeApp flies the map there and opens its card or panel.
//
// A focused empty box lists the three framed places. The geocoder is asked 350 ms after the last
// key, as components/console/MapSearch.tsx does, and its failure is said quietly in the list.
//
// A COMBOBOX, NOT A DIALOG: focus stays in the box and the arrow keys walk the list. Escape closes
// the list first and clears the words second. It prevents its default each time, so a camera card
// or a vessel's panel, which look at `defaultPrevented`, wait for the next press.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SearchGlyph } from "@/components/shell/inspector/ToolIcons";
import type { GeocodeResult } from "@/lib/geo/geocode";
import {
  combineResults,
  geocodeResults,
  presetResults,
  rankResults,
  searchStatus,
  wantsGeocoder,
  type GeocoderState,
  type SearchResult,
} from "@/lib/eye/search";
import { CLEAR_SEARCH, EYE_SEARCH_NAME, EYE_SEARCH_PLACEHOLDER, SEARCH_KIND_WORD, SEARCH_RESULTS_NAME } from "@/lib/eye/wording";
import styles from "./EyeHud.module.css";

/** Keeps us under the community geocoder's limit of about one request a second. */
const DEBOUNCE_MS = 350;

export default function EyeSearch({
  marks,
  onPickMark,
  onOpen,
}: {
  /** The cameras and vessels in the scene now, as results (markResults). */
  marks: readonly SearchResult[];
  onPickMark: (r: Extract<SearchResult, { kind: "camera" | "vessel" }>) => void;
  /** The list opened: what shares its room closes. */
  onOpen?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [places, setPlaces] = useState<SearchResult[]>([]);
  const [geocoder, setGeocoder] = useState<GeocoderState>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

  const q = query.trim();
  const results = useMemo(
    () => (q === "" ? presetResults() : combineResults(rankResults([...presetResults(), ...marks], q), places)),
    [q, marks, places],
  );
  const status = searchStatus(q, results.length, geocoder);

  useEffect(() => {
    setActive(-1);
    setPlaces([]);
    if (!wantsGeocoder(q)) {
      setGeocoder("idle");
      return;
    }
    setGeocoder("pending");
    const ask = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ask.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { results?: GeocodeResult[] } | null) => {
          setPlaces(geocodeResults(Array.isArray(d?.results) ? d.results : []));
          setGeocoder("done");
        })
        .catch(() => {
          if (!ask.signal.aborted) setGeocoder("failed");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ask.abort();
    };
  }, [q]);

  // A press anywhere else closes the list. Not on blur alone: a press on a row must still land.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const show = () => {
    if (open) return;
    setOpen(true);
    onOpen?.();
  };

  const pickMark = (r: SearchResult) => {
    if (r.kind === "place") return;
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onPickMark(r);
  };

  const pick = (r: SearchResult) => {
    // A full page load, as a click on the link is.
    if (r.kind === "place") window.location.assign(r.href);
    else pickMark(r);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? results.length - 1 : (a + step + results.length) % results.length));
    } else if (e.key === "Enter") {
      const r = results[active] ?? (q === "" ? undefined : results[0]);
      if (!open || !r) return;
      e.preventDefault();
      pick(r);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (query !== "") {
        e.preventDefault();
        setQuery("");
      }
    }
  };

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is built from the list's own id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const showing = open && (results.length > 0 || status != null);

  return (
    <div
      ref={rootRef}
      className={styles.search}
      data-eye-keep
      data-eye-search=""
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className={styles.pill}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          role="combobox"
          aria-label={EYE_SEARCH_NAME}
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && showing ? optionId(active) : undefined}
          placeholder={EYE_SEARCH_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            show();
          }}
          onFocus={show}
          onClick={show}
          onKeyDown={onKeyDown}
        />
        {query !== "" && (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={CLEAR_SEARCH}
            title={CLEAR_SEARCH}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden>×</span>
          </button>
        )}
        <span className={styles.searchGlass} aria-hidden>
          <SearchGlyph />
        </span>
      </div>
      {showing && (
        // A press here keeps focus in the box. Safari gives a button no focus on a click, so without
        // this the box's blur closes the list before the click lands on the row.
        <div className={styles.results} onMouseDown={(e) => e.preventDefault()}>
          <div id={listId} role="listbox" aria-label={SEARCH_RESULTS_NAME} className={styles.resultsList}>
            {results.map((r, i) => {
              const words = (
                <>
                  <span className={styles.resultName}>{r.name}</span>
                  <span className={styles.resultKind}>{SEARCH_KIND_WORD[r.kind]}</span>
                </>
              );
              return r.kind === "place" ? (
                <a
                  key={r.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  className={styles.result}
                  data-active={i === active || undefined}
                  href={r.href}
                >
                  {words}
                </a>
              ) : (
                <button
                  key={r.key}
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  className={styles.result}
                  data-active={i === active || undefined}
                  onClick={() => pickMark(r)}
                >
                  {words}
                </button>
              );
            })}
          </div>
          {status && (
            <p className={styles.resultsStatus} role="status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
