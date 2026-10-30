// The map clock's data and rules. PURE: no DOM, no React, and nothing here touches
// window at module scope, so the whole file runs in the node vitest environment.
//
// WHAT IT IS FOR. components/console/WorldClock.tsx is a pill of local times over the
// console map. It used to be seven hard-coded cities. It is now whichever airports the
// person picked (lib/console/clockStore.ts), labelled with the country as well as the
// airport code (a code alone is cryptic, and the code is still needed because one
// country spans several zones), and each clock flies the map to its airport. This file
// is everything about that which is not React:
//
//   - CLOCK_AIRPORTS      the 113 airports a person can pick from
//   - the ordering        always west to east by CURRENT UTC offset (so it follows DST)
//   - the labels          full, short and code-only, and the accessible names
//   - the search          city, airport code, airport name or country, accents ignored
//   - coerceClockCodes    what is trusted from storage
//   - chooseClockFit      which label tier fits the width the map has right now
//
// THE AIRPORT LIST. Source: OurAirports airports.csv (public domain,
// https://davidmegginson.github.io/ourairports-data/airports.csv), read 2026-10-30.
// Coordinates are the airport reference point from that file, 4 decimals, and were
// copied by script rather than typed. Every code below has `scheduled_service = yes`
// there. `short` is only set where the country has a well-known short form. `aka` is
// extra search words (USA, Britain, Holland...), never shown.
//
// NO DASHES IN THE STRINGS. Every string here ends up on screen or in a screen
// reader, so the em and en dashes stay out of them (a test pins it). The one
// deliberate non-ASCII mark is U+2212, the true minus in the UTC offset label.

export type ClockTier = "full" | "short" | "code";

export interface ClockAirport {
  code: string;
  airport: string;
  city: string;
  country: string;
  short?: string;
  zone: string;
  lat: number;
  lon: number;
  aka?: readonly string[];
}

