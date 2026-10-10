/**
 * The camera stills the photo sphere is tiled with. GENERATED from the sketch repo's
 * stills/CREDITS.md (LBSiUK/provenance-sphere-animation); do not hand-edit a row.
 *
 * Each is one frame from a public road camera, taken on 8 October 2026 and cropped to 4:3
 * at 480 x 360. They are a DATED SNAPSHOT, like the globe: never call them live. The files
 * are under public/marketing/sphere/, and docs/IMAGE-LICENSES.md carries their rows.
 * Placeholder cards ("camera in use") and corrupt frames were removed by hand; a build that
 * re-harvests them must filter those automatically.
 */
export type SphereOperator = "tfl" | "drivebc" | "digitraffic";

export interface SphereStill {
  readonly src: string;
  readonly camera: string;
  readonly operator: SphereOperator;
  readonly original: string;
}

export const SPHERE_STILLS_TAKEN_AT = "2026-10-08";

/** The attribution each operator's licence asks for, as the footer prints it. */
export const SPHERE_ATTRIBUTION: Record<SphereOperator, { licence: string; credit: string }> = {
  tfl: { licence: "Open Government Licence v3.0", credit: "Powered by TfL Open Data" },
  drivebc: {
    licence: "Open Government Licence – British Columbia",
    credit: "DriveBC / BC Ministry of Transportation and Infrastructure",
  },
  digitraffic: { licence: "CC BY 4.0", credit: "Fintraffic / Digitraffic" },
};

export const SPHERE_STILLS: readonly SphereStill[] = [
  { src: "/marketing/sphere/cam-01.webp", camera: "Pentonville Road / Penton Rise", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07355.jpg" },
  { src: "/marketing/sphere/cam-02.webp", camera: "Stonecot Hill/Hill Top", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04675.jpg" },
  { src: "/marketing/sphere/cam-03.webp", camera: "Balham High Rd/Ramsden Rd", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.04661.jpg" },
  { src: "/marketing/sphere/cam-04.webp", camera: "A20 Lee High Rd/Belmont Park", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03703.jpg" },
  { src: "/marketing/sphere/cam-05.webp", camera: "A406 Fulbourne Road", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00864.jpg" },
  { src: "/marketing/sphere/cam-06.webp", camera: "Uxbridge Road/Greenford Road", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06697.jpg" },
  { src: "/marketing/sphere/cam-07.webp", camera: "Great Eastern Rd/Angel Lane Bridge", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.02146.jpg" },
  { src: "/marketing/sphere/cam-08.webp", camera: "EIDT East Ramp", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00618.jpg" },
  { src: "/marketing/sphere/cam-11.webp", camera: "Camden Rd/St Pancras Way", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.09560.jpg" },
  { src: "/marketing/sphere/cam-12.webp", camera: "Romford Rd / Vicarage Lane", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.02152.jpg" },
  { src: "/marketing/sphere/cam-13.webp", camera: "Bayswater Rd/Lancaster Terrace", operator: "tfl", original: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06660.jpg" },
  { src: "/marketing/sphere/cam-14.webp", camera: "Burton Main Road", operator: "drivebc", original: "https://www.drivebc.ca/images/755.jpg" },
  { src: "/marketing/sphere/cam-15.webp", camera: "Comox Road - N", operator: "drivebc", original: "https://www.drivebc.ca/images/737.jpg" },
  { src: "/marketing/sphere/cam-16.webp", camera: "Mackenzie Junction", operator: "drivebc", original: "https://www.drivebc.ca/images/376.jpg" },
  { src: "/marketing/sphere/cam-17.webp", camera: "Agassiz-Rosedale Bridge - N", operator: "drivebc", original: "https://www.drivebc.ca/images/841.jpg" },
  { src: "/marketing/sphere/cam-18.webp", camera: "Elko - E", operator: "drivebc", original: "https://www.drivebc.ca/images/929.jpg" },
  { src: "/marketing/sphere/cam-19.webp", camera: "Elkford - W", operator: "drivebc", original: "https://www.drivebc.ca/images/937.jpg" },
  { src: "/marketing/sphere/cam-20.webp", camera: "Lougheed Highway", operator: "drivebc", original: "https://www.drivebc.ca/images/192.jpg" },
  { src: "/marketing/sphere/cam-21.webp", camera: "Crest Lake", operator: "drivebc", original: "https://www.drivebc.ca/images/600.jpg" },
  { src: "/marketing/sphere/cam-22.webp", camera: "Lorimer Road - E", operator: "drivebc", original: "https://www.drivebc.ca/images/847.jpg" },
  { src: "/marketing/sphere/cam-23.webp", camera: "Hwy 19A at Ryan Road - E", operator: "drivebc", original: "https://www.drivebc.ca/images/1037.jpg" },
  { src: "/marketing/sphere/cam-24.webp", camera: "Sayward Road - E", operator: "drivebc", original: "https://www.drivebc.ca/images/1042.jpg" },
  { src: "/marketing/sphere/cam-25.webp", camera: "Nelson Street - W", operator: "drivebc", original: "https://www.drivebc.ca/images/954.jpg" },
  { src: "/marketing/sphere/cam-26.webp", camera: "st180_Kaarina_Kirjalansalmi", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0255001.jpg" },
  { src: "/marketing/sphere/cam-27.webp", camera: "kt65_Tampere_Lielahti", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0454801.jpg" },
  { src: "/marketing/sphere/cam-28.webp", camera: "vt24_Asikkala_Iso-Äiniö", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0452201.jpg" },
  { src: "/marketing/sphere/cam-29.webp", camera: "vt8_Pyhäjoki_Hanhikivi", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C1258801.jpg" },
  { src: "/marketing/sphere/cam-30.webp", camera: "st945_Kemijärvi_Lehtola", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C1456601.jpg" },
  { src: "/marketing/sphere/cam-31.webp", camera: "st476_Heinävesi", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0651601.jpg" },
  { src: "/marketing/sphere/cam-32.webp", camera: "vt6_Lapinjärvi_Kimonkylä", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0167301.jpg" },
  { src: "/marketing/sphere/cam-33.webp", camera: "vt6_Sotkamo_Juurikkalahti", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C1256401.jpg" },
  { src: "/marketing/sphere/cam-34.webp", camera: "st167_Lahti_Uudenmaankatu", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0462200.jpg" },
  { src: "/marketing/sphere/cam-35.webp", camera: "Mt912_Kuhmo_Kattilakoski", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C1265101.jpg" },
  { src: "/marketing/sphere/cam-36.webp", camera: "kt74_Joensuu_Onkimäki", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C0750801.jpg" },
  { src: "/marketing/sphere/cam-37.webp", camera: "vt13_Oksakoski", operator: "digitraffic", original: "https://weathercam.digitraffic.fi/C1051701.jpg" },
];
