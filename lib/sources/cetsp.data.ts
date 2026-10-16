/**
 * CET São Paulo — the 15 cameras the city publishes to the public web viewer.
 *
 * Hand-verified 2026-08-14; refreshed 2026-10-16. On the refresh CET's own list had
 * 16 cameras: pasta 22 had left it (its JPEG unchanged since 25 Feb 2026), so its row
 * is gone; five live ones were new (15, 31, 57, 164, 234) and are added below; and
 * pasta 16 (Shopping Paulista) is listed but its JPEG has not changed since 29 Nov
 * 2024, so it is left out. The list itself is the `gCams` array inlined in
 * https://cameras.cetsp.com.br/View/Cam.aspx (fields: pasta, titulo, subTitulo,
 * detalhe). CET publishes NO coordinates there, so `lat`/`lon` were resolved
 * offline against the `sqlProducao:CamerasCentral` layer (615 rows, EPSG:4326)
 * on CET's GeoServer and committed here.
 *
 * WHY A COMMITTED TABLE RATHER THAN A RUNTIME LOOKUP:
 *
 *   1. That GeoServer is `cet-inf7242.cetsp.com.br:8080` — no TLS, port 8080, an
 *      internal-looking hostname that merely happens to be reachable. It is not a
 *      published open-data product and this adapter must not depend on it in
 *      production. It was a research tool, used once.
 *   2. Matching camera titles to intersection strings is not reliable enough to
 *      do unattended. Token-matching resolved 9 of these 11 cleanly and got two
 *      WRONG on a single shared token — `Ibirapuera × R Ipê` matched a
 *      Bandeirantes intersection, and `Paulista × Av Brig Luiz Antônio` matched
 *      something in Tucuruvi, 12 km north. Both were then resolved by hand and
 *      cross-checked against the `vwCamerasWeb` layer where it carried geometry.
 *
 * `local` records the CamerasCentral row each coordinate came from, so a future
 * re-verification can check the provenance rather than re-deriving it.
 *
 * To re-verify a row:
 *   curl -sI https://cameras.cetsp.com.br/cams/{pasta}/1.jpg   # Last-Modified
 */
export interface CetspCamera {
  /** CET's own folder id — the only stable key, and the image path segment. */
  pasta: number;
  lat: number;
  lon: number;
  /** Human label, assembled from gCams titulo/subTitulo/detalhe. */
  name: string;
  /** The CamerasCentral intersection this coordinate was taken from. */
  local: string;
}

export const CETSP_CAMERAS: CetspCamera[] = [
  { pasta: 23, lat: -23.56767, lon: -46.64921, name: "Paulista x Av Brigadeiro Luiz Antônio", local: "PAULISTA, AV x LUIS ANTONIO, AV BRIG x MANUEL DA NOBREGA" },
  { pasta: 180, lat: -23.54767, lon: -46.64894, name: "Consolação x R Caio Prado", local: "CONSOLACAO, R DA x CAIO PRADO, R" },
  { pasta: 184, lat: -23.57919, lon: -46.66156, name: "Brasil x Av Brig Luis Antônio (Pr Armando S Oliveira)", local: "LUIS ANTONIO, AV BRIG x BRASIL, AV" },
  { pasta: 195, lat: -23.56432, lon: -46.67785, name: "Brasil x Av Henrique Schaumann (Av Rebouças)", local: "REBOUCAS, AV x BRASIL, AV x HENRIQUE SCHAUMANN, AV" },
  { pasta: 200, lat: -23.58222, lon: -46.68373, name: "Iguatemi x Av Brig Faria Lima (R Jerônimo da Veiga)", local: "FARIA LIMA, AV BRIG x IGUATEMI, R x JERÔNIMO DA VEIGA, R" },
  { pasta: 210, lat: -23.56859, lon: -46.64974, name: "Brig Luis Antônio x Al Santos", local: "LUIS ANTONIO, AV BRIG x SANTOS, AL" },
  { pasta: 220, lat: -23.58028, lon: -46.6833, name: "Cidade Jardim x Av Nove de Julho (Túnel Máx Feffer)", local: "NOVE DE JULHO, AV x CIDADE JARDIM, AV" },
  { pasta: 222, lat: -23.59738, lon: -46.66788, name: "Hélio Pellegrino x R Diogo Jácome", local: "HÉLIO PELLEGRINO, AV x DIOGO JACOME, R" },
  { pasta: 224, lat: -23.59365, lon: -46.65257, name: "Ibirapuera x R Ipê", local: "IBIRAPUERA, AV x IPÊ, R" },
  // Added 2026-10-16. Four coordinates are CamerasCentral rows, as above. 164 has
  // no CamerasCentral row at its junction, so it is the OSM traffic-signal node
  // 1953466354 where Av Paulista meets R Peixoto Gomide, beside MASP.
  { pasta: 15, lat: -23.55587, lon: -46.6629, name: "Paulista x Metrô Paulista (R da Consolação, Pr do Ciclista)", local: "PAULISTA, AV. x CONSOLAÇÃO, R. DA" },
  { pasta: 31, lat: -23.5904, lon: -46.68142, name: "Juscelino Kubitschek x Av Brig Faria Lima", local: "FARIA LIMA, AV x JUSCELINO KUBITSCHEK, AV PRES" },
  { pasta: 57, lat: -23.57391, lon: -46.63938, name: "Paraíso x R Apeninos", local: "PARAISO, R DO x APENINOS, R" },
  { pasta: 164, lat: -23.56095, lon: -46.65715, name: "MASP x Av Paulista (R Peixoto Gomide)", local: "OSM node 1953466354 (Avenida Paulista x Rua Peixoto Gomide)" },
  { pasta: 234, lat: -23.57208, lon: -46.64537, name: "Cubatão x Al Santos (R Rafael de Barros)", local: "SANTOS, AL x CUBATAO, R x RAFAEL DE BARROS, R DR" },
  { pasta: 225, lat: -23.59765, lon: -46.65113, name: "Ascendino Reis x R Pedro de Toledo", local: "ASCENDINO REIS, AV PROF x PEDRO DE TOLEDO, R" },
];