export const CLOCK_AIRPORTS: readonly ClockAirport[] = [
  { code: "PPG", airport: "Pago Pago International", city: "Pago Pago", country: "American Samoa", zone: "Pacific/Pago_Pago", lat: -14.331, lon: -170.71 },
  { code: "HNL", airport: "Daniel K. Inouye International", city: "Honolulu", country: "United States", short: "US", zone: "Pacific/Honolulu", lat: 21.3184, lon: -157.9257, aka: ["USA","America","Hawaii"] },
  { code: "PPT", airport: "Tahiti Faa'a", city: "Papeete", country: "French Polynesia", zone: "Pacific/Tahiti", lat: -17.5535, lon: -149.6069, aka: ["Tahiti"] },
  { code: "ANC", airport: "Ted Stevens Anchorage International", city: "Anchorage", country: "United States", short: "US", zone: "America/Anchorage", lat: 61.179, lon: -149.9926, aka: ["USA","America","Alaska"] },
  { code: "LAX", airport: "Los Angeles International", city: "Los Angeles", country: "United States", short: "US", zone: "America/Los_Angeles", lat: 33.9425, lon: -118.408, aka: ["USA","America","LA"] },
  { code: "SFO", airport: "San Francisco International", city: "San Francisco", country: "United States", short: "US", zone: "America/Los_Angeles", lat: 37.6198, lon: -122.3748, aka: ["USA","America"] },
  { code: "SEA", airport: "Seattle-Tacoma International", city: "Seattle", country: "United States", short: "US", zone: "America/Los_Angeles", lat: 47.4479, lon: -122.3103, aka: ["USA","America"] },
  { code: "YVR", airport: "Vancouver International", city: "Vancouver", country: "Canada", zone: "America/Vancouver", lat: 49.1939, lon: -123.184 },
  { code: "PHX", airport: "Phoenix Sky Harbor", city: "Phoenix", country: "United States", short: "US", zone: "America/Phoenix", lat: 33.4353, lon: -112.0059, aka: ["USA","America","Arizona"] },
  { code: "DEN", airport: "Denver International", city: "Denver", country: "United States", short: "US", zone: "America/Denver", lat: 39.86, lon: -104.6738, aka: ["USA","America"] },
  { code: "YYC", airport: "Calgary International", city: "Calgary", country: "Canada", zone: "America/Edmonton", lat: 51.1188, lon: -114.0099 },
  { code: "DFW", airport: "Dallas/Fort Worth International", city: "Dallas", country: "United States", short: "US", zone: "America/Chicago", lat: 32.8968, lon: -97.038, aka: ["USA","America","Texas"] },
  { code: "IAH", airport: "George Bush Intercontinental", city: "Houston", country: "United States", short: "US", zone: "America/Chicago", lat: 29.9844, lon: -95.3414, aka: ["USA","America","Texas"] },
  { code: "ORD", airport: "Chicago O'Hare", city: "Chicago", country: "United States", short: "US", zone: "America/Chicago", lat: 41.9786, lon: -87.9048, aka: ["USA","America"] },
  { code: "MEX", airport: "Mexico City International", city: "Mexico City", country: "Mexico", zone: "America/Mexico_City", lat: 19.4358, lon: -99.0703 },
  { code: "CUN", airport: "Cancún International", city: "Cancún", country: "Mexico", zone: "America/Cancun", lat: 21.0408, lon: -86.8735 },
  { code: "BOG", airport: "El Dorado International", city: "Bogotá", country: "Colombia", zone: "America/Bogota", lat: 4.7016, lon: -74.1469 },
  { code: "LIM", airport: "Jorge Chávez International", city: "Lima", country: "Peru", zone: "America/Lima", lat: -12.0219, lon: -77.1143 },
  { code: "PTY", airport: "Tocumen International", city: "Panama City", country: "Panama", zone: "America/Panama", lat: 9.0714, lon: -79.3835 },
  { code: "RBR", airport: "Rio Branco International", city: "Rio Branco", country: "Brazil", zone: "America/Rio_Branco", lat: -9.869, lon: -67.894 },
  { code: "ATL", airport: "Hartsfield-Jackson Atlanta", city: "Atlanta", country: "United States", short: "US", zone: "America/New_York", lat: 33.6367, lon: -84.4281, aka: ["USA","America"] },
  { code: "JFK", airport: "John F. Kennedy International", city: "New York", country: "United States", short: "US", zone: "America/New_York", lat: 40.6394, lon: -73.7793, aka: ["USA","America","NYC"] },
  { code: "BOS", airport: "Boston Logan", city: "Boston", country: "United States", short: "US", zone: "America/New_York", lat: 42.362, lon: -71.0079, aka: ["USA","America"] },
  { code: "MIA", airport: "Miami International", city: "Miami", country: "United States", short: "US", zone: "America/New_York", lat: 25.796, lon: -80.2898, aka: ["USA","America","Florida"] },
  { code: "YYZ", airport: "Toronto Pearson", city: "Toronto", country: "Canada", zone: "America/Toronto", lat: 43.6759, lon: -79.6294 },
  { code: "YUL", airport: "Montréal-Trudeau", city: "Montreal", country: "Canada", zone: "America/Toronto", lat: 45.4678, lon: -73.7423 },
  { code: "CCS", airport: "Simón Bolívar International", city: "Caracas", country: "Venezuela", zone: "America/Caracas", lat: 10.6022, lon: -66.9912 },
  { code: "SJU", airport: "Luis Muñoz Marín International", city: "San Juan", country: "Puerto Rico", zone: "America/Puerto_Rico", lat: 18.4394, lon: -66.0018 },
  { code: "MAO", airport: "Eduardo Gomes International", city: "Manaus", country: "Brazil", zone: "America/Manaus", lat: -3.0386, lon: -60.0497 },
  { code: "SCL", airport: "Arturo Merino Benítez", city: "Santiago", country: "Chile", zone: "America/Santiago", lat: -33.393, lon: -70.7858 },
  { code: "YHZ", airport: "Halifax Stanfield", city: "Halifax", country: "Canada", zone: "America/Halifax", lat: 44.8808, lon: -63.5086 },
  { code: "YYT", airport: "St. John's International", city: "St. John's", country: "Canada", zone: "America/St_Johns", lat: 47.6186, lon: -52.7519, aka: ["Newfoundland"] },
  { code: "GRU", airport: "São Paulo Guarulhos", city: "São Paulo", country: "Brazil", zone: "America/Sao_Paulo", lat: -23.4313, lon: -46.47 },
  { code: "EZE", airport: "Ezeiza International", city: "Buenos Aires", country: "Argentina", zone: "America/Argentina/Buenos_Aires", lat: -34.8222, lon: -58.5358 },
  { code: "MVD", airport: "Carrasco International", city: "Montevideo", country: "Uruguay", zone: "America/Montevideo", lat: -34.8356, lon: -56.0265 },
  { code: "GOH", airport: "Nuuk", city: "Nuuk", country: "Greenland", zone: "America/Nuuk", lat: 64.1911, lon: -51.6791 },
  { code: "FEN", airport: "Fernando de Noronha", city: "Fernando de Noronha", country: "Brazil", zone: "America/Noronha", lat: -3.8545, lon: -32.423 },
  { code: "RAI", airport: "Nelson Mandela International", city: "Praia", country: "Cape Verde", zone: "Atlantic/Cape_Verde", lat: 14.9411, lon: -23.4847, aka: ["Cabo Verde"] },
  { code: "PDL", airport: "João Paulo II", city: "Ponta Delgada", country: "Portugal", zone: "Atlantic/Azores", lat: 37.7412, lon: -25.6979, aka: ["Azores"] },
  { code: "KEF", airport: "Keflavík International", city: "Reykjavík", country: "Iceland", zone: "Atlantic/Reykjavik", lat: 63.985, lon: -22.6056 },
  { code: "DSS", airport: "Blaise Diagne International", city: "Dakar", country: "Senegal", zone: "Africa/Dakar", lat: 14.6709, lon: -17.0728 },
  { code: "ACC", airport: "Kotoka International", city: "Accra", country: "Ghana", zone: "Africa/Accra", lat: 5.6052, lon: -0.1668 },
  { code: "LHR", airport: "London Heathrow", city: "London", country: "United Kingdom", short: "UK", zone: "Europe/London", lat: 51.4707, lon: -0.4599, aka: ["Britain","Great Britain","England"] },
  { code: "DUB", airport: "Dublin", city: "Dublin", country: "Ireland", zone: "Europe/Dublin", lat: 53.4287, lon: -6.2621 },
  { code: "LIS", airport: "Humberto Delgado", city: "Lisbon", country: "Portugal", zone: "Europe/Lisbon", lat: 38.7813, lon: -9.1359 },
  { code: "CMN", airport: "Mohammed V International", city: "Casablanca", country: "Morocco", zone: "Africa/Casablanca", lat: 33.3675, lon: -7.59 },
  { code: "LOS", airport: "Murtala Muhammed International", city: "Lagos", country: "Nigeria", zone: "Africa/Lagos", lat: 6.5774, lon: 3.3212 },
  { code: "MAD", airport: "Adolfo Suárez Madrid-Barajas", city: "Madrid", country: "Spain", zone: "Europe/Madrid", lat: 40.4934, lon: -3.5722 },
  { code: "CDG", airport: "Paris Charles de Gaulle", city: "Paris", country: "France", zone: "Europe/Paris", lat: 49.009, lon: 2.5541 },
  { code: "AMS", airport: "Amsterdam Schiphol", city: "Amsterdam", country: "Netherlands", zone: "Europe/Amsterdam", lat: 52.3086, lon: 4.7639, aka: ["Holland"] },
  { code: "FRA", airport: "Frankfurt", city: "Frankfurt", country: "Germany", zone: "Europe/Berlin", lat: 50.0267, lon: 8.5584 },
  { code: "ZRH", airport: "Zurich", city: "Zurich", country: "Switzerland", zone: "Europe/Zurich", lat: 47.4581, lon: 8.5481 },
  { code: "FCO", airport: "Rome Fiumicino", city: "Rome", country: "Italy", zone: "Europe/Rome", lat: 41.8045, lon: 12.252 },
  { code: "CPH", airport: "Copenhagen", city: "Copenhagen", country: "Denmark", zone: "Europe/Copenhagen", lat: 55.6179, lon: 12.656 },
  { code: "OSL", airport: "Oslo Gardermoen", city: "Oslo", country: "Norway", zone: "Europe/Oslo", lat: 60.1939, lon: 11.1004 },
  { code: "VIE", airport: "Vienna International", city: "Vienna", country: "Austria", zone: "Europe/Vienna", lat: 48.1103, lon: 16.5697 },
  { code: "ARN", airport: "Stockholm Arlanda", city: "Stockholm", country: "Sweden", zone: "Europe/Stockholm", lat: 59.6485, lon: 17.9288 },
  { code: "WAW", airport: "Warsaw Chopin", city: "Warsaw", country: "Poland", zone: "Europe/Warsaw", lat: 52.1657, lon: 20.9671 },
  { code: "BTS", airport: "Bratislava M. R. Štefánik", city: "Bratislava", country: "Slovakia", zone: "Europe/Bratislava", lat: 48.1702, lon: 17.2127 },
  { code: "JNB", airport: "O. R. Tambo International", city: "Johannesburg", country: "South Africa", zone: "Africa/Johannesburg", lat: -26.1401, lon: 28.2468 },
  { code: "ATH", airport: "Athens International", city: "Athens", country: "Greece", zone: "Europe/Athens", lat: 37.9364, lon: 23.9445 },
  { code: "CAI", airport: "Cairo International", city: "Cairo", country: "Egypt", zone: "Africa/Cairo", lat: 30.1115, lon: 31.3967 },
  { code: "OTP", airport: "Henri Coandă International", city: "Bucharest", country: "Romania", zone: "Europe/Bucharest", lat: 44.5718, lon: 26.1033 },
  { code: "HEL", airport: "Helsinki-Vantaa", city: "Helsinki", country: "Finland", zone: "Europe/Helsinki", lat: 60.3184, lon: 24.9633 },
  { code: "TLV", airport: "Ben Gurion", city: "Tel Aviv", country: "Israel", zone: "Asia/Jerusalem", lat: 32.0114, lon: 34.8867 },
  { code: "IST", airport: "Istanbul", city: "Istanbul", country: "Türkiye", zone: "Europe/Istanbul", lat: 41.2749, lon: 28.7321, aka: ["Turkey"] },
  { code: "SVO", airport: "Moscow Sheremetyevo", city: "Moscow", country: "Russia", zone: "Europe/Moscow", lat: 55.9775, lon: 37.3867, aka: ["Russian Federation"] },
  { code: "ADD", airport: "Addis Ababa Bole", city: "Addis Ababa", country: "Ethiopia", zone: "Africa/Addis_Ababa", lat: 8.9779, lon: 38.7993 },
  { code: "NBO", airport: "Jomo Kenyatta International", city: "Nairobi", country: "Kenya", zone: "Africa/Nairobi", lat: -1.3189, lon: 36.9282 },
  { code: "RUH", airport: "King Khalid International", city: "Riyadh", country: "Saudi Arabia", zone: "Asia/Riyadh", lat: 24.9576, lon: 46.6988 },
  { code: "DOH", airport: "Hamad International", city: "Doha", country: "Qatar", zone: "Asia/Qatar", lat: 25.2731, lon: 51.6081 },
  { code: "IKA", airport: "Imam Khomeini International", city: "Tehran", country: "Iran", zone: "Asia/Tehran", lat: 35.4161, lon: 51.1522 },
  { code: "DXB", airport: "Dubai International", city: "Dubai", country: "United Arab Emirates", short: "UAE", zone: "Asia/Dubai", lat: 25.2498, lon: 55.371, aka: ["Emirates"] },
  { code: "MRU", airport: "Sir Seewoosagur Ramgoolam International", city: "Mauritius", country: "Mauritius", zone: "Indian/Mauritius", lat: -20.4302, lon: 57.6836 },
  { code: "KBL", airport: "Kabul International", city: "Kabul", country: "Afghanistan", zone: "Asia/Kabul", lat: 34.5659, lon: 69.2123 },
  { code: "KHI", airport: "Jinnah International", city: "Karachi", country: "Pakistan", zone: "Asia/Karachi", lat: 24.9065, lon: 67.1608 },
  { code: "TAS", airport: "Tashkent International", city: "Tashkent", country: "Uzbekistan", zone: "Asia/Tashkent", lat: 41.2579, lon: 69.2812 },
  { code: "ALA", airport: "Almaty International", city: "Almaty", country: "Kazakhstan", zone: "Asia/Almaty", lat: 43.3543, lon: 77.0428 },
  { code: "BOM", airport: "Chhatrapati Shivaji Maharaj International", city: "Mumbai", country: "India", zone: "Asia/Kolkata", lat: 19.0887, lon: 72.8679, aka: ["Bombay"] },
  { code: "DEL", airport: "Indira Gandhi International", city: "Delhi", country: "India", zone: "Asia/Kolkata", lat: 28.5556, lon: 77.0952, aka: ["New Delhi"] },
  { code: "CMB", airport: "Bandaranaike International", city: "Colombo", country: "Sri Lanka", zone: "Asia/Colombo", lat: 7.1808, lon: 79.8841 },
  { code: "KTM", airport: "Tribhuvan International", city: "Kathmandu", country: "Nepal", zone: "Asia/Kathmandu", lat: 27.6966, lon: 85.3591 },
  { code: "DAC", airport: "Hazrat Shahjalal International", city: "Dhaka", country: "Bangladesh", zone: "Asia/Dhaka", lat: 23.8433, lon: 90.3978 },
  { code: "RGN", airport: "Yangon International", city: "Yangon", country: "Myanmar", zone: "Asia/Yangon", lat: 16.9073, lon: 96.1332, aka: ["Rangoon","Burma"] },
  { code: "OVB", airport: "Novosibirsk Tolmachevo", city: "Novosibirsk", country: "Russia", zone: "Asia/Novosibirsk", lat: 55.0198, lon: 82.6187, aka: ["Russian Federation"] },
  { code: "CGK", airport: "Soekarno-Hatta International", city: "Jakarta", country: "Indonesia", zone: "Asia/Jakarta", lat: -6.1256, lon: 106.656 },
  { code: "BKK", airport: "Suvarnabhumi", city: "Bangkok", country: "Thailand", zone: "Asia/Bangkok", lat: 13.6811, lon: 100.747 },
  { code: "SGN", airport: "Tan Son Nhat International", city: "Ho Chi Minh City", country: "Vietnam", zone: "Asia/Ho_Chi_Minh", lat: 10.8188, lon: 106.652, aka: ["Saigon"] },
  { code: "PER", airport: "Perth", city: "Perth", country: "Australia", zone: "Australia/Perth", lat: -31.9403, lon: 115.967 },
  { code: "SIN", airport: "Singapore Changi", city: "Singapore", country: "Singapore", zone: "Asia/Singapore", lat: 1.3502, lon: 103.994 },
  { code: "KUL", airport: "Kuala Lumpur International", city: "Kuala Lumpur", country: "Malaysia", zone: "Asia/Kuala_Lumpur", lat: 2.7456, lon: 101.71 },
  { code: "HKG", airport: "Hong Kong International", city: "Hong Kong", country: "Hong Kong", zone: "Asia/Hong_Kong", lat: 22.3118, lon: 113.9149 },
  { code: "PEK", airport: "Beijing Capital", city: "Beijing", country: "China", zone: "Asia/Shanghai", lat: 40.0773, lon: 116.5967 },
  { code: "PVG", airport: "Shanghai Pudong", city: "Shanghai", country: "China", zone: "Asia/Shanghai", lat: 31.1434, lon: 121.805 },
  { code: "MNL", airport: "Ninoy Aquino International", city: "Manila", country: "Philippines", zone: "Asia/Manila", lat: 14.5086, lon: 121.02 },
  { code: "TPE", airport: "Taiwan Taoyuan", city: "Taipei", country: "Taiwan", zone: "Asia/Taipei", lat: 25.0777, lon: 121.233 },
  { code: "ICN", airport: "Incheon International", city: "Seoul", country: "South Korea", zone: "Asia/Seoul", lat: 37.4691, lon: 126.451, aka: ["Korea"] },
  { code: "HND", airport: "Tokyo Haneda", city: "Tokyo", country: "Japan", zone: "Asia/Tokyo", lat: 35.5497, lon: 139.787 },
  { code: "DRW", airport: "Darwin International", city: "Darwin", country: "Australia", zone: "Australia/Darwin", lat: -12.415, lon: 130.8818 },
  { code: "ADL", airport: "Adelaide", city: "Adelaide", country: "Australia", zone: "Australia/Adelaide", lat: -34.9475, lon: 138.5334 },
  { code: "GUM", airport: "Antonio B. Won Pat International", city: "Hagåtña", country: "Guam", zone: "Pacific/Guam", lat: 13.485, lon: 144.7973 },
  { code: "BNE", airport: "Brisbane", city: "Brisbane", country: "Australia", zone: "Australia/Brisbane", lat: -27.3842, lon: 153.117 },
  { code: "VVO", airport: "Vladivostok International", city: "Vladivostok", country: "Russia", zone: "Asia/Vladivostok", lat: 43.3963, lon: 132.1482, aka: ["Russian Federation"] },
  { code: "SYD", airport: "Sydney Kingsford Smith", city: "Sydney", country: "Australia", zone: "Australia/Sydney", lat: -33.9461, lon: 151.177 },
  { code: "MEL", airport: "Melbourne", city: "Melbourne", country: "Australia", zone: "Australia/Melbourne", lat: -37.6707, lon: 144.8379 },
  { code: "NOU", airport: "La Tontouta International", city: "Nouméa", country: "New Caledonia", zone: "Pacific/Noumea", lat: -22.0146, lon: 166.213 },
  { code: "PKC", airport: "Petropavlovsk-Kamchatsky Yelizovo", city: "Petropavlovsk-Kamchatsky", country: "Russia", zone: "Asia/Kamchatka", lat: 53.1687, lon: 158.4511, aka: ["Russian Federation","Kamchatka"] },
  { code: "NAN", airport: "Nadi International", city: "Nadi", country: "Fiji", zone: "Pacific/Fiji", lat: -17.7618, lon: 177.4378 },
  { code: "AKL", airport: "Auckland", city: "Auckland", country: "New Zealand", short: "NZ", zone: "Pacific/Auckland", lat: -37.012, lon: 174.7863 },
  { code: "CHT", airport: "Tuuta", city: "Chatham Islands", country: "New Zealand", short: "NZ", zone: "Pacific/Chatham", lat: -43.8119, lon: -176.4651 },
  { code: "TBU", airport: "Fua'amotu International", city: "Nuku'alofa", country: "Tonga", zone: "Pacific/Tongatapu", lat: -21.2414, lon: -175.1492 },
  { code: "APW", airport: "Faleolo International", city: "Apia", country: "Samoa", zone: "Pacific/Apia", lat: -13.83, lon: -172.008 },
  { code: "CXI", airport: "Cassidy International", city: "Kiritimati", country: "Kiribati", zone: "Pacific/Kiritimati", lat: 1.9863, lon: -157.35, aka: ["Christmas Island"] },
];

