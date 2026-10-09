// Cliente mínimo do programa Niara-Register na Solana (niara-register-solana).
//
// Mesma semântica do RegistroAssinaturas.sol (Sepolia): hash SHA-256 +
// assinante + timestamp + nome/tipo, um registro por hash, imutável.
//
// Sem o client do Anchor no navegador de propósito: a instrução e a conta são
// pequenas o bastante para codificar à mão, e isso evita polyfills de Node
// (Buffer etc.) no bundle do Next. Os discriminadores abaixo vêm do IDL gerado
// por `anchor build` (target/idl/niara_register_solana.json) — se o programa
// mudar de assinatura, atualizar aqui.
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/** Endereço público do programa (informação pública, como o do contrato EVM). */
export const ID_PROGRAMA_SOLANA = new PublicKey(
  "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR",
);

export const CLUSTER_SOLANA = "devnet" as const;

export const RPC_SOLANA =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/** Limites em bytes UTF-8, iguais aos do programa (constants.rs). */
export const MAX_NOME_BYTES = 128;
export const MAX_TIPO_BYTES = 32;

const SEED_ASSINATURA = new TextEncoder().encode("assinatura");
const DISC_REGISTRAR = Uint8Array.from([52, 163, 233, 194, 164, 203, 200, 64]);
const DISC_CONTA_ASSINATURA = Uint8Array.from([
  68, 120, 123, 196, 84, 89, 85, 188,
]);

/** Códigos de erro customizados do programa (error.rs, base 6000 do Anchor). */
export const ERROS_PROGRAMA = {
  6000: "HashInvalido",
  6001: "NomeInvalido",
  6002: "TipoInvalido",
} as const;

export type RegistroSolana = {
  assinante: string;
  timestamp: number;
  slot: number;
  nomeDocumento: string;
  tipoDocumento: string;
};

export function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

function hexParaBytes(hex: string): Uint8Array {
  const limpo = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(limpo)) {
    throw new Error("Hash SHA-256 inválido (esperado 64 caracteres hex).");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(limpo.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** PDA ["assinatura", hash]: um endereço — e portanto um registro — por documento. */
export function enderecoDoRegistro(hashHex: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED_ASSINATURA, hexParaBytes(hashHex)],
    ID_PROGRAMA_SOLANA,
  )[0];
}

export function conexaoSolana(): Connection {
  return new Connection(RPC_SOLANA, "confirmed");
}

// --- codificação Borsh (só o que este programa usa) -----------------------

function stringBorsh(texto: string): Uint8Array {
  const corpo = new TextEncoder().encode(texto);
  const saida = new Uint8Array(4 + corpo.length);
  new DataView(saida.buffer).setUint32(0, corpo.length, true);
  saida.set(corpo, 4);
  return saida;
}

function concatenar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

export function instrucaoRegistrar(
  assinante: PublicKey,
  hashHex: string,
  nomeDocumento: string,
  tipoDocumento: string,
): TransactionInstruction {
  const hash = hexParaBytes(hashHex);
  const data = concatenar(
    DISC_REGISTRAR,
    hash,
    stringBorsh(nomeDocumento),
    stringBorsh(tipoDocumento),
  );

  return new TransactionInstruction({
    programId: ID_PROGRAMA_SOLANA,
    keys: [
      { pubkey: assinante, isSigner: true, isWritable: true },
      { pubkey: enderecoDoRegistro(hashHex), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // web3.js v1 tipa `data` como Buffer, mas só lê os bytes — Uint8Array basta.
    data: data as unknown as TransactionInstruction["data"],
  });
}

/**
 * Lê o registro de um hash direto da conta on-chain. Não precisa de carteira:
 * qualquer pessoa verifica um documento só com o arquivo em mãos.
 */
export async function buscarRegistroSolana(
  conexao: Connection,
  hashHex: string,
): Promise<RegistroSolana | null> {
  const conta = await conexao.getAccountInfo(enderecoDoRegistro(hashHex));
  if (!conta) return null;
  if (!conta.owner.equals(ID_PROGRAMA_SOLANA)) return null;

  const dados = Uint8Array.from(conta.data);
  for (let i = 0; i < 8; i++) {
    if (dados[i] !== DISC_CONTA_ASSINATURA[i]) return null;
  }

  const visao = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  const decodificador = new TextDecoder();
  let pos = 8;

  const assinante = new PublicKey(dados.slice(pos, pos + 32)).toBase58();
  pos += 32;
  pos += 32; // hash_documento (já sabemos qual é)
  const timestamp = Number(visao.getBigInt64(pos, true));
  pos += 8;
  const slot = Number(visao.getBigUint64(pos, true));
  pos += 8;

  const lerString = () => {
    const tamanho = visao.getUint32(pos, true);
    pos += 4;
    const texto = decodificador.decode(dados.slice(pos, pos + tamanho));
    pos += tamanho;
    return texto;
  };
  const nomeDocumento = lerString();
  const tipoDocumento = lerString();

  return { assinante, timestamp, slot, nomeDocumento, tipoDocumento };
}

export function linkExplorerSolana(
  tipo: "tx" | "address",
  valor: string,
): string {
  return `https://explorer.solana.com/${tipo}/${valor}?cluster=${CLUSTER_SOLANA}`;
}

/** Traduz falhas do programa para algo que a UI consegue tratar. */
export function motivoErroSolana(erro: unknown): string | null {
  const texto =
    erro instanceof Error
      ? `${erro.message} ${JSON.stringify((erro as { logs?: unknown }).logs ?? "")}`
      : String(erro);
  if (texto.includes("already in use")) return "DocumentoJaRegistrado";
  const custom = texto.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const codigo = parseInt(custom[1], 16) as keyof typeof ERROS_PROGRAMA;
    return ERROS_PROGRAMA[codigo] ?? null;
  }
  for (const nome of Object.values(ERROS_PROGRAMA)) {
    if (texto.includes(nome)) return nome;
  }
  return null;
}
