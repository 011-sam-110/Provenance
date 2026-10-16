// Curated static dataset — the world's major container/cargo seaports.
//
// SOURCE: compiled 2026-06-27 from the publicly documented "busiest container
// ports" rankings (Wikipedia "List of busiest container ports", 2023 throughput)
// cross-referenced with each port's published location. Coordinates are
// port-area approximations (port-precision, ~1 km), which is appropriate for a
// global marker layer. This is a STATIC, dated, hand-verified list — it is NOT a
// live feed, deliberately: a "top ~70 ports" set has no reliable keyless live
// endpoint (OSM tags every small cargo harbour, ~3,000+, with no size signal).
//
// Each entry: { name, locode, country (ISO-3166-1 alpha-2), lat, lon }. `locode` is
// the port's UN/LOCODE as UNCTAD and Eurostat key it (added 2026-10-16 to join the
// port statistics in ports.stats.data.ts). Where one city has several codes the code
// of the terminal the pin sits on is used: Shenzhen = CNSHK (Shekou), Guangzhou =
// CNNSA (Nansha), Tianjin = CNXGG (Xingang).
//
// THE ORDER OF THIS FILE IS NOT A RANKING. The first ~30 rows follow the 2023
// ranking; after that the rows are grouped by region. Do not derive a rank from the
// array index (it was, until 2026-10-16, and prod showed Gothenburg as "#71").

export interface PortRecord {
  name: string;
  /** UN/LOCODE, the join key for the port statistics. */
  locode?: string;
  country: string;
  lat: number;
  lon: number;
}

