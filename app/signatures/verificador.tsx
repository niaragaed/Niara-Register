"use client";

import { useState } from "react";
import { BrowserProvider, Contract, hexlify } from "ethers";
import { Transaction } from "@solana/web3.js";
import {
  MAX_NOME_BYTES,
  MAX_TIPO_BYTES,
  buscarRegistroSolana,
  bytesUtf8,
  conexaoSolana,
  instrucaoRegistrar,
  linkExplorerSolana,
  motivoErroSolana,
} from "@/lib/registro-solana";
import type { ProviderSolana } from "@/lib/solana";
import {
  REDES_EVM,
  REGISTRO_ASSINATURAS_ABI,
  linkTxEvm,
  type RedeEvm,
} from "@/lib/registro-contract";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatarTimestamp } from "@/lib/i18n/formato";
import type { Locale } from "@/lib/i18n/locale";

type TextosVerificador = Dictionary["verificador"];

type Rede = RedeEvm | "solana";

type Etapa =
  | "idle"
  | "calculando"
  | "pronto"
  | "conectando"
  | "verificando"
  | "ja_registrado"
  | "assinando"
  | "confirmado"
  | "erro";

type RegistroExistente = {
  assinante: string;
  timestamp: number;
  nomeDocumento: string;
  tipoDocumento: string;
};

async function calcularSha256(arquivo: File): Promise<string> {
  const buffer = await arquivo.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

function providerSolana(): ProviderSolana | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

async function garantirRedeEvm(
  ethereum: NonNullable<typeof window.ethereum>,
  rede: RedeEvm,
) {
  const cfg = REDES_EVM[rede];
  const chainIdAtual = await ethereum.request({ method: "eth_chainId" });
  if (String(chainIdAtual).toLowerCase() === cfg.chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.chainIdHex }],
    });
  } catch (erro: unknown) {
    // 4902 = a carteira não conhece essa rede ainda, precisa adicionar
    const codigo = (erro as { code?: number })?.code;
    if (codigo === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.chainName,
            nativeCurrency: { name: `${cfg.chainName} ETH`, symbol: "ETH", decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
            blockExplorerUrls: [cfg.explorer],
          },
        ],
      });
    } else {
      throw erro;
    }
  }
}

