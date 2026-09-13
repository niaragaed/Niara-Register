// Endereço e ABI do RegistroAssinaturas — deployado de verdade na Sepolia.
// Endereço de contrato é informação pública (qualquer um confere no
// Etherscan), então não há necessidade de tratar como segredo nem de
// variável de ambiente — mas se o contrato for redeployado no futuro,
// atualizar só este arquivo.
// Fonte: niaragaed/niara-contracts-Register, script/DeployRegistro.s.sol
export const ENDERECO_REGISTRO_ASSINATURAS =
  "0x5627857ee73f37d6da96530ed08c07339dd9d93a" as const;

export const REGISTRO_ASSINATURAS_ABI = [
  "function registrar(bytes32 hashDocumento, string nomeDocumento, string tipoDocumento) external",
  "function verificar(bytes32 hashDocumento) external view returns (bool existe, address assinante, uint256 timestamp, string nomeDocumento, string tipoDocumento)",
  "event DocumentoRegistrado(bytes32 indexed hashDocumento, address indexed assinante, string nomeDocumento, string tipoDocumento, uint256 timestamp)",
  "error DocumentoJaRegistrado(bytes32 hashDocumento)",
  "error HashInvalido()",
] as const;

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111 em hex