/** What a person starts with, and what "Reset to default" returns to. */
export const DEFAULT_CLOCK_CODES: readonly string[] = Object.freeze([
  "LAX", "JFK", "LHR", "DXB", "SIN", "HND", "SYD",
]);

/** The most clocks the pill will hold. */
export const MAX_CLOCKS = 8;

const BY_CODE: ReadonlyMap<string, ClockAirport> = new Map(CLOCK_AIRPORTS.map((a) => [a.code, a]));

/** The airport for a code, or undefined for a code that is not in the list. */
export function clockAirport(code: string): ClockAirport | undefined {
  return BY_CODE.get(code);
}

// ─── Time zones ─────────────────────────────────────────────────────────────────
// One formatter per zone, made lazily. A zone this browser's Intl does not know makes
// the constructor throw, and callers treat that as "this clock does not exist here":
// a missing clock is better than one showing somebody else's time.

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    offsetFormatters.set(zone, f);
  }
  return f;
}

function timeFormatter(zone: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    timeFormatters.set(zone, f);
  }
  return f;
}

/**
 * Minutes east of UTC for a zone at an instant: `GMT+05:45` is 345, `GMT` is 0,
 * `GMT-03:30` is -210. Throws on a zone Intl does not know (or one it cannot name an
 * offset for), so the caller can skip that clock.
 */
