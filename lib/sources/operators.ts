// The operator's own name for each camera feed, keyed by the feed key the registry uses.
//
// Read from each adapter's own `Source` (or system) record, so a name is written once,
// in the adapter, and this table cannot disagree with it. tests/unit/camera-stats.test.ts
// fails if a feed in CAMERA_FEEDS has no name here. Server-only in practice: it imports
// every adapter module, as lib/sources/registry.ts does.

import type { Source } from "@/lib/types";
import { ACT_PR_SOURCE } from "@/lib/sources/actpr";
import { ALERTCALIFORNIA_SOURCE } from "@/lib/sources/alertcalifornia";
import { AVO_SOURCE } from "@/lib/sources/avo";
import { BELLINGEN_SOURCE } from "@/lib/sources/bellingen";
import { BIHAMK_SOURCE } from "@/lib/sources/bihamk";
import { CALGARY_SOURCE } from "@/lib/sources/calgary";
import { CALTRANS_SOURCE } from "@/lib/sources/caltrans";
import { CASTLEROCK_SOURCE } from "@/lib/sources/castlerock";
import { CETSP_SOURCE } from "@/lib/sources/cetsp";
import { DARS_SI_SOURCE } from "@/lib/sources/dars-si";
import { DGT_SOURCE } from "@/lib/sources/dgt";
import { DIGITRAFFIC_SOURCE } from "@/lib/sources/digitraffic";
import { DRIVEBC_SOURCE } from "@/lib/sources/drivebc";
import { EISMOINFO_SOURCE } from "@/lib/sources/eismoinfo";
import { ESTONIA_SOURCE } from "@/lib/sources/estonia";
import { HKTD_SOURCE } from "@/lib/sources/hktd";
import { ICELAND_SOURCE } from "@/lib/sources/iceland";
import { LIVETRAFFIC_NSW_SOURCE } from "@/lib/sources/livetraffic-nsw";
import { LYON_SOURCE } from "@/lib/sources/lyon";
import { MIDRIVE_SOURCE } from "@/lib/sources/midrive";
import { NE_UTMC_SOURCE } from "@/lib/sources/ne-utmc";
import { NZTA_SOURCE } from "@/lib/sources/nzta";
import { OTTAWA_SOURCE } from "@/lib/sources/ottawa";
import { QLDTRAFFIC_FLOOD_SOURCE } from "@/lib/sources/qldtraffic-flood";
import { QLDTRAFFIC_SOURCE } from "@/lib/sources/qldtraffic";
import { ROADS_MK_SOURCE } from "@/lib/sources/roads-mk";
import { SCDOT_SOURCE } from "@/lib/sources/scdot";
import { SERBIA_BORDERS_SOURCE } from "@/lib/sources/serbia-borders";
import { SERBIA_TOLLS_SOURCE } from "@/lib/sources/serbia-tolls";
import { TAMAR_SOURCE } from "@/lib/sources/tamar";
import { TDX_THB_SOURCE } from "@/lib/sources/tdx-thb";
import { TFL_SOURCE } from "@/lib/sources/tfl";
import { TORONTO_SOURCE } from "@/lib/sources/toronto";
import { TRAFFICSCOTLAND_SOURCE } from "@/lib/sources/trafficscotland";
import { TRIPCHECK_SOURCE } from "@/lib/sources/tripcheck";
import { TXDOT_SOURCE } from "@/lib/sources/txdot";
import { USGS_NIMS_SOURCE } from "@/lib/sources/usgs-nims";
import { VANCOUVER_SOURCE } from "@/lib/sources/vancouver";
import { VDOT_SOURCE } from "@/lib/sources/vdot";
import { VEGVESEN_SOURCE } from "@/lib/sources/vegvesen";
import { WSDOT_SOURCE } from "@/lib/sources/wsdot";
import { CARS_SYSTEMS } from "@/lib/sources/cars";
import { MY511_MB_SYSTEM } from "@/lib/sources/my511-mb";
import { MY511_NL_SYSTEM } from "@/lib/sources/my511-nl";
import { MY511_YT_SYSTEM } from "@/lib/sources/my511-yt";
import { ADMITTED_FEEDS } from "@/lib/sources/discovered.data";

const SOURCES: readonly Source[] = [
  ACT_PR_SOURCE, ALERTCALIFORNIA_SOURCE, AVO_SOURCE, BELLINGEN_SOURCE, BIHAMK_SOURCE,
  CALGARY_SOURCE, CALTRANS_SOURCE, CASTLEROCK_SOURCE, CETSP_SOURCE, DARS_SI_SOURCE,
  DGT_SOURCE, DIGITRAFFIC_SOURCE, DRIVEBC_SOURCE, EISMOINFO_SOURCE, ESTONIA_SOURCE,
  HKTD_SOURCE, ICELAND_SOURCE, LIVETRAFFIC_NSW_SOURCE, LYON_SOURCE, MIDRIVE_SOURCE,
  NE_UTMC_SOURCE, NZTA_SOURCE, OTTAWA_SOURCE, QLDTRAFFIC_FLOOD_SOURCE, QLDTRAFFIC_SOURCE,
  ROADS_MK_SOURCE, SCDOT_SOURCE, SERBIA_BORDERS_SOURCE, SERBIA_TOLLS_SOURCE, TAMAR_SOURCE,
  TDX_THB_SOURCE, TFL_SOURCE, TORONTO_SOURCE, TRAFFICSCOTLAND_SOURCE, TRIPCHECK_SOURCE,
  TXDOT_SOURCE, USGS_NIMS_SOURCE, VANCOUVER_SOURCE, VDOT_SOURCE, VEGVESEN_SOURCE, WSDOT_SOURCE,
];

export const OPERATOR_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(SOURCES.map((s) => [s.id, s.name])),
  ...Object.fromEntries(CARS_SYSTEMS.map((s) => [s.key, s.agency])),
  ...Object.fromEntries([MY511_MB_SYSTEM, MY511_NL_SYSTEM, MY511_YT_SYSTEM].map((s) => [s.key, s.source.name])),
  ...Object.fromEntries(ADMITTED_FEEDS.map((f) => [f.key, f.name])),
};

/** The operator's name for a feed key; the key itself if the table has none. */
export function operatorName(key: string): string {
  return OPERATOR_NAMES[key] ?? key;
}
