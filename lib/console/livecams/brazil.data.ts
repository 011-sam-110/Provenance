/**
 * Brazilian live-camera channels on YouTube.
 *
 * WHY CHANNELS AND NOT STREAMS. A video id is not a durable handle — see
 * lib/youtube/live.ts for the measurements. A channel id is. These 32 channels
 * were carrying 100 live Brazilian streams between them when this file was
 * written (2026-08-14); the board resolves a channel's CURRENT streams at view
 * time rather than pinning any of them.
 *
 * WHY THERE IS NO place / city / category FIELD HERE. There was, and it was
 * wrong often enough to delete. Deriving location and category from stream
 * titles produced: a Cubatão train labelled "Natal" (1,800 km out), an
 * "Av. Curitiba" in Goioerê read as the city of Curitiba, a Chapecó airport
 * filed under Roads, and "Balneário Camboriú - CÂMERA do tempo" mangled into
 * "do tempo". Rather than ship ~100 machine-written labels at that error rate,
 * the board shows each broadcaster's OWN title, verbatim. Their words are always
 * accurate about their own camera; mine were not.
 *
 * HOW THIS LIST WAS CURATED. Discovered with yt-dlp (20 Portuguese-language
 * searches, then every candidate channel's /streams tab enumerated), filtered to
 * Brazilian place names, then read by hand. Five channels were removed at that
 * last step and they are the reason the hand step is not optional:
 *
 *   Wolkam IT       — Vitoria-GASTEIZ, SPAIN. Matched the Brazilian "Vitória"
 *                     on the name alone.
 *   Gutti Show      — IRL phone stream, not a fixed camera
 *   Olhar Urbano    — IRL phone stream, dated title, gone tomorrow
 *   Biel Turismo    — IRL phone stream, dated title
 *   Edson IRL Brasil— IRL phone stream
 *
 * `seedVideoId` is a last-known live video, used only when resolution is dormant
 * (no YOUTUBE_API_KEY). It WILL rot — that is the entire premise of this
 * feature — so it is a fallback, never the source of truth.
 *
 * To re-verify a channel:
 *   yt-dlp --flat-playlist -J "https://www.youtube.com/channel/<channelId>/streams"
 */
export interface BrazilCamChannel {
  id: string;
  /** The broadcaster's own channel name — not a label we invented. */
  name: string;
  channelId: string;
  /** Last-known live video, for the dormant fallback only. Expected to rot. */
  seedVideoId: string;
  /** Live streams this channel was carrying when the list was captured. */
  knownStreams: number;
}

