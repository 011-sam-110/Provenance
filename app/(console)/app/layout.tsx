// From skinBoot, not skin: this is a server layout, and skin.ts is a client module. Its header says why.
import { SKIN_BOOT_SCRIPT } from "@/lib/terminal/skinBoot";

// /app only. /eye shares the (console) layout above this one and is ALWAYS dark through its
// own layout (app/(console)/eye/layout.tsx, lib/eye/skin.ts) without reading this skin's saved
// choice, and the marketing site is another route group entirely.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Sets data-tnx-skin before the console paints: dark unless this browser saved light.
          The root layout's <head> has already done this at the address /app. This one is for
          the private endpoint, a rewrite to this page at an address the head script cannot
          know (lib/gate/private.ts). Running twice decides the same thing twice. */}
      <script dangerouslySetInnerHTML={{ __html: SKIN_BOOT_SCRIPT }} />
      {children}
    </>
  );
}
