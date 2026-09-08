"use client";
// "Alert me" — the composer and the armed list for ONE area, behind a disclosure.
//
// IT IS A DROPDOWN, NOT AN INLINE BLOCK. The rail is already a long scroll of source
// toggles; six more controls always open would push the area rows off screen for the
// many sessions that never arm anything. Closed it is one line and a count, which is
// also the answer to "is anything watching this area?" — the question a collapsed
// control has to keep answering.
//
// THE SECOND DROPDOWN IS THE WHOLE FEATURE. Its options come from resolveTriggers()
// via triggersFor(), so a combination the source cannot back is never offered — and a
// source that can back nothing renders an empty, disabled list and says why, rather
// than offering something it cannot deliver. OSM reference data is the case that
// forced it: a position and its tags, with no operating state.
//
// NOT A SECOND EDITOR. WidgetFrame's bell opens this panel; it does not grow its own
// copy of these controls. AreasPanel already holds that line for the source list.

import { useMemo, useState } from "react";
import { armableSources, triggersFor } from "@/lib/notify/sources";
import { rulesStore, useAreaRules } from "@/lib/notify/rules";
import { isDiscordConfigured, useNotifications } from "@/lib/shell/notifications";
import { isTelegramConfigured, useTelegram } from "@/lib/shell/telegram";
import type { AreaRule, TriggerKind, TriggerParams } from "@/lib/notify/types";

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  appears: "appears in the area",
  disappears: "disappears from the area",
  enters: "enters the area",
  leaves: "leaves the area",
  crosses: "crosses a level",
  count: "how many crosses a level",
  state: "changes state",
  due: "is due",
  quiet: "goes quiet",
};

/** M1 ships four. The rest are resolved and listed but not yet armable, so the menu
 *  never advertises a kind the engine would silently ignore. */
const IMPLEMENTED: TriggerKind[] = ["appears", "crosses", "count", "quiet"];

const CHANNELS = ["browser", "telegram", "discord"] as const;
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  browser: "Browser", telegram: "Telegram", discord: "Discord",
};

