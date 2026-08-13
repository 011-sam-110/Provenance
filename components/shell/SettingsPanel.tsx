"use client";
// The Settings slide-over (opened from the top-right gear). Consolidates the chrome
// controls that used to clutter the top bar — language, dark mode, and layout sharing
// — and adds a "load board" list. A right drawer over a dismiss scrim; Esc or a scrim
// click closes it. All controls drive the existing stores, so nothing here owns state
// beyond the transient "copied" flash.

import { useEffect, useRef, useState } from "react";
import { LANGS } from "@/lib/i18n/catalog";
import { useLang, langStore } from "@/lib/i18n/store";
import { uiStore, useUI } from "@/lib/shell/ui";
import { buildShareUrl } from "@/lib/share/deepLink";
import { encodeLayout } from "@/lib/console/share";
import { shellLayoutStore } from "@/lib/console/store";
import { BUILTIN_PRESETS, applyPreset } from "@/lib/console/presets";
import { useActivePreset } from "@/lib/console/activePreset";
import { useTelegram, telegramStore, sendTelegram, isTelegramConfigured } from "@/lib/shell/telegram";
import {
  useNotifications, notificationsStore, isDiscordConfigured, requestNotifyPermission, type NotifyRule,
} from "@/lib/shell/notifications";
import { getWidgetType } from "@/lib/console/registry";
import { BRAND } from "@/lib/brand";

/** A "Browser · Telegram" style summary of a rule's armed channels. */
function channelSummary(r: NotifyRule): string {
  const on = [
    r.channels.browser && "Browser",
    r.channels.telegram && "Telegram",
    r.channels.discord && "Discord",
  ].filter(Boolean) as string[];
  return on.length ? on.join(" · ") : "no channels";
}

