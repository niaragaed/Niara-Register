"use client";

import { useState } from "react";
import { BrowserProvider, Contract, hexlify } from "ethers";
import {
  ENDERECO_REGISTRO_ASSINATURAS,
  REGISTRO_ASSINATURAS_ABI,
  SEPOLIA_CHAIN_ID_HEX,
} from "@/lib/registro-contract";

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

async function garantirRedeSepolia(ethereum: NonNullable<typeof window.ethereum>) {
  const chainIdAtual = await ethereum.request({ method: "eth_chainId" });
  if (chainIdAtual === SEPOLIA_CHAIN_ID_HEX) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (erro: unknown) {
    // 4902 = a carteira não conhece essa rede ainda, precisa adicionar
    const codigo = (erro as { code?: number })?.code;
    if (codigo === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw erro;
    }
  }
}

export function VerificadorDeDocumento() {
  const [hash, setHash] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [nomeDocumento, setNomeDocumento] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("");
  const [etapa, setEtapa] = useState<Etapa>("idle");
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
    setTxHash(null);
    setMensagemErro(null);
    const digest = await calcularSha256(arquivo);
    setHash(digest);
    setEtapa("pronto");
  }

  async function conectarEVerificar() {
    if (!hash) return;
    if (!window.ethereum) {
      setMensagemErro(
        "Nenhuma carteira detectada. Instale a MetaMask (ou outra carteira compatível) para continuar.",
      );
      setEtapa("erro");
      return;
    }

    try {
      setEtapa("conectando");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await garantirRedeSepolia(window.ethereum);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const endereco = await signer.getAddress();
      setEnderecoCarteira(endereco);

      setEtapa("verificando");
      const contrato = new Contract(
        ENDERECO_REGISTRO_ASSINATURAS,
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
        setEtapa("pronto");
      }
    } catch (erro) {
      console.error(erro);
      setMensagemErro(
        erro instanceof Error ? erro.message : "Não foi possível conectar a carteira.",
      );
      setEtapa("erro");
    }
  }

  async function assinarERegistrar() {
    if (!hash || !window.ethereum) return;

    try {
      setEtapa("assinando");
      setMensagemErro(null);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contrato = new Contract(
        ENDERECO_REGISTRO_ASSINATURAS,
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
      const mensagem = erro instanceof Error ? erro.message : "Falha ao registrar o documento.";
      setMensagemErro(
        mensagem.includes("DocumentoJaRegistrado")
          ? "Esse hash já foi registrado por outra transação enquanto você preenchia o formulário."
          : mensagem,
      );
      setEtapa("erro");
    }
  }

  const podeAssinar =
    hash !== null && nomeDocumento.trim() !== "" && tipoDocumento.trim() !== "";

  return (
    <div className="border border-slate/25 px-6 py-8">
      <label className="block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input type="file" className="sr-only" onChange={aoSelecionarArquivo} />
        <span className="font-body text-sm text-slate">
          {etapa === "idle" && "Selecione um documento para calcular o hash"}
          {etapa === "calculando" && "Calculando hash..."}
          {etapa !== "idle" && etapa !== "calculando" && `Arquivo: ${nomeArquivo}`}
        </span>
      </label>

      {hash && (
        <div className="mt-6 border-t border-slate/15 pt-6">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">
            Hash SHA-256
          </p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{hash}</p>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-slate">
            Este hash é calculado localmente, no seu navegador — o documento
            em si nunca é enviado. Para registrar esta prova on-chain, é
            preciso assinar com uma carteira Sepolia.
          </p>

          {etapa === "ja_registrado" && registroExistente && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                já registrado on-chain
              </p>
              <p className="mt-2 font-body text-sm text-ink">
                {registroExistente.nomeDocumento} · {registroExistente.tipoDocumento}
              </p>
              <p className="mt-1 font-mono text-xs text-slate">
                assinado por {enderecoCurto(registroExistente.assinante)} em{" "}
                {new Date(registroExistente.timestamp * 1000).toLocaleString("pt-BR")}
              </p>
            </div>
          )}

          {(etapa === "pronto" || etapa === "conectando" || etapa === "verificando") && (
            <div className="mt-5 space-y-3">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  Nome do documento
                </label>
                <input
                  type="text"
                  value={nomeDocumento}
                  onChange={(e) => setNomeDocumento(e.target.value)}
                  placeholder='ex.: "Ata de reunião de sócios — 10/09/2026"'
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  Tipo de documento
                </label>
                <input
                  type="text"
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value)}
                  placeholder='ex.: "ata", "contrato", "cap table"'
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>

              {!enderecoCarteira ? (
                <button
                  onClick={conectarEVerificar}
                  disabled={etapa === "conectando" || etapa === "verificando"}
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {etapa === "conectando" && "Conectando..."}
                  {etapa === "verificando" && "Verificando..."}
                  {etapa === "pronto" && "Conectar carteira"}
                </button>
              ) : (
                <button
                  onClick={assinarERegistrar}
                  disabled={!podeAssinar}
                  title={
                    !podeAssinar
                      ? "Preencha nome e tipo do documento antes de assinar"
                      : undefined
                  }
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  Assinar e registrar on-chain
                </button>
              )}

              {enderecoCarteira && (
                <p className="font-mono text-xs text-slate">
                  carteira conectada: {enderecoCurto(enderecoCarteira)}
                </p>
              )}
            </div>
          )}

          {etapa === "assinando" && (
            <p className="mt-5 font-body text-sm text-slate">
              Aguardando confirmação na sua carteira e mineração da transação...
            </p>
          )}

          {etapa === "confirmado" && txHash && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                registrado on-chain com sucesso
              </p>
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
              >
                {txHash} ↗ ver na Sepolia
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
