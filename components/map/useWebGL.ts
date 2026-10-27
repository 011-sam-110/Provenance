"use client";
// The WebGL probe as a hook: null until it has run after mount (the server cannot ask),
// then the answer. lib/map/webgl.ts says why the map pages ask at all.

import { useEffect, useState } from "react";
import { canUseWebGL } from "@/lib/map/webgl";

export function useWebGL(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => setOk(canUseWebGL()), []);
  return ok;
}
