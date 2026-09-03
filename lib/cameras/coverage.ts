// The camera shape the console reads. The coverage maths that used to live here —
// coverage() and byWallPriority(), plus the Coverage and OperatorCoverage shapes they
// returned — went with the cameras focus view that was their only caller
// (see docs/superpowers/specs/2026-09-03-cameras-widget-retirement-design.md).
export interface CameraLite {
  id: string; source: string; name: string; lat: number; lon: number;
  available: boolean; live: boolean; region?: string;
}