export const MAJOR_PORTS: PortRecord[] = [
  { name: "Shanghai", locode: "CNSHA", country: "CN", lat: 31.23, lon: 121.5 },
  { name: "Singapore", locode: "SGSIN", country: "SG", lat: 1.26, lon: 103.84 },
  { name: "Ningbo-Zhoushan", locode: "CNNGB", country: "CN", lat: 29.87, lon: 121.83 },
  { name: "Shenzhen", locode: "CNSHK", country: "CN", lat: 22.55, lon: 113.92 },
  { name: "Guangzhou", locode: "CNNSA", country: "CN", lat: 23.1, lon: 113.45 },
  { name: "Qingdao", locode: "CNTAO", country: "CN", lat: 36.07, lon: 120.32 },
  { name: "Busan", locode: "KRPUS", country: "KR", lat: 35.1, lon: 129.04 },
  { name: "Tianjin", locode: "CNXGG", country: "CN", lat: 38.98, lon: 117.74 },
  { name: "Hong Kong", locode: "HKHKG", country: "HK", lat: 22.32, lon: 114.13 },
  { name: "Rotterdam", locode: "NLRTM", country: "NL", lat: 51.95, lon: 4.14 },
  { name: "Jebel Ali (Dubai)", locode: "AEJEA", country: "AE", lat: 25.01, lon: 55.06 },
  { name: "Port Klang", locode: "MYPKG", country: "MY", lat: 3.0, lon: 101.39 },
  { name: "Antwerp", locode: "BEANR", country: "BE", lat: 51.28, lon: 4.32 },
  { name: "Xiamen", locode: "CNXMN", country: "CN", lat: 24.48, lon: 118.07 },
  { name: "Kaohsiung", locode: "TWKHH", country: "TW", lat: 22.61, lon: 120.28 },
  { name: "Los Angeles", locode: "USLAX", country: "US", lat: 33.74, lon: -118.26 },
  { name: "Long Beach", locode: "USLGB", country: "US", lat: 33.75, lon: -118.2 },
  { name: "Hamburg", locode: "DEHAM", country: "DE", lat: 53.53, lon: 9.93 },
  { name: "Tanjung Pelepas", locode: "MYTPP", country: "MY", lat: 1.36, lon: 103.55 },
  { name: "Laem Chabang", locode: "THLCH", country: "TH", lat: 13.08, lon: 100.88 },
  { name: "New York / New Jersey", locode: "USNYC", country: "US", lat: 40.66, lon: -74.05 },
  { name: "Jawaharlal Nehru (Nhava Sheva)", locode: "INNSA", country: "IN", lat: 18.95, lon: 72.95 },
  { name: "Colombo", locode: "LKCMB", country: "LK", lat: 6.95, lon: 79.84 },
  { name: "Jeddah", locode: "SAJED", country: "SA", lat: 21.46, lon: 39.16 },
  { name: "Algeciras", locode: "ESALG", country: "ES", lat: 36.13, lon: -5.43 },
  { name: "Valencia", locode: "ESVLC", country: "ES", lat: 39.44, lon: -0.32 },
  { name: "Piraeus", locode: "GRPIR", country: "GR", lat: 37.94, lon: 23.62 },
  { name: "Felixstowe", locode: "GBFXT", country: "GB", lat: 51.95, lon: 1.31 },
  { name: "Savannah", locode: "USSAV", country: "US", lat: 32.13, lon: -81.14 },
  { name: "Manila", locode: "PHMNL", country: "PH", lat: 14.6, lon: 120.96 },
  { name: "Tokyo", locode: "JPTYO", country: "JP", lat: 35.62, lon: 139.78 },
  { name: "Yokohama", locode: "JPYOK", country: "JP", lat: 35.45, lon: 139.66 },
  { name: "Nagoya", locode: "JPNGO", country: "JP", lat: 35.05, lon: 136.85 },
  { name: "Kobe", locode: "JPUKB", country: "JP", lat: 34.68, lon: 135.21 },
  { name: "Bremerhaven", locode: "DEBRV", country: "DE", lat: 53.57, lon: 8.56 },
  { name: "Tanger Med", locode: "MAPTM", country: "MA", lat: 35.88, lon: -5.5 },
  { name: "Mundra", locode: "INMUN", country: "IN", lat: 22.74, lon: 69.7 },
  { name: "Mersin", locode: "TRMER", country: "TR", lat: 36.8, lon: 34.65 },
  { name: "Santos", locode: "BRSSZ", country: "BR", lat: -23.96, lon: -46.3 },
  { name: "Cartagena", locode: "COCTG", country: "CO", lat: 10.4, lon: -75.51 },
  { name: "Manzanillo", locode: "MXZLO", country: "MX", lat: 19.05, lon: -104.31 },
  { name: "Durban", locode: "ZADUR", country: "ZA", lat: -29.87, lon: 31.03 },
  { name: "Port Said", locode: "EGPSD", country: "EG", lat: 31.25, lon: 32.3 },
  { name: "Salalah", locode: "OMSLL", country: "OM", lat: 16.95, lon: 54.01 },
  { name: "Gioia Tauro", locode: "ITGIT", country: "IT", lat: 38.45, lon: 15.92 },
  { name: "Le Havre", locode: "FRLEH", country: "FR", lat: 49.48, lon: 0.13 },
  { name: "Barcelona", locode: "ESBCN", country: "ES", lat: 41.34, lon: 2.16 },
  { name: "Genoa", locode: "ITGOA", country: "IT", lat: 44.4, lon: 8.9 },
  { name: "Vancouver", locode: "CAVAN", country: "CA", lat: 49.29, lon: -123.1 },
  { name: "Seattle / Tacoma", locode: "USSEA", country: "US", lat: 47.27, lon: -122.41 },
  { name: "Houston", locode: "USHOU", country: "US", lat: 29.73, lon: -95.27 },
  { name: "Virginia (Norfolk)", locode: "USORF", country: "US", lat: 36.93, lon: -76.33 },
  { name: "Charleston", locode: "USCHS", country: "US", lat: 32.78, lon: -79.92 },
  { name: "Melbourne", locode: "AUMEL", country: "AU", lat: -37.84, lon: 144.92 },
  { name: "Port Botany (Sydney)", locode: "AUSYD", country: "AU", lat: -33.98, lon: 151.23 },
  { name: "Fremantle", locode: "AUFRE", country: "AU", lat: -32.05, lon: 115.74 },
  { name: "Auckland", locode: "NZAKL", country: "NZ", lat: -36.84, lon: 174.78 },
  { name: "Chennai", locode: "INMAA", country: "IN", lat: 13.1, lon: 80.3 },
  { name: "Mumbai", locode: "INBOM", country: "IN", lat: 18.95, lon: 72.84 },
  { name: "Chittagong", locode: "BDCGP", country: "BD", lat: 22.31, lon: 91.81 },
  { name: "Karachi", locode: "PKKHI", country: "PK", lat: 24.81, lon: 66.98 },
  { name: "Lagos (Apapa)", locode: "NGAPP", country: "NG", lat: 6.45, lon: 3.36 },
  { name: "Mombasa", locode: "KEMBA", country: "KE", lat: -4.05, lon: 39.65 },
  { name: "Buenos Aires", locode: "ARBUE", country: "AR", lat: -34.61, lon: -58.37 },
  { name: "Callao", locode: "PECLL", country: "PE", lat: -12.05, lon: -77.15 },
  { name: "Balboa", locode: "PABLB", country: "PA", lat: 8.95, lon: -79.57 },
  { name: "Colon", locode: "PAONX", country: "PA", lat: 9.36, lon: -79.9 },
  { name: "Hamad", locode: "QAHMD", country: "QA", lat: 25.03, lon: 51.61 },
  { name: "Khalifa (Abu Dhabi)", locode: "AEKHL", country: "AE", lat: 24.81, lon: 54.65 },
  { name: "Gdansk", locode: "PLGDN", country: "PL", lat: 54.4, lon: 18.7 },
  { name: "Gothenburg", locode: "SEGOT", country: "SE", lat: 57.69, lon: 11.86 },
];
