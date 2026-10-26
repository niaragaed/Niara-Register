// Minimal ABIs (only the events the Register needs to index), taken directly
// from niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol. That repository is
// the source of truth: if the contracts change, update here too. Event, field
// and contract names are on-chain names and stay as deployed.

export const OFERTA_CAPTACAO_ABI = [
  "event Aporte(address indexed investidor, uint256 valor, uint256 totalArrecadadoAtual)",
  "event OfertaEncerrada(uint8 resultado, uint256 totalArrecadado)",
  "event OfertaCancelada()",
  "event CotasResgatadas(address indexed investidor, uint256 cotas)",
  "event RecursosLiberados(address indexed emissorWallet, uint256 valorEmissor, address indexed protocoloWallet, uint256 taxa)",
  "event Reembolso(address indexed investidor, uint256 valor)",
];

// enum Estado { Aberta, EncerradaSucesso, EncerradaFalha } in OfertaCaptacao.sol
export const STATE_LABELS = ["Aberta", "EncerradaSucesso", "EncerradaFalha"] as const;

// From niaragaed/niara-contracts-Register, src/registro/RegistroAssinaturas.sol
export const REGISTRO_ASSINATURAS_ABI = [
  "event DocumentoRegistrado(bytes32 indexed hashDocumento, address indexed assinante, string nomeDocumento, string tipoDocumento, uint256 timestamp)",
];

// From niara-contracts-PMEs, src/orquestracao/OfertaOrquestrador.sol. Only the
// creation event: the others (allowlist, timelock) do not become ledger rows.
export const OFERTA_ORQUESTRADOR_ABI = [
  "event OfertaCompletaCriada(address indexed emissor, address indexed token, address indexed oferta, uint256 metaMinima, uint256 metaMaxima, uint256 precoPorCota, uint256 prazo)",
];

// From niaragaed/niara-contracts-Register, src/v2/SignatureRegistryV2.sol (events only).
export const SIGNATURE_REGISTRY_V2_ABI = [
  "event DocumentRegistered(bytes32 indexed recordHash, address indexed signer, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, uint256 timestamp)",
];

// From niaragaed/niara-contracts-Register, src/v3/SignatureRegistryV3.sol (events only).
// Same event name as v2 with one more field, so a different topic.
export const SIGNATURE_REGISTRY_V3_ABI = [
  "event DocumentRegistered(bytes32 indexed recordHash, address indexed signer, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, bytes32 orbReportHash, uint256 timestamp)",
];

// From niaragaed/niara-contracts-Register, src/mletr/TransferableRecordRegistry.sol (events only).
export const TRANSFERABLE_RECORD_ABI = [
  "event RecordIssued(uint256 indexed tokenId, address indexed issuer, address indexed holder, bytes32 documentHash, bytes32 metadataCommitment)",
  "event AmendmentProposed(uint256 indexed tokenId, bytes32 newDocumentHash, bytes32 newMetadataCommitment)",
  "event AmendmentCancelled(uint256 indexed tokenId)",
  "event RecordAmended(uint256 indexed tokenId, uint32 version, bytes32 documentHash, bytes32 metadataCommitment)",
  "event RecordSurrendered(uint256 indexed tokenId, address indexed by)",
  "event RecordTerminated(uint256 indexed tokenId, uint8 reason)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];