export function utcOffsetMinutes(zone: string, now: Date): number {
  const name = offsetFormatter(zone).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /^(?:GMT|UTC)(?:([+\-−])(\d{1,2})(?::?(\d{2}))?)?$/.exec(name);
  if (!m) throw new RangeError(`No UTC offset for ${zone}`);
  if (!m[1]) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "+" ? minutes : -minutes;
}

/** `UTC+9`, `UTC−3` (a true minus, U+2212), `UTC+5:45`, `UTC+0`. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Local "HH:MM" (24 hour) and the hour of day for a zone. Throws on an unknown zone. */
export function clockLocalTime(zone: string, now: Date): { time: string; hour: number } {
  const time = timeFormatter(zone).format(now);
  return { time, hour: Number(time.slice(0, 2)) };
}

/** Daytime is 06:00 to 18:00 local. Only drives the is-day / is-night class. */
export function isDayHour(hour: number): boolean {
  return hour >= 6 && hour < 18;
}

/**
 * West to east by CURRENT UTC offset, then by longitude (west first), then by code.
 * "Current" matters: the order moves with daylight saving, which is why it is computed
 * and never stored. An airport whose zone this browser cannot resolve is dropped.
 */
export function orderWestToEast(list: readonly ClockAirport[], now: Date): ClockAirport[] {
  const keyed: { a: ClockAirport; off: number }[] = [];
  for (const a of list) {
    try {
      keyed.push({ a, off: utcOffsetMinutes(a.zone, now) });
    } catch {
      /* unknown zone: skipped */
    }
  }
  keyed.sort(
    (x, y) =>
      x.off - y.off ||
      x.a.lon - y.a.lon ||
      (x.a.code < y.a.code ? -1 : x.a.code > y.a.code ? 1 : 0),
  );
  return keyed.map((k) => k.a);
}