export function VerificadorDeDocumento({
  t,
  locale,
}: {
  t: TextosVerificador;
  locale: Locale;
}) {
  const [hash, setHash] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [nomeDocumento, setNomeDocumento] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("");
  const [etapa, setEtapa] = useState<Etapa>("idle");
  const [rede, setRede] = useState<Rede>("sepolia");
  const [verificadoSemRegistro, setVerificadoSemRegistro] = useState(false);
  const [enderecoCarteira, setEnderecoCarteira] = useState<string | null>(null);
  const [registroExistente, setRegistroExistente] = useState<RegistroExistente | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  async function aoSelecionarArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setEtapa("calculando");
    setNomeArquivo(arquivo.name);
    setRegistroExistente(null);
    setVerificadoSemRegistro(false);
    setTxHash(null);
    setMensagemErro(null);
    const digest = await calcularSha256(arquivo);
    setHash(digest);
    setEtapa("pronto");
  }

  function trocarRede(nova: Rede) {
    if (nova === rede) return;
    setRede(nova);
    // Carteira, resultado de verificação e tx são por rede; hash e campos
    // do formulário continuam valendo.
    setEnderecoCarteira(null);
    setRegistroExistente(null);
    setVerificadoSemRegistro(false);
    setTxHash(null);
    setMensagemErro(null);
    if (hash) setEtapa("pronto");
  }

  async function conectarEVerificarSolana() {
    if (!hash) return;
    const provider = providerSolana();
    if (!provider) {
      setMensagemErro(t.semCarteiraSolana);
      setEtapa("erro");
      return;
    }

    try {
      setEtapa("conectando");
      const { publicKey } = await provider.connect();
      setEnderecoCarteira(publicKey.toBase58());

      setEtapa("verificando");
      const registro = await buscarRegistroSolana(conexaoSolana(), hash);
      if (registro) {
        setRegistroExistente(registro);
        setEtapa("ja_registrado");
      } else {
        setVerificadoSemRegistro(true);
        setEtapa("pronto");
      }
    } catch (erro) {
      // A Phantom devolve só "Unexpected error" quando está bloqueada ou ainda
      // sem carteira criada; 4001 é recusa explícita do usuário.
      console.error(erro);
      const codigo = (erro as { code?: number })?.code;
      setMensagemErro(codigo === 4001 ? t.conexaoRecusada : t.erroPhantom);
      setEtapa("erro");
    }
  }

  async function assinarERegistrarSolana() {
    const provider = providerSolana();
    if (!hash || !provider?.publicKey) return;

    try {
      setEtapa("assinando");
      setMensagemErro(null);

      const conexao = conexaoSolana();
      const { blockhash, lastValidBlockHeight } =
        await conexao.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: provider.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        instrucaoRegistrar(
          provider.publicKey,
          hash,
          nomeDocumento.trim(),
          tipoDocumento.trim(),
        ),
      );

      // Assina na carteira e envia pelo nosso RPC de devnet: assim a
      // transação vai para a devnet mesmo que a carteira esteja em outra rede.
      const assinada = await provider.signTransaction(tx);
      const assinatura = await conexao.sendRawTransaction(assinada.serialize());
      const resultado = await conexao.confirmTransaction(
        { signature: assinatura, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (resultado.value.err) {
        throw new Error(JSON.stringify(resultado.value.err));
      }

      setTxHash(assinatura);
      setEtapa("confirmado");
    } catch (erro) {
      console.error(erro);
      const motivo = motivoErroSolana(erro);
      setMensagemErro(
        motivo === "DocumentoJaRegistrado"
          ? t.erroJaRegistrado
          : motivo === "NomeInvalido" || motivo === "TipoInvalido"
            ? t.limiteSolana
            : erro instanceof Error
              ? erro.message
              : t.erroRegistro,
      );
      setEtapa("erro");
    }
  }

  async function conectarEVerificar() {
    if (rede === "solana") return conectarEVerificarSolana();
    if (!hash) return;
    if (!window.ethereum) {
      setMensagemErro(t.semCarteira);
      setEtapa("erro");
      return;
    }

    try {
      setEtapa("conectando");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await garantirRedeEvm(window.ethereum, rede);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const endereco = await signer.getAddress();
      setEnderecoCarteira(endereco);

      setEtapa("verificando");
      const contrato = new Contract(
        REDES_EVM[rede].endereco,
        REGISTRO_ASSINATURAS_ABI,
        provider,
      );
      const hashBytes32 = hexlify(`0x${hash}`);
      const [existe, assinante, timestamp, nomeExistente, tipoExistente] =
        await contrato.verificar(hashBytes32);

      if (existe) {
        setRegistroExistente({
          assinante,
          timestamp: Number(timestamp),
          nomeDocumento: nomeExistente,
          tipoDocumento: tipoExistente,
        });
        setEtapa("ja_registrado");
      } else {
        setVerificadoSemRegistro(true);
        setEtapa("pronto");
      }
    } catch (erro) {
      console.error(erro);
      setMensagemErro(erro instanceof Error ? erro.message : t.erroConexao);
      setEtapa("erro");
    }
  }

  async function assinarERegistrar() {
    if (rede === "solana") return assinarERegistrarSolana();
    if (!hash || !window.ethereum) return;

    try {
      setEtapa("assinando");
      setMensagemErro(null);

      // A carteira pode ter trocado de rede entre a verificação e a assinatura.
      await garantirRedeEvm(window.ethereum, rede);
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contrato = new Contract(
        REDES_EVM[rede].endereco,
        REGISTRO_ASSINATURAS_ABI,
        signer,
      );
      const hashBytes32 = hexlify(`0x${hash}`);

      const tx = await contrato.registrar(hashBytes32, nomeDocumento, tipoDocumento);
      const recibo = await tx.wait();

      setTxHash(recibo?.hash ?? tx.hash);
      setEtapa("confirmado");
    } catch (erro) {
      console.error(erro);
      const mensagem = erro instanceof Error ? erro.message : t.erroRegistro;
      setMensagemErro(
        mensagem.includes("DocumentoJaRegistrado") ? t.erroJaRegistrado : mensagem,
      );
      setEtapa("erro");
    }
  }

  const dentroDoLimiteSolana =
    bytesUtf8(nomeDocumento.trim()) <= MAX_NOME_BYTES &&
    bytesUtf8(tipoDocumento.trim()) <= MAX_TIPO_BYTES;
  const podeAssinar =
    hash !== null &&
    nomeDocumento.trim() !== "" &&
    tipoDocumento.trim() !== "" &&
    (rede !== "solana" || dentroDoLimiteSolana);

  const linkTx = (tx: string) =>
    rede === "solana" ? linkExplorerSolana("tx", tx) : linkTxEvm(rede, tx);

  const redes: { id: Rede; nome: string; carteira: string }[] = [
    { id: "sepolia", nome: t.redeSepolia, carteira: t.carteiraSepolia },
    { id: "base-sepolia", nome: t.redeBase, carteira: t.carteiraSepolia },
    { id: "solana", nome: t.redeSolana, carteira: t.carteiraSolana },
  ];

  return (
    <div className="border border-slate/25 px-6 py-8">
      <fieldset className="mb-6">
        <legend className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.redeTitulo}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
          {redes.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={rede === r.id}
              onClick={() => trocarRede(r.id)}
              disabled={etapa === "assinando" || etapa === "conectando"}
              className={`border px-4 py-2 text-left transition-colors disabled:opacity-50 ${
                rede === r.id
                  ? "border-ink bg-ink text-bone"
                  : "border-slate/30 text-ink hover:border-brass"
              }`}
            >
              <span className="block font-body text-sm">{r.nome}</span>
              <span
                className={`block font-mono text-[11px] ${
                  rede === r.id ? "text-bone/70" : "text-slate"
                }`}
              >
                {r.carteira}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input type="file" className="sr-only" onChange={aoSelecionarArquivo} />
        <span className="font-body text-sm text-slate">
          {etapa === "idle" && t.selecione}
          {etapa === "calculando" && t.calculando}
          {etapa !== "idle" &&
            etapa !== "calculando" &&
            `${t.arquivo} ${nomeArquivo}`}
        </span>
      </label>

      {hash && (
        <div className="mt-6 border-t border-slate/15 pt-6">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">
            {t.hashTitulo}
          </p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{hash}</p>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-slate">
            {t.hashExplicacao}
          </p>

          {etapa === "ja_registrado" && registroExistente && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                {t.jaRegistrado}
              </p>
              <p className="mt-2 font-body text-sm text-ink">
                {registroExistente.nomeDocumento} · {registroExistente.tipoDocumento}
              </p>
              <p className="mt-1 font-mono text-xs text-slate">
                {t.assinadoPor} {enderecoCurto(registroExistente.assinante)}{" "}
                {t.assinadoEm}{" "}
                {formatarTimestamp(registroExistente.timestamp, locale)}
              </p>
            </div>
          )}

          {verificadoSemRegistro && etapa === "pronto" && (
            <p className="mt-5 font-mono text-xs uppercase tracking-wide text-slate">
              {t.naoRegistrado}
            </p>
          )}

          {(etapa === "pronto" || etapa === "conectando" || etapa === "verificando") && (
            <div className="mt-5 space-y-3">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  {t.campoNome}
                </label>
                <input
                  type="text"
                  value={nomeDocumento}
                  onChange={(e) => setNomeDocumento(e.target.value)}
                  placeholder={t.placeholderNome}
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  {t.campoTipo}
                </label>
                <input
                  type="text"
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value)}
                  placeholder={t.placeholderTipo}
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>

              {!enderecoCarteira ? (
                <button
                  onClick={conectarEVerificar}
                  disabled={etapa === "conectando" || etapa === "verificando"}
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {etapa === "conectando" && t.conectando}
                  {etapa === "verificando" && t.verificandoBotao}
                  {etapa === "pronto" && t.conectar}
                </button>
              ) : (
                <button
                  onClick={assinarERegistrar}
                  disabled={!podeAssinar}
                  title={
                    !podeAssinar
                      ? rede === "solana" && !dentroDoLimiteSolana
                        ? t.limiteSolana
                        : t.assinarBloqueado
                      : undefined
                  }
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {t.assinar}
                </button>
              )}

              {rede === "solana" && !dentroDoLimiteSolana && (
                <p className="font-body text-xs text-red-700">{t.limiteSolana}</p>
              )}

              {enderecoCarteira && (
                <p className="font-mono text-xs text-slate">
                  {t.carteiraConectada} {enderecoCurto(enderecoCarteira)}
                </p>
              )}
            </div>
          )}

          {etapa === "assinando" && (
            <p className="mt-5 font-body text-sm text-slate">
              {t.aguardando}
            </p>
          )}

          {etapa === "confirmado" && txHash && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                {t.sucesso}
              </p>
              <a
                href={linkTx(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
              >
                {txHash} ↗{" "}
                {rede === "solana"
                  ? t.verNaSolana
                  : rede === "base-sepolia"
                    ? t.verNaBase
                    : t.verNaSepolia}
              </a>
            </div>
          )}

          {etapa === "erro" && mensagemErro && (
            <p className="mt-5 max-w-md font-body text-sm text-red-700">{mensagemErro}</p>
          )}
        </div>
      )}
    </div>
  );
}