export default function RulesPanel({ areaId, areaLabel }: { areaId: string; areaLabel: string }) {
  const [open, setOpen] = useState(false);
  const sources = useMemo(armableSources, []);
  const rules = useAreaRules(areaId);
  const notifications = useNotifications();
  const telegram = useTelegram();

  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [kind, setKind] = useState<TriggerKind>("appears");
  const [level, setLevel] = useState(5);
  const [channels, setChannels] = useState({ browser: true, telegram: false, discord: false });

  const source = sources.find((s) => s.id === sourceId);
  const offered = useMemo(
    () => triggersFor(sourceId).filter((k) => IMPLEMENTED.includes(k)),
    [sourceId],
  );

  // The held `kind` can survive a source change that no longer backs it. Deriving the
  // active one keeps the <select> showing a value it actually lists, and stops "Arm
  // rule" becoming a button that silently does nothing.
  const activeKind: TriggerKind = offered.includes(kind) ? kind : (offered[0] ?? "appears");
  const needsLevel = activeKind === "crosses" || activeKind === "count";

  // A CHANNEL WITH NO CREDENTIALS ACCEPTS THE RULE AND THEN SENDS NOTHING. `dispatch`
  // degrades to a silent no-op on every missing precondition, which is right for a
  // relay and wrong for the moment someone arms a watch — so the one place that can
  // still say so is here, before they walk away believing they are covered.
  const unconfigured = [
    channels.telegram && !isTelegramConfigured(telegram) ? "Telegram" : null,
    channels.discord && !isDiscordConfigured(notifications.discordWebhook) ? "Discord" : null,
  ].filter((v): v is string => v !== null);
  const noChannel = !channels.browser && !channels.telegram && !channels.discord;

  const arm = () => {
    let params: TriggerParams;
    if (activeKind === "crosses") {
      if (!source?.metric) return; // offered[] already prevents this; belt and braces
      params = { kind: activeKind, field: source.metric.field, dir: "atOrAbove", level };
    }
    else if (activeKind === "count") params = { kind: activeKind, dir: "atOrAbove", level };
    else if (activeKind === "quiet") params = { kind: activeKind, silentMs: 30 * 60_000 };
    else params = { kind: "appears" };

    const rule: AreaRule = {
      id: `rule:${Date.now()}`,
      areaId, sourceId, params, channels,
      enabled: true, createdAt: Date.now(),
    };
    rulesStore.add(rule);
  };

  const labelOf = (id: string) => sources.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="tn-alert" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="tn-alert-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tn-alert-title">Alert me</span>
        <span className="tn-alert-where">{areaLabel}</span>
        {rules.length > 0 ? <span className="tn-insp-pill">{rules.length} ▲</span> : null}
        <span className="tn-alert-chev" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="tn-alert-body">
          {/* The global gate outranks every rule below it, so it is said first. */}
          {!notifications.master ? (
            <p className="tn-alert-warn">
              Notifications are switched off for the whole console. A rule armed here
              stays saved and sends nothing until you switch them back on.
            </p>
          ) : null}

          <label className="tn-rules-row">
            <span>When</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label} — {s.group}</option>
              ))}
            </select>
          </label>

          <label className="tn-rules-row">
            <span className="tn-sr-only">What it has to do</span>
            <select
              value={activeKind}
              disabled={offered.length === 0}
              onChange={(e) => setKind(e.target.value as TriggerKind)}
            >
              {offered.length === 0
                ? <option>— nothing this source can back —</option>
                : offered.map((k) => <option key={k} value={k}>{TRIGGER_LABEL[k]}</option>)}
            </select>
          </label>

          {offered.length === 0 ? (
            <p className="tn-rules-refuse">
              {source?.label} publishes no state to notice a change in. It is reference
              data — a position and its tags — so there is no honest rule to build here.
            </p>
          ) : null}

          {needsLevel && offered.length > 0 ? (
            <label className="tn-rules-row">
              <span>{activeKind === "crosses" ? source?.metric?.field ?? "Level" : "Count"}</span>
              <input
                type="number" value={level}
                min={activeKind === "crosses" ? source?.metric?.domain[0] : 0}
                max={activeKind === "crosses" ? source?.metric?.domain[1] : undefined}
                onChange={(e) => setLevel(Number(e.target.value))}
              />
              {activeKind === "crosses" && source?.metric ? (
                <span className="tn-rules-domain">
                  {source.metric.domain[0]}–{source.metric.domain[1]}{source.metric.unit ?? ""}
                </span>
              ) : null}
            </label>
          ) : null}

          <div className="tn-rules-row">
            <span>Send</span>
            <span className="tn-rules-chs">
              {CHANNELS.map((c) => (
                <label key={c} className="tn-rules-ch">
                  <input
                    type="checkbox" checked={channels[c]}
                    onChange={(e) => setChannels({ ...channels, [c]: e.target.checked })}
                  />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </span>
          </div>

          {unconfigured.length > 0 ? (
            <p className="tn-alert-warn">
              {unconfigured.join(" and ")} {unconfigured.length > 1 ? "have" : "has"} no
              credentials saved. Add {unconfigured.length > 1 ? "them" : "it"} under
              Settings → Notifications, or this rule will arm and send nothing on
              {unconfigured.length > 1 ? " those channels" : ` ${unconfigured[0]}`}.
            </p>
          ) : null}

          {noChannel ? (
            <p className="tn-alert-warn">
              No channel is ticked. The rule would fire and reach nobody.
            </p>
          ) : null}

          <button
            type="button"
            className="tn-alert-arm"
            onClick={arm}
            disabled={offered.length === 0 || noChannel}
          >
            Arm rule
          </button>

          {rules.length > 0 ? (
            <ul className="tn-rules-list">
              {rules.map((r) => (
                <li key={r.id}>
                  <span>{labelOf(r.sourceId)} {TRIGGER_LABEL[r.params.kind]}</span>
                  <button
                    type="button"
                    className="tn-rules-x"
                    onClick={() => rulesStore.remove(r.id)}
                    aria-label={`Remove the ${labelOf(r.sourceId)} rule`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tn-rules-refuse">Nothing armed on {areaLabel} yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
