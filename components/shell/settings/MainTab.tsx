"use client";
// The Main tab: where alerts go. Notifications first, then the two channels that need
// credentials pasting into them.
//
// NOTIFICATIONS IS ABOVE TELEGRAM, which reverses the old scroll order. The master switch
// and the per-widget rules are what a returning user comes back to change; the bot token
// and the webhook URL are set once and then never touched, so they read as reference
// material and belong below the thing that governs them.
//
// `tgStatus` LIVES HERE, not in SettingsPanel: inactive tabs unmount, so a "✓ Sent" that
// was hoisted into the parent would outlive the panel that explained it.

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { useTelegram, telegramStore, sendTelegram, isTelegramConfigured } from "@/lib/shell/telegram";
import {
  useNotifications, notificationsStore, isDiscordConfigured, requestNotifyPermission, type NotifyRule,
} from "@/lib/shell/notifications";
import { getWidgetType } from "@/lib/console/registry";

/** A "Browser · Telegram" style summary of a rule's armed channels. */
function channelSummary(r: NotifyRule): string {
  const on = [
    r.channels.browser && "Browser",
    r.channels.telegram && "Telegram",
    r.channels.discord && "Discord",
  ].filter(Boolean) as string[];
  return on.length ? on.join(" · ") : "no channels";
}

export default function MainTab() {
  const tg = useTelegram();
  const notif = useNotifications();
  const [tgStatus, setTgStatus] = useState<{ kind: "idle" | "sending" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  const onSendTest = async () => {
    setTgStatus({ kind: "sending" });
    const res = await sendTelegram(`✅ Test alert from ${BRAND.name} — your Telegram channel is working.`);
    setTgStatus(res.ok ? { kind: "ok" } : { kind: "err", msg: res.error ?? "Failed" });
  };

  return (
    <>
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
    </>
  );
}
