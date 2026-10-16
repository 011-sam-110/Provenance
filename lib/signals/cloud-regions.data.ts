// Cloud region id -> where it is. The cloud-status layer pins an incident at the
// region the vendor names (AWS "me-central-1", Google Cloud "us-central1", Oracle
// "eu-frankfurt-1", an Azure title naming "West Europe") instead of at the vendor's
// head office.
//
// SOURCES. The region ids and their named locations come from each vendor's own
// region list:
//   AWS     docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html
//   Google  cloud.google.com/compute/docs/regions-zones
//   Azure   learn.microsoft.com/azure/reliability/regions-list (the lat/lon are the
//           ones Azure itself publishes in `az account list-locations`)
//   Oracle  docs.oracle.com/iaas/Content/General/Concepts/regions.htm
// AWS, Google and Oracle publish a city or a state, not a coordinate, so the lat/lon
// here is that named place. A region is a metro area or a campus: the mark is an
// area, never a building.

export interface CloudRegion {
  /** What the vendor calls the place, e.g. "N. Virginia", "Iowa", "West Europe". */
  place: string;
  lat: number;
  lon: number;
}

const r = (place: string, lat: number, lon: number): CloudRegion => ({ place, lat, lon });

export const AWS_REGIONS: Readonly<Record<string, CloudRegion>> = {
  "us-east-1": r("N. Virginia", 39.04, -77.49),
  "us-east-2": r("Ohio", 39.96, -83.0),
  "us-west-1": r("N. California", 37.35, -121.96),
  "us-west-2": r("Oregon", 45.84, -119.7),
  "af-south-1": r("Cape Town", -33.92, 18.42),
  "ap-east-1": r("Hong Kong", 22.32, 114.17),
  "ap-east-2": r("Taipei", 25.03, 121.56),
  "ap-south-1": r("Mumbai", 19.08, 72.88),
  "ap-south-2": r("Hyderabad", 17.39, 78.49),
  "ap-southeast-1": r("Singapore", 1.35, 103.82),
  "ap-southeast-2": r("Sydney", -33.87, 151.21),
  "ap-southeast-3": r("Jakarta", -6.21, 106.85),
  "ap-southeast-4": r("Melbourne", -37.81, 144.96),
  "ap-southeast-5": r("Malaysia", 3.14, 101.69),
  "ap-southeast-6": r("New Zealand", -36.85, 174.76),
  "ap-southeast-7": r("Thailand", 13.76, 100.5),
  "ap-northeast-1": r("Tokyo", 35.68, 139.69),
  "ap-northeast-2": r("Seoul", 37.57, 126.98),
  "ap-northeast-3": r("Osaka", 34.69, 135.5),
  "ca-central-1": r("Canada Central", 45.5, -73.57),
  "ca-west-1": r("Calgary", 51.05, -114.07),
  "cn-north-1": r("Beijing", 39.9, 116.4),
  "cn-northwest-1": r("Ningxia", 37.51, 105.19),
  "eu-central-1": r("Frankfurt", 50.11, 8.68),
  "eu-central-2": r("Zurich", 47.38, 8.54),
  "eu-west-1": r("Ireland", 53.35, -6.26),
  "eu-west-2": r("London", 51.51, -0.13),
  "eu-west-3": r("Paris", 48.86, 2.35),
  "eu-north-1": r("Stockholm", 59.33, 18.07),
  "eu-south-1": r("Milan", 45.46, 9.19),
  "eu-south-2": r("Spain", 41.65, -0.88),
  "il-central-1": r("Tel Aviv", 32.09, 34.78),
  "me-central-1": r("UAE", 24.45, 54.38),
  "me-south-1": r("Bahrain", 26.07, 50.56),
  "mx-central-1": r("Mexico", 20.59, -100.39),
  "sa-east-1": r("São Paulo", -23.55, -46.63),
};

