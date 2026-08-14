/**
 * CET São Paulo — the 11 cameras the city publishes to the public web viewer.
 *
 * Hand-verified 2026-08-14. The list itself is the `gCams` array inlined in
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
  // pasta 22 has been serving the same JPEG since 25 Feb 2026 (169 days old at
  // verification). It is kept because CET still registers it: the freshness check
  // in cetsp.ts marks it unavailable rather than this file deleting it, so the
  // coverage denominator stays honest instead of quietly shrinking.
  { pasta: 22, lat: -23.55804, lon: -46.66004, name: "Paulista x Metrô Consolação (R Augusta)", local: "PAULISTA, AV x AUGUSTA, R" },
  { pasta: 23, lat: -23.56767, lon: -46.64921, name: "Paulista x Av Brigadeiro Luiz Antônio", local: "PAULISTA, AV x LUIS ANTONIO, AV BRIG x MANUEL DA NOBREGA" },
  { pasta: 180, lat: -23.54767, lon: -46.64894, name: "Consolação x R Caio Prado", local: "CONSOLACAO, R DA x CAIO PRADO, R" },
  { pasta: 184, lat: -23.57919, lon: -46.66156, name: "Brasil x Av Brig Luis Antônio (Pr Armando S Oliveira)", local: "LUIS ANTONIO, AV BRIG x BRASIL, AV" },
  { pasta: 195, lat: -23.56432, lon: -46.67785, name: "Brasil x Av Henrique Schaumann (Av Rebouças)", local: "REBOUCAS, AV x BRASIL, AV x HENRIQUE SCHAUMANN, AV" },
  { pasta: 200, lat: -23.58222, lon: -46.68373, name: "Iguatemi x Av Brig Faria Lima (R Jerônimo da Veiga)", local: "FARIA LIMA, AV BRIG x IGUATEMI, R x JERÔNIMO DA VEIGA, R" },
  { pasta: 210, lat: -23.56859, lon: -46.64974, name: "Brig Luis Antônio x Al Santos", local: "LUIS ANTONIO, AV BRIG x SANTOS, AL" },
  { pasta: 220, lat: -23.58028, lon: -46.6833, name: "Cidade Jardim x Av Nove de Julho (Túnel Máx Feffer)", local: "NOVE DE JULHO, AV x CIDADE JARDIM, AV" },
  { pasta: 222, lat: -23.59738, lon: -46.66788, name: "Hélio Pellegrino x R Diogo Jácome", local: "HÉLIO PELLEGRINO, AV x DIOGO JACOME, R" },
  { pasta: 224, lat: -23.59365, lon: -46.65257, name: "Ibirapuera x R Ipê", local: "IBIRAPUERA, AV x IPÊ, R" },
  { pasta: 225, lat: -23.59765, lon: -46.65113, name: "Ascendino Reis x R Pedro de Toledo", local: "ASCENDINO REIS, AV PROF x PEDRO DE TOLEDO, R" },
];
