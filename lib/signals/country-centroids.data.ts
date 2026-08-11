// Country centroids (ISO-3166 alpha-2 + alpha-3 -> representative lat/lon), generated
// once from a keyless public dataset (eesur/country-codes-lat-long). Backs the
// country-AGGREGATED signal layers (cyber threat by country, displacement by country)
// and, later, travel advisories + the Country Instability Index. A centroid is a label
// anchor, not a precise location - these layers are explicitly country-level.

export interface CountryCentroid {
  iso2: string;
  iso3: string;
  name: string;
  lat: number;
  lon: number;
}

export const COUNTRY_CENTROIDS: CountryCentroid[] = [
  { iso2: "AD", iso3: "AND", name: "Andorra", lat: 42.5, lon: 1.6 },
  { iso2: "AE", iso3: "ARE", name: "United Arab Emirates", lat: 24.0, lon: 54.0 },
  { iso2: "AF", iso3: "AFG", name: "Afghanistan", lat: 33.0, lon: 65.0 },
  { iso2: "AG", iso3: "ATG", name: "Antigua and Barbuda", lat: 17.05, lon: -61.8 },
  { iso2: "AI", iso3: "AIA", name: "Anguilla", lat: 18.25, lon: -63.1667 },
  { iso2: "AL", iso3: "ALB", name: "Albania", lat: 41.0, lon: 20.0 },
  { iso2: "AM", iso3: "ARM", name: "Armenia", lat: 40.0, lon: 45.0 },
  { iso2: "AN", iso3: "ANT", name: "Netherlands Antilles", lat: 12.25, lon: -68.75 },
  { iso2: "AO", iso3: "AGO", name: "Angola", lat: -12.5, lon: 18.5 },
  { iso2: "AQ", iso3: "ATA", name: "Antarctica", lat: -90.0, lon: 0.0 },
  { iso2: "AR", iso3: "ARG", name: "Argentina", lat: -34.0, lon: -64.0 },
  { iso2: "AS", iso3: "ASM", name: "American Samoa", lat: -14.3333, lon: -170.0 },
  { iso2: "AT", iso3: "AUT", name: "Austria", lat: 47.3333, lon: 13.3333 },
  { iso2: "AU", iso3: "AUS", name: "Australia", lat: -27.0, lon: 133.0 },
  { iso2: "AW", iso3: "ABW", name: "Aruba", lat: 12.5, lon: -69.9667 },
  { iso2: "AZ", iso3: "AZE", name: "Azerbaijan", lat: 40.5, lon: 47.5 },
  { iso2: "BA", iso3: "BIH", name: "Bosnia and Herzegovina", lat: 44.0, lon: 18.0 },
  { iso2: "BB", iso3: "BRB", name: "Barbados", lat: 13.1667, lon: -59.5333 },
  { iso2: "BD", iso3: "BGD", name: "Bangladesh", lat: 24.0, lon: 90.0 },
  { iso2: "BE", iso3: "BEL", name: "Belgium", lat: 50.8333, lon: 4.0 },
  { iso2: "BF", iso3: "BFA", name: "Burkina Faso", lat: 13.0, lon: -2.0 },
  { iso2: "BG", iso3: "BGR", name: "Bulgaria", lat: 43.0, lon: 25.0 },
  { iso2: "BH", iso3: "BHR", name: "Bahrain", lat: 26.0, lon: 50.55 },
  { iso2: "BI", iso3: "BDI", name: "Burundi", lat: -3.5, lon: 30.0 },
  { iso2: "BJ", iso3: "BEN", name: "Benin", lat: 9.5, lon: 2.25 },
  // BL, and (further down, each in its alphabetical place) BQ/CW/MF/SX/SS/XK
  // were missing from the original generated dataset (most added to ISO 3166-1
  // in 2010-11, after the source snapshot). Confirmed missing 2026-08-11 and
  // cross-checked against lib/geo/fcdoSlugs.data.ts, which already expects
  // centroids for all seven (it hand-resolves them as FCDO-published
  // territories) -- so their absence here was silently dropping a resolved FCDO
  // slug's marker, exactly like the South Sudan gap this fix targets.
  { iso2: "BL", iso3: "BLM", name: "Saint Barthélemy", lat: 17.9, lon: -62.8333 }, // Gustavia, verified against Wikipedia's infobox coordinates
  { iso2: "BM", iso3: "BMU", name: "Bermuda", lat: 32.3333, lon: -64.75 },
  { iso2: "BN", iso3: "BRN", name: "Brunei Darussalam", lat: 4.5, lon: 114.6667 },
  { iso2: "BO", iso3: "BOL", name: "Bolivia, Plurinational State of", lat: -17.0, lon: -65.0 },
  { iso2: "BQ", iso3: "BES", name: "Bonaire, Sint Eustatius and Saba", lat: 12.1667, lon: -68.25 }, // one ISO row for 3 islands ~500km apart; centred on Bonaire (the largest), per common practice (mledoze/countries)
  { iso2: "BR", iso3: "BRA", name: "Brazil", lat: -10.0, lon: -55.0 },
  { iso2: "BS", iso3: "BHS", name: "Bahamas", lat: 24.25, lon: -76.0 },
  { iso2: "BT", iso3: "BTN", name: "Bhutan", lat: 27.5, lon: 90.5 },
  { iso2: "BV", iso3: "BVT", name: "Bouvet Island", lat: -54.4333, lon: 3.4 },
  { iso2: "BW", iso3: "BWA", name: "Botswana", lat: -22.0, lon: 24.0 },
  { iso2: "BY", iso3: "BLR", name: "Belarus", lat: 53.0, lon: 28.0 },
  { iso2: "BZ", iso3: "BLZ", name: "Belize", lat: 17.25, lon: -88.75 },
  { iso2: "CA", iso3: "CAN", name: "Canada", lat: 60.0, lon: -95.0 },
  { iso2: "CC", iso3: "CCK", name: "Cocos (Keeling) Islands", lat: -12.5, lon: 96.8333 },
  { iso2: "CD", iso3: "COD", name: "Congo, the Democratic Republic of the", lat: 0.0, lon: 25.0 },
  { iso2: "CF", iso3: "CAF", name: "Central African Republic", lat: 7.0, lon: 21.0 },
  { iso2: "CG", iso3: "COG", name: "Congo", lat: -1.0, lon: 15.0 },
  { iso2: "CH", iso3: "CHE", name: "Switzerland", lat: 47.0, lon: 8.0 },
  { iso2: "CI", iso3: "CIV", name: "Côte d'Ivoire", lat: 8.0, lon: -5.0 },
  { iso2: "CK", iso3: "COK", name: "Cook Islands", lat: -21.2333, lon: -159.7667 },
  { iso2: "CL", iso3: "CHL", name: "Chile", lat: -30.0, lon: -71.0 },
  { iso2: "CM", iso3: "CMR", name: "Cameroon", lat: 6.0, lon: 12.0 },
  { iso2: "CN", iso3: "CHN", name: "China", lat: 35.0, lon: 105.0 },
  { iso2: "CO", iso3: "COL", name: "Colombia", lat: 4.0, lon: -72.0 },
  { iso2: "CR", iso3: "CRI", name: "Costa Rica", lat: 10.0, lon: -84.0 },
  { iso2: "CU", iso3: "CUB", name: "Cuba", lat: 21.5, lon: -80.0 },
  { iso2: "CV", iso3: "CPV", name: "Cape Verde", lat: 16.0, lon: -24.0 },
  { iso2: "CW", iso3: "CUW", name: "Curaçao", lat: 12.1833, lon: -68.9833 }, // Willemstad, verified against Wikipedia's infobox coordinates
  { iso2: "CX", iso3: "CXR", name: "Christmas Island", lat: -10.5, lon: 105.6667 },
  { iso2: "CY", iso3: "CYP", name: "Cyprus", lat: 35.0, lon: 33.0 },
  { iso2: "CZ", iso3: "CZE", name: "Czech Republic", lat: 49.75, lon: 15.5 },
  { iso2: "DE", iso3: "DEU", name: "Germany", lat: 51.0, lon: 9.0 },
  { iso2: "DJ", iso3: "DJI", name: "Djibouti", lat: 11.5, lon: 43.0 },
  { iso2: "DK", iso3: "DNK", name: "Denmark", lat: 56.0, lon: 10.0 },
  { iso2: "DM", iso3: "DMA", name: "Dominica", lat: 15.4167, lon: -61.3333 },
  { iso2: "DO", iso3: "DOM", name: "Dominican Republic", lat: 19.0, lon: -70.6667 },
  { iso2: "DZ", iso3: "DZA", name: "Algeria", lat: 28.0, lon: 3.0 },
  { iso2: "EC", iso3: "ECU", name: "Ecuador", lat: -2.0, lon: -77.5 },
  { iso2: "EE", iso3: "EST", name: "Estonia", lat: 59.0, lon: 26.0 },
  { iso2: "EG", iso3: "EGY", name: "Egypt", lat: 27.0, lon: 30.0 },
  { iso2: "EH", iso3: "ESH", name: "Western Sahara", lat: 24.5, lon: -13.0 },
  { iso2: "ER", iso3: "ERI", name: "Eritrea", lat: 15.0, lon: 39.0 },
  { iso2: "ES", iso3: "ESP", name: "Spain", lat: 40.0, lon: -4.0 },
  { iso2: "ET", iso3: "ETH", name: "Ethiopia", lat: 8.0, lon: 38.0 },
  { iso2: "FI", iso3: "FIN", name: "Finland", lat: 64.0, lon: 26.0 },
  { iso2: "FJ", iso3: "FJI", name: "Fiji", lat: -18.0, lon: 175.0 },
  { iso2: "FK", iso3: "FLK", name: "Falkland Islands (Malvinas)", lat: -51.75, lon: -59.0 },
  { iso2: "FM", iso3: "FSM", name: "Micronesia, Federated States of", lat: 6.9167, lon: 158.25 },
  { iso2: "FO", iso3: "FRO", name: "Faroe Islands", lat: 62.0, lon: -7.0 },
  { iso2: "FR", iso3: "FRA", name: "France", lat: 46.0, lon: 2.0 },
  { iso2: "GA", iso3: "GAB", name: "Gabon", lat: -1.0, lon: 11.75 },
  { iso2: "GB", iso3: "GBR", name: "United Kingdom", lat: 54.0, lon: -2.0 },
  { iso2: "GD", iso3: "GRD", name: "Grenada", lat: 12.1167, lon: -61.6667 },
  { iso2: "GE", iso3: "GEO", name: "Georgia", lat: 42.0, lon: 43.5 },
  { iso2: "GF", iso3: "GUF", name: "French Guiana", lat: 4.0, lon: -53.0 },
  { iso2: "GG", iso3: "GGY", name: "Guernsey", lat: 49.5, lon: -2.56 },
  { iso2: "GH", iso3: "GHA", name: "Ghana", lat: 8.0, lon: -2.0 },
  { iso2: "GI", iso3: "GIB", name: "Gibraltar", lat: 36.1833, lon: -5.3667 },
  { iso2: "GL", iso3: "GRL", name: "Greenland", lat: 72.0, lon: -40.0 },
  { iso2: "GM", iso3: "GMB", name: "Gambia", lat: 13.4667, lon: -16.5667 },
  { iso2: "GN", iso3: "GIN", name: "Guinea", lat: 11.0, lon: -10.0 },
  { iso2: "GP", iso3: "GLP", name: "Guadeloupe", lat: 16.25, lon: -61.5833 },
  { iso2: "GQ", iso3: "GNQ", name: "Equatorial Guinea", lat: 2.0, lon: 10.0 },
  { iso2: "GR", iso3: "GRC", name: "Greece", lat: 39.0, lon: 22.0 },
  { iso2: "GS", iso3: "SGS", name: "South Georgia and the South Sandwich Islands", lat: -54.5, lon: -37.0 },
  { iso2: "GT", iso3: "GTM", name: "Guatemala", lat: 15.5, lon: -90.25 },
  { iso2: "GU", iso3: "GUM", name: "Guam", lat: 13.4667, lon: 144.7833 },
  { iso2: "GW", iso3: "GNB", name: "Guinea-Bissau", lat: 12.0, lon: -15.0 },
  { iso2: "GY", iso3: "GUY", name: "Guyana", lat: 5.0, lon: -59.0 },
  { iso2: "HK", iso3: "HKG", name: "Hong Kong", lat: 22.25, lon: 114.1667 },
  { iso2: "HM", iso3: "HMD", name: "Heard Island and McDonald Islands", lat: -53.1, lon: 72.5167 },
  { iso2: "HN", iso3: "HND", name: "Honduras", lat: 15.0, lon: -86.5 },
  { iso2: "HR", iso3: "HRV", name: "Croatia", lat: 45.1667, lon: 15.5 },
  { iso2: "HT", iso3: "HTI", name: "Haiti", lat: 19.0, lon: -72.4167 },
  { iso2: "HU", iso3: "HUN", name: "Hungary", lat: 47.0, lon: 20.0 },
  { iso2: "ID", iso3: "IDN", name: "Indonesia", lat: -5.0, lon: 120.0 },
  { iso2: "IE", iso3: "IRL", name: "Ireland", lat: 53.0, lon: -8.0 },
  { iso2: "IL", iso3: "ISR", name: "Israel", lat: 31.5, lon: 34.75 },
  { iso2: "IM", iso3: "IMN", name: "Isle of Man", lat: 54.23, lon: -4.55 },
  { iso2: "IN", iso3: "IND", name: "India", lat: 20.0, lon: 77.0 },
  { iso2: "IO", iso3: "IOT", name: "British Indian Ocean Territory", lat: -6.0, lon: 71.5 },
  { iso2: "IQ", iso3: "IRQ", name: "Iraq", lat: 33.0, lon: 44.0 },
  { iso2: "IR", iso3: "IRN", name: "Iran, Islamic Republic of", lat: 32.0, lon: 53.0 },
  { iso2: "IS", iso3: "ISL", name: "Iceland", lat: 65.0, lon: -18.0 },
  { iso2: "IT", iso3: "ITA", name: "Italy", lat: 42.8333, lon: 12.8333 },
  { iso2: "JE", iso3: "JEY", name: "Jersey", lat: 49.21, lon: -2.13 },
  { iso2: "JM", iso3: "JAM", name: "Jamaica", lat: 18.25, lon: -77.5 },
  { iso2: "JO", iso3: "JOR", name: "Jordan", lat: 31.0, lon: 36.0 },
  { iso2: "JP", iso3: "JPN", name: "Japan", lat: 36.0, lon: 138.0 },
  { iso2: "KE", iso3: "KEN", name: "Kenya", lat: 1.0, lon: 38.0 },
  { iso2: "KG", iso3: "KGZ", name: "Kyrgyzstan", lat: 41.0, lon: 75.0 },
  { iso2: "KH", iso3: "KHM", name: "Cambodia", lat: 13.0, lon: 105.0 },
  { iso2: "KI", iso3: "KIR", name: "Kiribati", lat: 1.4167, lon: 173.0 },
  { iso2: "KM", iso3: "COM", name: "Comoros", lat: -12.1667, lon: 44.25 },
  { iso2: "KN", iso3: "KNA", name: "Saint Kitts and Nevis", lat: 17.3333, lon: -62.75 },
  { iso2: "KP", iso3: "PRK", name: "Korea, Democratic People's Republic of", lat: 40.0, lon: 127.0 },
  { iso2: "KR", iso3: "KOR", name: "Korea, Republic of", lat: 37.0, lon: 127.5 },
  { iso2: "KW", iso3: "KWT", name: "Kuwait", lat: 29.3375, lon: 47.6581 },
  { iso2: "KY", iso3: "CYM", name: "Cayman Islands", lat: 19.5, lon: -80.5 },
  { iso2: "KZ", iso3: "KAZ", name: "Kazakhstan", lat: 48.0, lon: 68.0 },
  { iso2: "LA", iso3: "LAO", name: "Lao People's Democratic Republic", lat: 18.0, lon: 105.0 },
  { iso2: "LB", iso3: "LBN", name: "Lebanon", lat: 33.8333, lon: 35.8333 },
  { iso2: "LC", iso3: "LCA", name: "Saint Lucia", lat: 13.8833, lon: -61.1333 },
  { iso2: "LI", iso3: "LIE", name: "Liechtenstein", lat: 47.1667, lon: 9.5333 },
  { iso2: "LK", iso3: "LKA", name: "Sri Lanka", lat: 7.0, lon: 81.0 },
  { iso2: "LR", iso3: "LBR", name: "Liberia", lat: 6.5, lon: -9.5 },
  { iso2: "LS", iso3: "LSO", name: "Lesotho", lat: -29.5, lon: 28.5 },
  { iso2: "LT", iso3: "LTU", name: "Lithuania", lat: 56.0, lon: 24.0 },
  { iso2: "LU", iso3: "LUX", name: "Luxembourg", lat: 49.75, lon: 6.1667 },
  { iso2: "LV", iso3: "LVA", name: "Latvia", lat: 57.0, lon: 25.0 },
  { iso2: "LY", iso3: "LBY", name: "Libyan Arab Jamahiriya", lat: 25.0, lon: 17.0 },
  { iso2: "MA", iso3: "MAR", name: "Morocco", lat: 32.0, lon: -5.0 },
  { iso2: "MC", iso3: "MCO", name: "Monaco", lat: 43.7333, lon: 7.4 },
  { iso2: "MD", iso3: "MDA", name: "Moldova, Republic of", lat: 47.0, lon: 29.0 },
  { iso2: "ME", iso3: "MNE", name: "Montenegro", lat: 42.0, lon: 19.0 },
  { iso2: "MF", iso3: "MAF", name: "Saint Martin (French part)", lat: 18.0833, lon: -63.05 }, // Marigot, verified against Wikipedia's infobox coordinates
  { iso2: "MG", iso3: "MDG", name: "Madagascar", lat: -20.0, lon: 47.0 },
  { iso2: "MH", iso3: "MHL", name: "Marshall Islands", lat: 9.0, lon: 168.0 },
  { iso2: "MK", iso3: "MKD", name: "Macedonia, the former Yugoslav Republic of", lat: 41.8333, lon: 22.0 },
  { iso2: "ML", iso3: "MLI", name: "Mali", lat: 17.0, lon: -4.0 },
  { iso2: "MM", iso3: "MMR", name: "Myanmar", lat: 22.0, lon: 98.0 },
  { iso2: "MN", iso3: "MNG", name: "Mongolia", lat: 46.0, lon: 105.0 },
  { iso2: "MO", iso3: "MAC", name: "Macao", lat: 22.1667, lon: 113.55 },
  { iso2: "MP", iso3: "MNP", name: "Northern Mariana Islands", lat: 15.2, lon: 145.75 },
  { iso2: "MQ", iso3: "MTQ", name: "Martinique", lat: 14.6667, lon: -61.0 },
  { iso2: "MR", iso3: "MRT", name: "Mauritania", lat: 20.0, lon: -12.0 },
  { iso2: "MS", iso3: "MSR", name: "Montserrat", lat: 16.75, lon: -62.2 },
  { iso2: "MT", iso3: "MLT", name: "Malta", lat: 35.8333, lon: 14.5833 },
  { iso2: "MU", iso3: "MUS", name: "Mauritius", lat: -20.2833, lon: 57.55 },
  { iso2: "MV", iso3: "MDV", name: "Maldives", lat: 3.25, lon: 73.0 },
  { iso2: "MW", iso3: "MWI", name: "Malawi", lat: -13.5, lon: 34.0 },
  { iso2: "MX", iso3: "MEX", name: "Mexico", lat: 23.0, lon: -102.0 },
  { iso2: "MY", iso3: "MYS", name: "Malaysia", lat: 2.5, lon: 112.5 },
  { iso2: "MZ", iso3: "MOZ", name: "Mozambique", lat: -18.25, lon: 35.0 },
  { iso2: "NA", iso3: "NAM", name: "Namibia", lat: -22.0, lon: 17.0 },
  { iso2: "NC", iso3: "NCL", name: "New Caledonia", lat: -21.5, lon: 165.5 },
  { iso2: "NE", iso3: "NER", name: "Niger", lat: 16.0, lon: 8.0 },
  { iso2: "NF", iso3: "NFK", name: "Norfolk Island", lat: -29.0333, lon: 167.95 },
  { iso2: "NG", iso3: "NGA", name: "Nigeria", lat: 10.0, lon: 8.0 },
  { iso2: "NI", iso3: "NIC", name: "Nicaragua", lat: 13.0, lon: -85.0 },
  { iso2: "NL", iso3: "NLD", name: "Netherlands", lat: 52.5, lon: 5.75 },
  { iso2: "NO", iso3: "NOR", name: "Norway", lat: 62.0, lon: 10.0 },
  { iso2: "NP", iso3: "NPL", name: "Nepal", lat: 28.0, lon: 84.0 },
  { iso2: "NR", iso3: "NRU", name: "Nauru", lat: -0.5333, lon: 166.9167 },
  { iso2: "NU", iso3: "NIU", name: "Niue", lat: -19.0333, lon: -169.8667 },
  { iso2: "NZ", iso3: "NZL", name: "New Zealand", lat: -41.0, lon: 174.0 },
  { iso2: "OM", iso3: "OMN", name: "Oman", lat: 21.0, lon: 57.0 },
  { iso2: "PA", iso3: "PAN", name: "Panama", lat: 9.0, lon: -80.0 },
  { iso2: "PE", iso3: "PER", name: "Peru", lat: -10.0, lon: -76.0 },
  { iso2: "PF", iso3: "PYF", name: "French Polynesia", lat: -15.0, lon: -140.0 },
  { iso2: "PG", iso3: "PNG", name: "Papua New Guinea", lat: -6.0, lon: 147.0 },
  { iso2: "PH", iso3: "PHL", name: "Philippines", lat: 13.0, lon: 122.0 },
  { iso2: "PK", iso3: "PAK", name: "Pakistan", lat: 30.0, lon: 70.0 },
  { iso2: "PL", iso3: "POL", name: "Poland", lat: 52.0, lon: 20.0 },
  { iso2: "PM", iso3: "SPM", name: "Saint Pierre and Miquelon", lat: 46.8333, lon: -56.3333 },
  { iso2: "PN", iso3: "PCN", name: "Pitcairn", lat: -24.7, lon: -127.4 },
  { iso2: "PR", iso3: "PRI", name: "Puerto Rico", lat: 18.25, lon: -66.5 },
  { iso2: "PS", iso3: "PSE", name: "Palestinian Territory, Occupied", lat: 32.0, lon: 35.25 },
  { iso2: "PT", iso3: "PRT", name: "Portugal", lat: 39.5, lon: -8.0 },
  { iso2: "PW", iso3: "PLW", name: "Palau", lat: 7.5, lon: 134.5 },
  { iso2: "PY", iso3: "PRY", name: "Paraguay", lat: -23.0, lon: -58.0 },
  { iso2: "QA", iso3: "QAT", name: "Qatar", lat: 25.5, lon: 51.25 },
  { iso2: "RE", iso3: "REU", name: "Réunion", lat: -21.1, lon: 55.6 },
  { iso2: "RO", iso3: "ROU", name: "Romania", lat: 46.0, lon: 25.0 },
  { iso2: "RS", iso3: "SRB", name: "Serbia", lat: 44.0, lon: 21.0 },
  { iso2: "RU", iso3: "RUS", name: "Russian Federation", lat: 60.0, lon: 100.0 },
  { iso2: "RW", iso3: "RWA", name: "Rwanda", lat: -2.0, lon: 30.0 },
  { iso2: "SA", iso3: "SAU", name: "Saudi Arabia", lat: 25.0, lon: 45.0 },
  { iso2: "SB", iso3: "SLB", name: "Solomon Islands", lat: -8.0, lon: 159.0 },
  { iso2: "SC", iso3: "SYC", name: "Seychelles", lat: -4.5833, lon: 55.6667 },
  { iso2: "SD", iso3: "SDN", name: "Sudan", lat: 15.0, lon: 30.0 },
  { iso2: "SE", iso3: "SWE", name: "Sweden", lat: 62.0, lon: 15.0 },
  { iso2: "SG", iso3: "SGP", name: "Singapore", lat: 1.3667, lon: 103.8 },
  { iso2: "SH", iso3: "SHN", name: "Saint Helena, Ascension and Tristan da Cunha", lat: -15.9333, lon: -5.7 },
  { iso2: "SI", iso3: "SVN", name: "Slovenia", lat: 46.0, lon: 15.0 },
  { iso2: "SJ", iso3: "SJM", name: "Svalbard and Jan Mayen", lat: 78.0, lon: 20.0 },
  { iso2: "SK", iso3: "SVK", name: "Slovakia", lat: 48.6667, lon: 19.5 },
  { iso2: "SL", iso3: "SLE", name: "Sierra Leone", lat: 8.5, lon: -11.5 },
  { iso2: "SM", iso3: "SMR", name: "San Marino", lat: 43.7667, lon: 12.4167 },
  { iso2: "SN", iso3: "SEN", name: "Senegal", lat: 14.0, lon: -14.0 },
  { iso2: "SO", iso3: "SOM", name: "Somalia", lat: 10.0, lon: 49.0 },
  { iso2: "SR", iso3: "SUR", name: "Suriname", lat: 4.0, lon: -56.0 },
  // CONFIRMED gap: no South Sudan entry at all (grep -ci "south sudan" -> 0), so
  // every South Sudan signal (conflict/displacement/food-insecurity) was silently
  // dropped from every country-aggregated layer, including the flagship Country
  // Instability Index -- see lib/signals/instability.ts. Coordinates 7°N 30°E are
  // South Sudan's Wikipedia infobox geographic coordinates (UN member since 2011).
  { iso2: "SS", iso3: "SSD", name: "South Sudan", lat: 7.0, lon: 30.0 },
  { iso2: "ST", iso3: "STP", name: "Sao Tome and Principe", lat: 1.0, lon: 7.0 },
  { iso2: "SV", iso3: "SLV", name: "El Salvador", lat: 13.8333, lon: -88.9167 },
  { iso2: "SX", iso3: "SXM", name: "Sint Maarten (Dutch part)", lat: 18.0667, lon: -63.0667 }, // Philipsburg, verified against Wikipedia's infobox coordinates
  { iso2: "SY", iso3: "SYR", name: "Syrian Arab Republic", lat: 35.0, lon: 38.0 },
  { iso2: "SZ", iso3: "SWZ", name: "Swaziland", lat: -26.5, lon: 31.5 },
  { iso2: "TC", iso3: "TCA", name: "Turks and Caicos Islands", lat: 21.75, lon: -71.5833 },
  { iso2: "TD", iso3: "TCD", name: "Chad", lat: 15.0, lon: 19.0 },
  { iso2: "TF", iso3: "ATF", name: "French Southern Territories", lat: -43.0, lon: 67.0 },
  { iso2: "TG", iso3: "TGO", name: "Togo", lat: 8.0, lon: 1.1667 },
  { iso2: "TH", iso3: "THA", name: "Thailand", lat: 15.0, lon: 100.0 },
  { iso2: "TJ", iso3: "TJK", name: "Tajikistan", lat: 39.0, lon: 71.0 },
  { iso2: "TK", iso3: "TKL", name: "Tokelau", lat: -9.0, lon: -172.0 },
  { iso2: "TL", iso3: "TLS", name: "Timor-Leste", lat: -8.55, lon: 125.5167 },
  { iso2: "TM", iso3: "TKM", name: "Turkmenistan", lat: 40.0, lon: 60.0 },
  { iso2: "TN", iso3: "TUN", name: "Tunisia", lat: 34.0, lon: 9.0 },
  { iso2: "TO", iso3: "TON", name: "Tonga", lat: -20.0, lon: -175.0 },
  { iso2: "TR", iso3: "TUR", name: "Turkey", lat: 39.0, lon: 35.0 },
  { iso2: "TT", iso3: "TTO", name: "Trinidad and Tobago", lat: 11.0, lon: -61.0 },
  { iso2: "TV", iso3: "TUV", name: "Tuvalu", lat: -8.0, lon: 178.0 },
  { iso2: "TW", iso3: "TWN", name: "Taiwan, Province of China", lat: 23.5, lon: 121.0 },
  { iso2: "TZ", iso3: "TZA", name: "Tanzania, United Republic of", lat: -6.0, lon: 35.0 },
  { iso2: "UA", iso3: "UKR", name: "Ukraine", lat: 49.0, lon: 32.0 },
  { iso2: "UG", iso3: "UGA", name: "Uganda", lat: 1.0, lon: 32.0 },
  { iso2: "UM", iso3: "UMI", name: "United States Minor Outlying Islands", lat: 19.2833, lon: 166.6 },
  { iso2: "US", iso3: "USA", name: "United States", lat: 38.0, lon: -97.0 },
  { iso2: "UY", iso3: "URY", name: "Uruguay", lat: -33.0, lon: -56.0 },
  { iso2: "UZ", iso3: "UZB", name: "Uzbekistan", lat: 41.0, lon: 64.0 },
  { iso2: "VA", iso3: "VAT", name: "Holy See (Vatican City State)", lat: 41.9, lon: 12.45 },
  { iso2: "VC", iso3: "VCT", name: "Saint Vincent and the Grenadines", lat: 13.25, lon: -61.2 },
  { iso2: "VE", iso3: "VEN", name: "Venezuela, Bolivarian Republic of", lat: 8.0, lon: -66.0 },
  { iso2: "VG", iso3: "VGB", name: "Virgin Islands, British", lat: 18.5, lon: -64.5 },
  { iso2: "VI", iso3: "VIR", name: "Virgin Islands, U.S.", lat: 18.3333, lon: -64.8333 },
  { iso2: "VN", iso3: "VNM", name: "Viet Nam", lat: 16.0, lon: 106.0 },
  { iso2: "VU", iso3: "VUT", name: "Vanuatu", lat: -16.0, lon: 167.0 },
  { iso2: "WF", iso3: "WLF", name: "Wallis and Futuna", lat: -13.3, lon: -176.2 },
  { iso2: "WS", iso3: "WSM", name: "Samoa", lat: -13.5833, lon: -172.3333 },
  // XK/XKX are not formally assigned by ISO 3166/MA (Kosovo's status is contested),
  // but XK is the widely-used exceptional reservation (EU, World Bank, SWIFT, and
  // this repo's own lib/geo/fcdoSlugs.data.ts already treat it as a resolvable
  // country code) and XKX is the de-facto ISO-3-shaped analogue used alongside it.
  // Included so upstream feeds that emit XK are not silently dropped -- not a
  // claim about recognition status either way. Coordinates verified against
  // Wikipedia's Kosovo infobox (42°35'N 21°00'E).
  { iso2: "XK", iso3: "XKX", name: "Kosovo", lat: 42.5833, lon: 21.0 },
  { iso2: "YE", iso3: "YEM", name: "Yemen", lat: 15.0, lon: 48.0 },
  { iso2: "YT", iso3: "MYT", name: "Mayotte", lat: -12.8333, lon: 45.1667 },
  { iso2: "ZA", iso3: "ZAF", name: "South Africa", lat: -29.0, lon: 24.0 },
  { iso2: "ZM", iso3: "ZMB", name: "Zambia", lat: -15.0, lon: 30.0 },
  { iso2: "ZW", iso3: "ZWE", name: "Zimbabwe", lat: -20.0, lon: 30.0 },
];