export const GCP_REGIONS: Readonly<Record<string, CloudRegion>> = {
  "us-central1": r("Iowa", 41.26, -95.86),
  "us-east1": r("South Carolina", 33.2, -80.01),
  "us-east4": r("Northern Virginia", 39.04, -77.49),
  "us-east5": r("Columbus", 39.96, -83.0),
  "us-south1": r("Dallas", 32.78, -96.8),
  "us-west1": r("Oregon", 45.6, -121.18),
  "us-west2": r("Los Angeles", 34.05, -118.24),
  "us-west3": r("Salt Lake City", 40.76, -111.89),
  "us-west4": r("Las Vegas", 36.17, -115.14),
  "northamerica-northeast1": r("Montréal", 45.5, -73.57),
  "northamerica-northeast2": r("Toronto", 43.65, -79.38),
  "northamerica-south1": r("Querétaro", 20.59, -100.39),
  "southamerica-east1": r("São Paulo", -23.55, -46.63),
  "southamerica-west1": r("Santiago", -33.45, -70.67),
  "europe-west1": r("Belgium", 50.45, 3.82),
  "europe-west2": r("London", 51.51, -0.13),
  "europe-west3": r("Frankfurt", 50.11, 8.68),
  "europe-west4": r("Netherlands", 53.44, 6.83),
  "europe-west6": r("Zurich", 47.38, 8.54),
  "europe-west8": r("Milan", 45.46, 9.19),
  "europe-west9": r("Paris", 48.86, 2.35),
  "europe-west10": r("Berlin", 52.52, 13.4),
  "europe-west12": r("Turin", 45.07, 7.69),
  "europe-central2": r("Warsaw", 52.23, 21.01),
  "europe-north1": r("Finland", 60.57, 27.2),
  "europe-north2": r("Stockholm", 59.33, 18.07),
  "europe-southwest1": r("Madrid", 40.42, -3.7),
  "me-west1": r("Tel Aviv", 32.09, 34.78),
  "me-central1": r("Doha", 25.29, 51.53),
  "me-central2": r("Dammam", 26.43, 50.1),
  "africa-south1": r("Johannesburg", -26.2, 28.05),
  "asia-east1": r("Taiwan", 24.07, 120.54),
  "asia-east2": r("Hong Kong", 22.32, 114.17),
  "asia-northeast1": r("Tokyo", 35.68, 139.69),
  "asia-northeast2": r("Osaka", 34.69, 135.5),
  "asia-northeast3": r("Seoul", 37.57, 126.98),
  "asia-south1": r("Mumbai", 19.08, 72.88),
  "asia-south2": r("Delhi", 28.61, 77.21),
  "asia-southeast1": r("Singapore", 1.34, 103.7),
  "asia-southeast2": r("Jakarta", -6.21, 106.85),
  "australia-southeast1": r("Sydney", -33.87, 151.21),
  "australia-southeast2": r("Melbourne", -37.81, 144.96),
};

/** Keyed by Azure's DISPLAY name, which is what its status titles carry. */
export const AZURE_REGIONS: Readonly<Record<string, CloudRegion>> = {
  "East US": r("East US", 37.37, -79.82),
  "East US 2": r("East US 2", 36.67, -78.39),
  "Central US": r("Central US", 41.59, -93.62),
  "North Central US": r("North Central US", 41.88, -87.63),
  "South Central US": r("South Central US", 29.42, -98.5),
  "West Central US": r("West Central US", 40.89, -110.23),
  "West US": r("West US", 37.78, -122.42),
  "West US 2": r("West US 2", 47.23, -119.85),
  "West US 3": r("West US 3", 33.45, -112.07),
  "Canada Central": r("Canada Central", 43.65, -79.38),
  "Canada East": r("Canada East", 46.82, -71.22),
  "Brazil South": r("Brazil South", -23.55, -46.63),
  "Mexico Central": r("Mexico Central", 20.59, -100.39),
  "Chile Central": r("Chile Central", -33.45, -70.67),
  "North Europe": r("North Europe", 53.35, -6.26),
  "West Europe": r("West Europe", 52.37, 4.9),
  "UK South": r("UK South", 50.94, -0.8),
  "UK West": r("UK West", 53.43, -3.08),
  "France Central": r("France Central", 46.38, 2.37),
  "France South": r("France South", 43.83, 2.2),
  "Germany West Central": r("Germany West Central", 50.11, 8.68),
  "Germany North": r("Germany North", 53.07, 8.81),
  "Switzerland North": r("Switzerland North", 47.45, 8.56),
  "Switzerland West": r("Switzerland West", 46.2, 6.14),
  "Norway East": r("Norway East", 59.91, 10.75),
  "Norway West": r("Norway West", 58.97, 5.73),
  "Sweden Central": r("Sweden Central", 60.67, 17.14),
  "Poland Central": r("Poland Central", 52.23, 21.02),
  "Italy North": r("Italy North", 45.47, 9.18),
  "Spain Central": r("Spain Central", 40.43, -3.42),
  "Israel Central": r("Israel Central", 32.09, 34.78),
  "Qatar Central": r("Qatar Central", 25.55, 51.44),
  "UAE North": r("UAE North", 25.27, 55.32),
  "UAE Central": r("UAE Central", 24.47, 54.37),
  "South Africa North": r("South Africa North", -25.73, 28.22),
  "South Africa West": r("South Africa West", -34.08, 18.84),
  "Central India": r("Central India", 18.58, 73.92),
  "South India": r("South India", 12.98, 80.16),
  "West India": r("West India", 19.09, 72.87),
  "East Asia": r("East Asia", 22.27, 114.19),
  "Southeast Asia": r("Southeast Asia", 1.28, 103.83),
  "Japan East": r("Japan East", 35.68, 139.77),
  "Japan West": r("Japan West", 34.69, 135.5),
  "Korea Central": r("Korea Central", 37.57, 126.98),
  "Korea South": r("Korea South", 35.18, 129.08),
  "Australia East": r("Australia East", -33.86, 151.21),
  "Australia Southeast": r("Australia Southeast", -37.81, 144.96),
  "Australia Central": r("Australia Central", -35.31, 149.12),
  "New Zealand North": r("New Zealand North", -36.85, 174.76),
  "Indonesia Central": r("Indonesia Central", -6.21, 106.85),
  "Malaysia West": r("Malaysia West", 3.14, 101.69),
};