// ─── Labels and accessible names ────────────────────────────────────────────────

/** `LHR · United Kingdom`, `LHR · UK`, `LHR` (the dot is space, U+00B7, space). */
export function clockLabel(a: ClockAirport, tier: ClockTier): string {
  if (tier === "code") return a.code;
  return `${a.code} · ${tier === "full" ? a.country : (a.short ?? a.country)}`;
}

export const goToName = (a: ClockAirport): string => `Go to ${a.code}, ${a.airport}`;
export const removeName = (a: ClockAirport): string => `Remove ${a.code}, ${a.airport}`;
export const addName = (a: ClockAirport): string => `Add ${a.code}, ${a.airport}`;

// ─── Search ─────────────────────────────────────────────────────────────────────

/** Accents off, lowercase, hyphens and slashes read as spaces ("Dallas/Fort Worth"). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SearchRow {
  code: string;
  airport: string;
  city: string;
  country: string;
  short: string;
  aka: string[];
  airportWords: string[];
  cityWords: string[];
  haystack: string;
}

const searchIndex = new Map<string, SearchRow>();

function rowFor(a: ClockAirport): SearchRow {
  let r = searchIndex.get(a.code);
  if (!r) {
    const airport = norm(a.airport);
    const city = norm(a.city);
    const country = norm(a.country);
    const short = a.short ? norm(a.short) : "";
    const aka = (a.aka ?? []).map(norm);
    r = {
      code: a.code.toLowerCase(), airport, city, country, short, aka,
      airportWords: airport.split(" "), cityWords: city.split(" "),
      haystack: [a.code.toLowerCase(), airport, city, country, short, ...aka].join("\n"),
    };
    searchIndex.set(a.code, r);
  }
  return r;
}

/** 1 is best, 0 is no match. See searchClocks for what each rank means. */
function rankOf(q: string, r: SearchRow): number {
  if (q === r.code) return 1;
  if (q === r.city || q === r.country || (r.short && q === r.short) || r.aka.includes(q)) return 2;
  if (r.code.startsWith(q)) return 3;
  if (r.city.startsWith(q) || r.country.startsWith(q) || r.aka.some((x) => x.startsWith(q))) return 4;
  if (r.airportWords.some((w) => w.startsWith(q)) || r.cityWords.some((w) => w.startsWith(q))) return 5;
  if (r.haystack.includes(q)) return 6;
  return 0;
}