const BY_ISO2 = new Map(COUNTRY_CENTROIDS.map((c) => [c.iso2, c]));
const BY_ISO3 = new Map(COUNTRY_CENTROIDS.map((c) => [c.iso3, c]));
const BY_NAME = new Map(COUNTRY_CENTROIDS.map((c) => [c.name.toLowerCase(), c]));

/**
 * Alternate country-name spellings real upstream feeds emit that do NOT match
 * any `name` field above (this dataset mostly follows old-style ISO 3166 long
 * forms, e.g. "Libyan Arab Jamahiriya", "Korea, Republic of", "Viet Nam" --
 * upstreams routinely use the short/common form instead). A name mismatch
 * drops a country just as silently as a missing row, so `centroidByName()`
 * below checks this table before giving up. Keyed by lowercased alias -> iso3.
 *
 * Provenance matters here (see the file-level note on verifying coordinates --
 * the same discipline applies to claiming a feed emits a spelling):
 *   - libya / taiwan / west bank / gaza strip / palestine / "vietnam, republic
 *     of" were confirmed against a real 300-feature prod sample of GDELT's
 *     conflict layer on 2026-08-11 (see lib/signals/instability.ts,
 *     GDELT_NAME_ALIAS) -- reused here, not re-derived.
 *   - democratic republic of congo / republic of congo / syria / russia / iran
 *     / tanzania / bolivia / venezuela / moldova / laos / south korea / north
 *     korea / vietnam / myanmar were confirmed against ACLED's country-name
 *     spellings (see lib/signals/instability.ts, NAME_TO_ISO3 alias) -- also
 *     reused, not re-derived.
 *   - the rest are official ISO short-name renames/successors gazetted by the
 *     UN (Eswatini/Swaziland 2018, Czechia/Czech Republic, North
 *     Macedonia/Macedonia 2019, Cabo Verde/Cape Verde 2013) or unambiguous
 *     common-English names for entries whose ISO long form is awkward
 *     (Brunei, Micronesia, DRC/Congo-Kinshasa, Congo-Brazzaville, USA, UK,
 *     East Timor) -- not observed in a live feed by this pass, included
 *     defensively because the mapping is factual rather than guessed.
 */
