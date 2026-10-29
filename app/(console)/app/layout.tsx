import { SKIN_BOOT_SCRIPT } from "@/lib/terminal/skin";

// /app only. /eye shares the (console) layout above this one but has no dark skin, and
// the marketing site is another route group entirely.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Sets data-tnx-skin before the console paints, so a dark choice never flashes light. */}
      <script dangerouslySetInnerHTML={{ __html: SKIN_BOOT_SCRIPT }} />
      {children}
    </>
  );
}