/** A shareable URL that carries BOTH the map view state and the widget layout (?c=). */
async function copyLayoutLink(): Promise<boolean> {
  const base = buildShareUrl();
  const c = encodeLayout(shellLayoutStore.get());
  const url = `${base}${base.includes("?") ? "&" : "?"}c=${c}`;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const lang = useLang();
  const activeId = useActivePreset();
  const tg = useTelegram();
  const notif = useNotifications();
  const [copied, setCopied] = useState(false);
  const [tgStatus, setTgStatus] = useState<{ kind: "idle" | "sending" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!open) return null;

  const onShare = async () => {
    const ok = await copyLayoutLink();
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };

  const onSendTest = async () => {
    setTgStatus({ kind: "sending" });
    const res = await sendTelegram(`✅ Test alert from ${BRAND.name} — your Telegram channel is working.`);
    setTgStatus(res.ok ? { kind: "ok" } : { kind: "err", msg: res.error ?? "Failed" });
  };

  return (
    <div className="tn-settings-scrim" onClick={onClose}>
      <aside className="tn-settings" role="dialog" aria-modal="true" aria-label="Settings"
        onClick={(e) => e.stopPropagation()}>
        <header className="tn-settings-head">
          <h2 className="tn-settings-title">Settings</h2>
          <button type="button" className="tn-settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </header>

        <div className="tn-settings-body">
          {/* Appearance ------------------------------------------------------ */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Appearance</h3>
            <div className="tn-settings-row">
              <span className="tn-settings-label">Theme</span>
              <div className="tn-settings-seg" role="group" aria-label="Theme">
                <button type="button" className="tn-settings-seg-btn" aria-pressed={ui.theme === "light"}
                  onClick={() => uiStore.setTheme("light")}>☀ Light</button>
                <button type="button" className="tn-settings-seg-btn" aria-pressed={ui.theme === "dark"}
                  onClick={() => uiStore.setTheme("dark")}>☾ Dark</button>
              </div>
            </div>
          </section>

          {/* Language -------------------------------------------------------- */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Language</h3>
            <div className="tn-settings-row">
              <span className="tn-settings-label">Interface</span>
              <div className="tn-settings-seg" role="group" aria-label="Interface language">
                {LANGS.map((l) => (
                  <button key={l.code} type="button" className="tn-settings-seg-btn" title={l.name}
                    aria-pressed={lang === l.code} onClick={() => langStore.set(l.code)}>{l.label}</button>
                ))}
              </div>
            </div>
          </section>

          {/* Boards ---------------------------------------------------------- */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Load a board</h3>
            <p className="tn-settings-hint">Swaps the widgets and the map overlays together.</p>
            <div className="tn-settings-boards">
              {BUILTIN_PRESETS.map((p) => (
                <button key={p.id} type="button"
                  className={`tn-settings-board${p.id === activeId ? " is-active" : ""}`}
                  aria-pressed={p.id === activeId} onClick={() => applyPreset(p.id)}>
                  <span className="tn-settings-board-icon" aria-hidden>{p.icon}</span>
                  <span className="tn-settings-board-text">
                    <span className="tn-settings-board-title">{p.title}</span>
                    <span className="tn-settings-board-blurb">{p.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Share ----------------------------------------------------------- */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Share</h3>
            <p className="tn-settings-hint">Copy a link that reopens this exact board and view.</p>
            <button type="button" className={`tn-settings-share${copied ? " is-copied" : ""}`} onClick={onShare}>
              {copied ? "✓ Link copied" : "Share this layout"}
            </button>
          </section>

          {/* Telegram alerts ------------------------------------------------- */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Telegram alerts</h3>
            <p className="tn-settings-hint">
              Optional. Relay your armed Disasters &amp; Events alerts to a Telegram chat. Message
              <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer"> @BotFather</a> to make a bot and get its
              token, then message your bot and open
              <code> api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find your chat id.
            </p>
            <label className="tn-settings-field">
              <span className="tn-settings-field-label">Bot token</span>
              <input className="tn-settings-input" type="password" autoComplete="off" spellCheck={false}
                placeholder="123456789:AA…" value={tg.botToken}
                onChange={(e) => telegramStore.setToken(e.target.value)} />
            </label>
            <label className="tn-settings-field">
              <span className="tn-settings-field-label">Chat id</span>
              <input className="tn-settings-input" type="text" autoComplete="off" spellCheck={false}
                placeholder="-1001234567890 or @channel" value={tg.chatId}
                onChange={(e) => telegramStore.setChatId(e.target.value)} />
            </label>
            <label className="tn-settings-toggle">
              <input type="checkbox" checked={tg.enabled} disabled={!isTelegramConfigured(tg)}
                onChange={(e) => telegramStore.setEnabled(e.target.checked)} />
              <span>Send alerts to Telegram</span>
            </label>
            <div className="tn-settings-tg-actions">
              <button type="button" className="tn-settings-tg-test" disabled={!isTelegramConfigured(tg) || tgStatus.kind === "sending"}
                onClick={onSendTest}>
                {tgStatus.kind === "sending" ? "Sending…" : "Send test message"}
              </button>
              {tgStatus.kind === "ok" && <span className="tn-settings-tg-ok">✓ Sent</span>}
              {tgStatus.kind === "err" && <span className="tn-settings-tg-err">{tgStatus.msg ?? "Failed"}</span>}
            </div>
          </section>

          {/* Notifications --------------------------------------------------- */}
          <section className="tn-settings-sec">
            <h3 className="tn-settings-sec-title">Notifications</h3>
            <p className="tn-settings-hint">
              Per-widget alerts. Arm any widget with its 🔔 button, pick channels + a threshold,
              and a NEW &ldquo;needs attention&rdquo; item is relayed to those channels. For Discord, open a
              channel&rsquo;s <em>Integrations → Webhooks</em> and paste the URL below.
            </p>
            <label className="tn-settings-toggle">
              <input type="checkbox" checked={notif.master}
                onChange={(e) => notificationsStore.setMaster(e.target.checked)} />
              <span>Enable notifications</span>
            </label>
            <label className="tn-settings-field">
              <span className="tn-settings-field-label">Discord webhook URL</span>
              <input className="tn-settings-input" type="password" autoComplete="off" spellCheck={false}
                placeholder="https://discord.com/api/webhooks/…" value={notif.discordWebhook}
                onChange={(e) => notificationsStore.setDiscordWebhook(e.target.value)} />
              {notif.discordWebhook.length > 0 && !isDiscordConfigured(notif.discordWebhook) &&
                <span className="tn-settings-tg-err">That webhook URL doesn&rsquo;t look right.</span>}
            </label>
            <div className="tn-settings-notify-list">
              {Object.entries(notif.rules).length === 0 ? (
                <p className="tn-settings-hint">No widgets armed yet — use a widget&rsquo;s 🔔 button.</p>
              ) : Object.entries(notif.rules).map(([type, r]) => (
                <div key={type} className="tn-settings-notify-row">
                  <label className="tn-settings-toggle">
                    <input type="checkbox" checked={r.enabled}
                      onChange={(e) => {
                        notificationsStore.setRule(type, { enabled: e.target.checked });
                        if (e.target.checked && r.channels.browser) void requestNotifyPermission();
                      }} />
                    <span className="tn-settings-notify-name">{getWidgetType(type)?.title ?? type}</span>
                  </label>
                  <span className="tn-settings-notify-chs">{channelSummary(r)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