/** Keyed by Oracle's canonical name, without the "mc-" (multicloud) prefix. */
export const OCI_REGIONS: Readonly<Record<string, CloudRegion>> = {
  "af-casablanca-1": r("Casablanca", 33.57, -7.59),
  "af-johannesburg-1": r("Johannesburg", -26.2, 28.05),
  "ap-batam-1": r("Batam", 1.05, 104.03),
  "ap-chennai-1": r("Chennai", 13.08, 80.27),
  "ap-chuncheon-1": r("Chuncheon", 37.88, 127.73),
  "ap-delhi-1": r("Delhi", 28.61, 77.21),
  "ap-hyderabad-1": r("Hyderabad", 17.39, 78.49),
  "ap-kulai-2": r("Kulai", 1.66, 103.6),
  "ap-melbourne-1": r("Melbourne", -37.81, 144.96),
  "ap-mumbai-1": r("Mumbai", 19.08, 72.88),
  "ap-osaka-1": r("Osaka", 34.69, 135.5),
  "ap-seoul-1": r("Seoul", 37.57, 126.98),
  "ap-singapore-1": r("Singapore", 1.35, 103.82),
  "ap-singapore-2": r("Singapore West", 1.35, 103.7),
  "ap-sydney-1": r("Sydney", -33.87, 151.21),
  "ap-tokyo-1": r("Tokyo", 35.68, 139.69),
  "ca-montreal-1": r("Montreal", 45.5, -73.57),
  "ca-toronto-1": r("Toronto", 43.65, -79.38),
  "eu-amsterdam-1": r("Amsterdam", 52.37, 4.9),
  "eu-dublin-3": r("Dublin", 53.35, -6.26),
  "eu-frankfurt-1": r("Frankfurt", 50.11, 8.68),
  "eu-frankfurt-2": r("Frankfurt (EU Sovereign)", 50.11, 8.68),
  "eu-jovanovac-1": r("Jovanovac", 44.01, 20.91),
  "eu-madrid-1": r("Madrid", 40.42, -3.7),
  "eu-madrid-2": r("Madrid (EU Sovereign)", 40.42, -3.7),
  "eu-madrid-3": r("Madrid 3", 40.42, -3.7),
  "eu-marseille-1": r("Marseille", 43.3, 5.37),
  "eu-milan-1": r("Milan", 45.46, 9.19),
  "eu-paris-1": r("Paris", 48.86, 2.35),
  "eu-stockholm-1": r("Stockholm", 59.33, 18.07),
  "eu-turin-1": r("Turin", 45.07, 7.69),
  "eu-zurich-1": r("Zurich", 47.38, 8.54),
  "il-jerusalem-1": r("Jerusalem", 31.77, 35.21),
  "me-abudhabi-1": r("Abu Dhabi", 24.45, 54.38),
  "me-dubai-1": r("Dubai", 25.2, 55.27),
  "me-jeddah-1": r("Jeddah", 21.49, 39.19),
  "me-riyadh-1": r("Riyadh", 24.71, 46.68),
  "mx-monterrey-1": r("Monterrey", 25.69, -100.32),
  "mx-queretaro-1": r("Queretaro", 20.59, -100.39),
  "sa-bogota-1": r("Bogota", 4.71, -74.07),
  "sa-riodejaneiro-2": r("Rio de Janeiro", -22.91, -43.17),
  "sa-santiago-1": r("Santiago", -33.45, -70.67),
  "sa-saopaulo-1": r("Sao Paulo", -23.55, -46.63),
  "sa-valparaiso-1": r("Valparaiso", -33.05, -71.62),
  "sa-vinhedo-1": r("Vinhedo", -23.03, -46.98),
  "uk-cardiff-1": r("Newport", 51.58, -3.0),
  "uk-london-1": r("London", 51.51, -0.13),
  "us-ashburn-1": r("Ashburn", 39.04, -77.49),
  "us-boardman-1": r("Boardman", 45.84, -119.7),
  "us-chicago-1": r("Chicago", 41.88, -87.63),
  "us-columbus-1": r("Columbus", 39.96, -83.0),
  "us-dallas-1": r("Dallas", 32.78, -96.8),
  "us-desmoines-1": r("Des Moines", 41.59, -93.62),
  "us-phoenix-1": r("Phoenix", 33.45, -112.07),
  "us-quincy-1": r("Quincy", 47.23, -119.85),
  "us-saltlake-2": r("Salt Lake City", 40.76, -111.89),
  "us-sanjose-1": r("San Jose", 37.34, -121.89),
  "us-shawnee-1": r("Shawnee", 39.04, -94.72),
};