export const BRAZIL_CAM_CHANNELS: BrazilCamChannel[] = [
  { id: "br-t5yt3goz", name: "Barra da Lagoa Online", channelId: "UCt5YT3gOz4HXJcPTC_tce-A", seedVideoId: "1k0c7CxKU5g", knownStreams: 1 },
  { id: "br-qnrfonvl", name: "BNU.tv", channelId: "UCQnRFONVlt96xf5lYVr4Tzg", seedVideoId: "0nJHcJ8ELrM", knownStreams: 2 },
  { id: "br-fgipvn1d", name: "Camera Aeroporto Porto Alegre BrAmigos", channelId: "UCFGIPvN1dMn4Bdo8B8WWPDw", seedVideoId: "IdAvz5TD6Wc", knownStreams: 2 },
  { id: "br-zki8jovv", name: "chumbinho.aviacao.nasnuvens", channelId: "UCzki8JOvVr95qFXmY-pbOqw", seedVideoId: "wf2Eiq6e80M", knownStreams: 1 },
  { id: "br-i1vqx48j", name: "CLIMA BC Brazil", channelId: "UCi1vQx48j_nfrMg6XH5PItQ", seedVideoId: "TjI12t1uU6M", knownStreams: 6 },
  { id: "br-37r9r29m", name: "ConexãoDCTV - Oficial", channelId: "UC37R9R29MAwvrOBafYoBtow", seedVideoId: "1UtQUMxH6oc", knownStreams: 6 },
  { id: "br-qi8nu3-d", name: "Câmeras ao Vivo RS - Pôr do Sol Guaíba", channelId: "UCqI8nU3-dstxAS3YCXhKuPg", seedVideoId: "D5VLbXaqZfg", knownStreams: 2 },
  { id: "br-lt4xisai", name: "Farol Da Bahia", channelId: "UCLt4xIsAiZuLnVdZgcpxPAw", seedVideoId: "vjuviTl7zkA", knownStreams: 1 },
  { id: "br-0t38ezzt", name: "Filipe Serena", channelId: "UC0T38EzZthvvGk8cf98GaXA", seedVideoId: "slsKpIYENGg", knownStreams: 1 },
  { id: "br-tnycgipu", name: "FVF Drone 2", channelId: "UCTnYcgIpurN_1Wy-NGARTbg", seedVideoId: "2rc0k9ghgOQ", knownStreams: 6 },
  { id: "br-nrkceezy", name: "FVF DRONE LIVES 24H", channelId: "UCNrkCeEzYg79oHO2_5VRDMw", seedVideoId: "8quWDK9i-v0", knownStreams: 7 },
  { id: "br-4roe4sbv", name: "Guia Turístico de Praia Grande", channelId: "UC4roE4SbVIvcQGCYXlnijGQ", seedVideoId: "wNXOI0pmz7I", knownStreams: 5 },
  { id: "br-hwgykk0i", name: "Homes in Rio", channelId: "UChWGYkK0I8U83C0FxAxWy4w", seedVideoId: "14QUwx-ZRd0", knownStreams: 2 },
  { id: "br-fmoswhx9", name: "Live Rio", channelId: "UCfMOswhx9NN_laZ8Ukcm4-Q", seedVideoId: "vXgKLmbzSgU", knownStreams: 6 },
  { id: "br-trwk-doz", name: "Maaxcam Ao Vivo", channelId: "UCtrwK-DOZGcQo9p1VwIkDZw", seedVideoId: "Kr34rd9VWHE", knownStreams: 8 },
  { id: "br-8yaup2vi", name: "Marcelo Praia Grande e Região", channelId: "UC8YAup2viRbegzrqjAyEXYA", seedVideoId: "_kgpVicqJOo", knownStreams: 2 },
  { id: "br-hhtdcqzw", name: "Olhar 013", channelId: "UCHhtdcqzwyPYY0qBlEPh0QQ", seedVideoId: "gmc9ryoJ-vs", knownStreams: 1 },
  { id: "br--erixslt", name: "Ouro Verde FM Easy", channelId: "UC-ErIXslTvIsRHxmMcc9itg", seedVideoId: "lTPWpnic8ow", knownStreams: 1 },
  { id: "br-dz_kbzu8", name: "Papa Charlie Golf TV", channelId: "UCdz_Kbzu83ZE86LVcGFN0JA", seedVideoId: "Ae08ZGn4OcA", knownStreams: 2 },
  { id: "br-htfpxxmi", name: "Pernambuco Fishing", channelId: "UChtFpXxMI8UpJ1P33sw_W_w", seedVideoId: "1bSc965aq70", knownStreams: 1 },
  { id: "br-blhvdpcp", name: "Point do Forte", channelId: "UCBLHvdpCPy8J1acuXWu82tA", seedVideoId: "WULBz__uPzg", knownStreams: 2 },
  { id: "br-6hcr5rrz", name: "Pontal NeTv e Internet", channelId: "UC6hcr5RRZvTtSfsNJ2MLj2Q", seedVideoId: "9uccePeQQK4", knownStreams: 1 },
  { id: "br-zwtw6vgc", name: "Portal Chapecó", channelId: "UCzwTW6vgC7RcmxssUrGZnwA", seedVideoId: "i2KUyICHyOY", knownStreams: 3 },
  { id: "br-yunmstqx", name: "Porto Alegre Skyline - Câmera no Centro Histórico", channelId: "UCYUNMStQx5hZTi7oIRXtHGw", seedVideoId: "ig7mClmrsL4", knownStreams: 1 },
  { id: "br--5cvlxn0", name: "Praticagem de São Paulo - Canal Oficial", channelId: "UC-5CVLXN0tBhGsqv-DMcHuw", seedVideoId: "ZvTdzjwPGA0", knownStreams: 2 },
  { id: "br-nzckdhav", name: "SBGR LIVE", channelId: "UCNZCKDhAVtbh7sddChTxI7w", seedVideoId: "ixxHcBHvDaU", knownStreams: 1 },
  { id: "br-yp308hb2", name: "SE-CONNECT", channelId: "UCyP308hB27ZZsRbvnDLpWbw", seedVideoId: "vWXTuYO48QA", knownStreams: 8 },
  { id: "br-gjaquevw", name: "Surfistafotografo", channelId: "UCGJaqUeVWMrxawXUhCK2wPw", seedVideoId: "xtTSysda5fc", knownStreams: 6 },
  { id: "br-eo1c8wzu", name: "TARTADRONE", channelId: "UCeo1c8wZUrwt4L7E1Q9yxdQ", seedVideoId: "t2Sbj4Cd2SI", knownStreams: 2 },
  { id: "br-2ll1rrh9", name: "TRAIN CAM", channelId: "UC2LL1Rrh9mXbaII5mT-nN0g", seedVideoId: "6HF6sqHk_Fg", knownStreams: 2 },
  { id: "br-ak21edmz", name: "TRANSMISSÃO AO VIVO CIDADE", channelId: "UCak21Edmz9LDZ_3-bl3TNyA", seedVideoId: "zKsgtmgGHt4", knownStreams: 1 },
  { id: "br-vqg1pbkr", name: "UBACAM", channelId: "UCVQG1pBkRM4xlRrBmV65kUw", seedVideoId: "ye7wWfbktQw", knownStreams: 8 },
];