export const COUNTRY_NAME_ALIASES: Record<string, string> = {
  libya: "LBY",
  taiwan: "TWN",
  "west bank": "PSE",
  "gaza strip": "PSE",
  palestine: "PSE",
  "palestinian territories": "PSE",
  "vietnam, republic of": "VNM",
  "democratic republic of congo": "COD",
  "democratic republic of the congo": "COD",
  "dr congo": "COD",
  "drc": "COD",
  "congo-kinshasa": "COD",
  "republic of congo": "COG",
  "congo-brazzaville": "COG",
  syria: "SYR",
  russia: "RUS",
  iran: "IRN",
  tanzania: "TZA",
  bolivia: "BOL",
  venezuela: "VEN",
  moldova: "MDA",
  laos: "LAO",
  "south korea": "KOR",
  "korea, south": "KOR",
  "north korea": "PRK",
  "korea, north": "PRK",
  vietnam: "VNM",
  myanmar: "MMR",
  burma: "MMR",
  "ivory coast": "CIV",
  czechia: "CZE",
  "north macedonia": "MKD",
  macedonia: "MKD",
  eswatini: "SWZ",
  "cabo verde": "CPV",
  "east timor": "TLS",
  brunei: "BRN",
  micronesia: "FSM",
  "united states": "USA",
  usa: "USA",
  "united kingdom": "GBR",
  uk: "GBR",
};

/** Centroid for an ISO-3166 alpha-2 code (e.g. "US"), or undefined. */
export function centroidByIso2(code: string): CountryCentroid | undefined {
  return BY_ISO2.get((code || "").toUpperCase());
}

/**
 * Centroid for a country NAME, or undefined. Tries an exact (case-insensitive)
 * match against this dataset's canonical `name` first, then falls back to
 * `COUNTRY_NAME_ALIASES` for known upstream spellings that don't match the
 * canonical form. This is the single place new alias mismatches should be
 * added -- see the provenance note on `COUNTRY_NAME_ALIASES` above.
 */
export function centroidByName(name: string): CountryCentroid | undefined {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return undefined;
  const exact = BY_NAME.get(n);
  if (exact) return exact;
  const alias = COUNTRY_NAME_ALIASES[n];
  return alias ? BY_ISO3.get(alias) : undefined;
}

/** Centroid for an ISO-3166 alpha-3 code (e.g. "AFG"), or undefined. */
export function centroidByIso3(code: string): CountryCentroid | undefined {
  return BY_ISO3.get((code || "").toUpperCase());
}