export interface ClockMatch extends ClockAirport {
  /** True when this airport is already one of the chosen clocks. */
  added: boolean;
}

/**
 * Every airport matching a city, airport code, airport name or country, best first. Both
 * sides are normalised (accents stripped, lowercase, trimmed). Rank: 1 exact code,
 * 2 exact city / country / short / aka, 3 code prefix, 4 city / country / aka prefix,
 * 5 any word prefix in the airport name or city, 6 substring anywhere. Ties run west to
 * east, the order the bar uses. Airports already chosen are KEPT and flagged `added`,
 * because the picker shows them as "Added" rather than hiding them (a vanishing row
 * reads as a failed search). No query means no results.
 */
export function searchClocks(
  query: string,
  chosen: readonly string[] = [],
  now: Date = new Date(),
): ClockMatch[] {
  const q = norm(query);
  if (!q) return [];
  const have = new Set(chosen);
  const hits: { a: ClockAirport; rank: number; off: number }[] = [];
  for (const a of CLOCK_AIRPORTS) {
    const rank = rankOf(q, rowFor(a));
    if (!rank) continue;
    try {
      hits.push({ a, rank, off: utcOffsetMinutes(a.zone, now) });
    } catch {
      /* unknown zone: not offered */
    }
  }
  hits.sort(
    (x, y) =>
      x.rank - y.rank ||
      x.off - y.off ||
      x.a.lon - y.a.lon ||
      (x.a.code < y.a.code ? -1 : x.a.code > y.a.code ? 1 : 0),
  );
  return hits.map((h) => ({ ...h.a, added: have.has(h.a.code) }));
}