const has = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

export const awsRegion = (id: string) => has(AWS_REGIONS, id.trim().toLowerCase());
export const gcpRegion = (id: string) => has(GCP_REGIONS, id.trim().toLowerCase());
export const ociRegion = (id: string) => has(OCI_REGIONS, id.trim().toLowerCase().replace(/^mc-/, ""));

/**
 * Pure: the Azure region a free-text title names, longest name first, so "East US 2"
 * is not read as "East US". Whole words only.
 */
export function azureRegionIn(text: string): CloudRegion | undefined {
  const t = ` ${text.replace(/[^A-Za-z0-9]+/g, " ").toLowerCase()} `;
  let best: CloudRegion | undefined;
  for (const [name, reg] of Object.entries(AZURE_REGIONS)) {
    if (t.includes(` ${name.toLowerCase()} `) && (!best || name.length > best.place.length)) best = reg;
  }
  return best;
}

/**
 * Pure: a region written the way third-party status pages write it, such as
 * Snowflake's component groups "GCP - US Central 1 (Iowa)", "AWS - US West 2
 * (Oregon)" or "Azure - East US 2 (Virginia)", or undefined.
 */
export function regionFromLabel(label: string): (CloudRegion & { cloud: "AWS" | "GCP" | "Azure"; id: string }) | undefined {
  const m = /^\s*(AWS|GCP|Azure)\s*[-–:]\s*(.+?)\s*(?:\(.*\))?\s*$/i.exec(label);
  if (!m) return undefined;
  const cloud = m[1].toUpperCase() === "AZURE" ? "Azure" : (m[1].toUpperCase() as "AWS" | "GCP");
  const words = m[2].trim().toLowerCase().split(/\s+/);
  if (cloud === "Azure") {
    const reg = azureRegionIn(m[2]);
    return reg ? { ...reg, cloud, id: reg.place } : undefined;
  }
  const num = /^\d+$/.test(words[words.length - 1] ?? "") ? words.pop()! : "";
  if (!num) return undefined;
  const id = cloud === "AWS" ? `${words.join("-")}-${num}` : `${words.join("-")}${num}`;
  const reg = cloud === "AWS" ? awsRegion(id) : gcpRegion(id);
  return reg ? { ...reg, cloud, id } : undefined;
}
