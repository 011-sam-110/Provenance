"use client";
// Catches a map that fails to start after the WebGL probe said yes (lib/map/webgl.ts):
// MapLibre's constructor throws when it cannot make its context, and a probe made
// before the map exists can be wrong (the GPU process can fail in between). Without
// this, that throw reached the root and Next showed "Application error" for the page.

import { Component, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

export default class MapBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