// ─── What storage is trusted for ────────────────────────────────────────────────

/**
 * Narrow an untrusted value (persisted JSON) to a list of clock codes: not an array is the
 * defaults; keep strings, uppercase them, keep only codes in the list, first occurrence
 * wins, at most MAX_CLOCKS; nothing left is the defaults. There is always one clock.
 */
export function coerceClockCodes(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_CLOCK_CODES];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const code = item.toUpperCase();
    if (!BY_CODE.has(code) || out.includes(code)) continue;
    out.push(code);
    if (out.length === MAX_CLOCKS) break;
  }
  return out.length > 0 ? out : [...DEFAULT_CLOCK_CODES];
}

/** Same airports, whatever order they were added in. */
export function sameClockSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

// ─── Fit ────────────────────────────────────────────────────────────────────────

export interface ClockFitInput {
  /** The stage width minus the foot row's padding (16). */
  avail: number;
  /** The measured pill width of ALL the current clocks, per tier. */
  widths: Record<ClockTier, number>;
  /** The measured width of each clock in the code tier, west to east. */
  codeWidths: number[];
  /** Pill padding plus borders: the pill's width minus the sum of its cells. */
  pillChrome: number;
  /** The gear's footprint beside the pill: 26 + 6. */
  gear: number;
  /** The same with "+N" in it, measured (about 52). */
  gearMore: number;
}

