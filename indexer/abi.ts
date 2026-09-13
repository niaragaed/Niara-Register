// ABIs mínimas (só os eventos que o Register precisa indexar), extraídas diretamente
// de niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol. Ver aquele repositório
// como fonte da verdade — se os contratos mudarem, atualizar aqui também.

export const OFERTA_CAPTACAO_ABI = [
  "event Aporte(address indexed investidor, uint256 valor, uint256 totalArrecadadoAtual)",
  "event OfertaEncerrada(uint8 resultado, uint256 totalArrecadado)",
  "event OfertaCancelada()",
  "event CotasResgatadas(address indexed investidor, uint256 cotas)",
  "event RecursosLiberados(address indexed emissorWallet, uint256 valorEmissor, address indexed protocoloWallet, uint256 taxa)",
  "event Reembolso(address indexed investidor, uint256 valor)",
];

// enum Estado { Aberta, EncerradaSucesso, EncerradaFalha } — em OfertaCaptacao.sol
export const ESTADO_LABELS = ["Aberta", "EncerradaSucesso", "EncerradaFalha"] as const;

// De niaragaed/niara-contracts-Register, src/registro/RegistroAssinaturas.sol
export const REGISTRO_ASSINATURAS_ABI = [
  "event DocumentoRegistrado(bytes32 indexed hashDocumento, address indexed assinante, string nomeDocumento, string tipoDocumento, uint256 timestamp)",
];
