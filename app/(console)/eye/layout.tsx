import { EYE_SKIN_SCRIPT } from "@/lib/eye/skin";

// /eye only. The God's eye view is always the console's dark mode for its Sources tray and
// pins (lib/eye/skin.ts says why), so the attribute is set here, before paint, with no look
// at the console's saved choice. The layout takes no `searchParams`: the route stays static
// (tests/unit/console-static.test.ts).
export default function EyeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: EYE_SKIN_SCRIPT }} />
      {children}
    </>
  );
}