export interface ClockFit {
  tier: ClockTier;
  /** How many clocks to show, from the west end. */
  shown: number;
  /** Move the pill LEFT by this many px so the gear stays on the stage. */
  shift: number;
}

/**
 * Which label tier to use and how many clocks to show. The pill is centred in the foot
 * row and the gear hangs off its right end without taking any room in the flow, so the
 * gear is kept inside the stage by reserving it on BOTH sides (w + 2 * gear <= avail).
 * Where that fails but w + gear still fits, the pill slides left by the overshoot rather
 * than shrinking a tier. Where no tier fits, the code tier is used and clocks leave from
 * the EAST end one at a time, tested with the wider "+N" gear; never fewer than one.
 */
export function chooseClockFit(input: ClockFitInput): ClockFit {
  const { avail, widths, codeWidths, pillChrome, gear, gearMore } = input;
  const total = codeWidths.length;
  const place = (w: number, g: number): number | null => {
    if (w + 2 * g <= avail) return 0;
    if (w + g <= avail) return Math.ceil((w + 2 * g - avail) / 2);
    return null;
  };
  for (const tier of ["full", "short", "code"] as const) {
    const shift = place(widths[tier], gear);
    if (shift !== null) return { tier, shown: total, shift };
  }
  for (let shown = total - 1; shown >= 1; shown--) {
    let w = pillChrome;
    for (let i = 0; i < shown; i++) w += codeWidths[i];
    const shift = place(w, gearMore);
    if (shift !== null) return { tier: "code", shown, shift };
  }
  return { tier: "code", shown: 1, shift: 0 };
}
