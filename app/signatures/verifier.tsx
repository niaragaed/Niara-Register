"use client";

import { useState } from "react";
import { BrowserProvider, Contract, hexlify } from "ethers";
import { Transaction } from "@solana/web3.js";
import {
  MAX_NAME_BYTES,
  MAX_TYPE_BYTES,
  fetchSolanaRecord,
  utf8Bytes,
  solanaConnection,
  registerInstruction,
  solanaExplorerLink,
  solanaErrorReason,
} from "@/lib/register-solana";
import type { SolanaProvider } from "@/lib/solana";
import {
  EVM_NETWORKS,
  REGISTRO_ASSINATURAS_ABI,
  evmTxLink,
  type EvmNetworkConfig,
  type EvmNetwork,
} from "@/lib/register-contract";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { formatTimestamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";

type VerifierText = Dictionary["verifier"];

type Network = EvmNetwork | "solana";

type Step =
  | "idle"
  | "computing"
  | "ready"
  | "connecting"
  | "checking"
  | "already_recorded"
  | "signing"
  | "confirmed"
  | "error";

type ExistingRecord = {
  signer: string;
  timestamp: number;
  documentName: string;
  documentType: string;
};

async function sha256Of(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function solanaProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

/** Explorer URL for wallet_addEthereumChain; null if there is no https one. */
function explorerUrls(cfg: EvmNetworkConfig): string[] | null {
  if (!cfg.ownExplorer) return [cfg.explorer];
  const origin = window.location.origin;
  return origin.startsWith("https://") ? [`${origin}${cfg.explorer}`] : null;
}

async function ensureEvmNetwork(
  ethereum: NonNullable<typeof window.ethereum>,
  network: EvmNetwork,
) {
  const cfg = EVM_NETWORKS[network];
  const currentChainId = await ethereum.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === cfg.chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.chainIdHex }],
    });
  } catch (error: unknown) {
    // 4902 = the wallet does not know this network yet and needs to add it
    const code = (error as { code?: number })?.code;
    if (code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.chainName,
            nativeCurrency: { ...cfg.currency, decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
            // Wallets require an absolute (https) URL. With the site's own
            // reader, the wallet's "view on explorer" lands on the site's
            // /explorer/... routes, which follow the same <base>/tx/<hash> format.
            blockExplorerUrls: explorerUrls(cfg),
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

export function DocumentVerifier({
  t,
  locale,
}: {
  t: VerifierText;
  locale: Locale;
}) {
  const [hash, setHash] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [network, setNetwork] = useState<Network>("sepolia");
  const [checkedNotRecorded, setCheckedNotRecorded] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [existingRecord, setExistingRecord] = useState<ExistingRecord | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStep("computing");
    setFileName(file.name);
    setExistingRecord(null);
    setCheckedNotRecorded(false);
    setTxHash(null);
    setErrorMessage(null);
    const digest = await sha256Of(file);
    setHash(digest);
    setStep("ready");
  }

  function switchNetwork(next: Network) {
    if (next === network) return;
    setNetwork(next);
    // Wallet, check result and tx are per network; the hash and the form
    // fields stay valid.
    setWalletAddress(null);
    setExistingRecord(null);
    setCheckedNotRecorded(false);
    setTxHash(null);
    setErrorMessage(null);
    if (hash) setStep("ready");
  }

  async function connectAndCheckSolana() {
    if (!hash) return;
    const provider = solanaProvider();
    if (!provider) {
      setErrorMessage(t.noSolanaWallet);
      setStep("error");
      return;
    }

    try {
      setStep("connecting");
      const { publicKey } = await provider.connect();
      setWalletAddress(publicKey.toBase58());

      setStep("checking");
      const record = await fetchSolanaRecord(solanaConnection(), hash);
      if (record) {
        setExistingRecord(record);
        setStep("already_recorded");
      } else {
        setCheckedNotRecorded(true);
        setStep("ready");
      }
    } catch (error) {
      // Phantom only returns "Unexpected error" when it is locked or has no
      // wallet created yet; 4001 is an explicit user rejection.
      console.error(error);
      const code = (error as { code?: number })?.code;
      setErrorMessage(code === 4001 ? t.connectionRejected : t.phantomError);
      setStep("error");
    }
  }

  async function signAndRecordSolana() {
    const provider = solanaProvider();
    if (!hash || !provider?.publicKey) return;

    try {
      setStep("signing");
      setErrorMessage(null);

      const connection = solanaConnection();
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: provider.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        registerInstruction(
          provider.publicKey,
          hash,
          documentName.trim(),
          documentType.trim(),
        ),
      );

      // Signs in the wallet and sends through our devnet RPC: that way the
      // transaction goes to devnet even if the wallet is on another network.
      const signed = await provider.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize());
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (result.value.err) {
        throw new Error(JSON.stringify(result.value.err));
      }

      setTxHash(signature);
      setStep("confirmed");
    } catch (error) {
      console.error(error);
      const reason = solanaErrorReason(error);
      setErrorMessage(
        reason === "DocumentoJaRegistrado"
          ? t.alreadyRecordedError
          : reason === "NomeInvalido" || reason === "TipoInvalido"
            ? t.solanaLimit
            : error instanceof Error
              ? error.message
              : t.recordError,
      );
      setStep("error");
    }
  }

  async function connectAndCheck() {
    if (network === "solana") return connectAndCheckSolana();
    if (!hash) return;
    if (!window.ethereum) {
      setErrorMessage(t.noWallet);
      setStep("error");
      return;
    }

    try {
      setStep("connecting");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await ensureEvmNetwork(window.ethereum, network);

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWalletAddress(address);

      setStep("checking");
      const contract = new Contract(
        EVM_NETWORKS[network].address,
        REGISTRO_ASSINATURAS_ABI,
        provider,
      );
      const hashBytes32 = hexlify(`0x${hash}`);
      const [exists, recordSigner, timestamp, existingName, existingType] =
        await contract.verificar(hashBytes32);

      if (exists) {
        setExistingRecord({
          signer: recordSigner,
          timestamp: Number(timestamp),
          documentName: existingName,
          documentType: existingType,
        });
        setStep("already_recorded");
      } else {
        setCheckedNotRecorded(true);
        setStep("ready");
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : t.connectionError);
      setStep("error");
    }
  }

  async function signAndRecord() {
    if (network === "solana") return signAndRecordSolana();
    if (!hash || !window.ethereum) return;

    try {
      setStep("signing");
      setErrorMessage(null);

      // The wallet may have switched networks between the check and the signature.
      await ensureEvmNetwork(window.ethereum, network);
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(
        EVM_NETWORKS[network].address,
        REGISTRO_ASSINATURAS_ABI,
        signer,
      );
      const hashBytes32 = hexlify(`0x${hash}`);

      const tx = await contract.registrar(hashBytes32, documentName, documentType);
      const receipt = await tx.wait();

      setTxHash(receipt?.hash ?? tx.hash);
      setStep("confirmed");
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : t.recordError;
      setErrorMessage(
        message.includes("DocumentoJaRegistrado") ? t.alreadyRecordedError : message,
      );
      setStep("error");
    }
  }

  const withinSolanaLimit =
    utf8Bytes(documentName.trim()) <= MAX_NAME_BYTES &&
    utf8Bytes(documentType.trim()) <= MAX_TYPE_BYTES;
  const canSign =
    hash !== null &&
    documentName.trim() !== "" &&
    documentType.trim() !== "" &&
    (network !== "solana" || withinSolanaLimit);

  const txLink = (tx: string) =>
    network === "solana" ? solanaExplorerLink("tx", tx) : evmTxLink(network, tx);

  const networks: { id: Network; name: string; wallet: string }[] = [
    { id: "sepolia", name: t.networkSepolia, wallet: t.walletEvm },
    { id: "base-sepolia", name: t.networkBase, wallet: t.walletEvm },
    { id: "robinhood-testnet", name: t.networkRobinhood, wallet: t.walletEvm },
    { id: "hyperevm-testnet", name: t.networkHyperEvm, wallet: t.walletEvm },
    { id: "tempo-testnet", name: t.networkTempo, wallet: t.walletEvm },
    { id: "solana", name: t.networkSolana, wallet: t.walletSolana },
  ];

  return (
    <div className="border border-slate/25 px-6 py-8">
      <fieldset className="mb-6">
        <legend className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.networkTitle}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
          {networks.map((n) => (
            <button
              key={n.id}
              type="button"
              role="radio"
              aria-checked={network === n.id}
              onClick={() => switchNetwork(n.id)}
              disabled={step === "signing" || step === "connecting"}
              className={`border px-4 py-2 text-left transition-colors disabled:opacity-50 ${
                network === n.id
                  ? "border-ink bg-ink text-bone"
                  : "border-slate/30 text-ink hover:border-brass"
              }`}
            >
              <span className="block font-body text-sm">{n.name}</span>
              <span
                className={`block font-mono text-[11px] ${
                  network === n.id ? "text-bone/70" : "text-slate"
                }`}
              >
                {n.wallet}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input type="file" className="sr-only" onChange={onFileSelected} />
        <span className="font-body text-sm text-slate">
          {step === "idle" && t.selectPrompt}
          {step === "computing" && t.computing}
          {step !== "idle" &&
            step !== "computing" &&
            `${t.file} ${fileName}`}
        </span>
      </label>

      {hash && (
        <div className="mt-6 border-t border-slate/15 pt-6">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">
            {t.hashTitle}
          </p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{hash}</p>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-slate">
            {t.hashExplanation}
          </p>

          {step === "already_recorded" && existingRecord && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                {t.alreadyRecorded}
              </p>
              <p className="mt-2 font-body text-sm text-ink">
                {existingRecord.documentName} · {existingRecord.documentType}
              </p>
              <p className="mt-1 font-mono text-xs text-slate">
                {t.signedBy} {shortAddress(existingRecord.signer)}{" "}
                {t.signedOn}{" "}
                {formatTimestamp(existingRecord.timestamp, locale)}
              </p>
            </div>
          )}

          {checkedNotRecorded && step === "ready" && (
            <p className="mt-5 font-mono text-xs uppercase tracking-wide text-slate">
              {t.notRecorded}
            </p>
          )}

          {(step === "ready" || step === "connecting" || step === "checking") && (
            <div className="mt-5 space-y-3">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  {t.nameField}
                </label>
                <input
                  type="text"
                  value={documentName}
                  onChange={(e) => setDocumentName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wide text-slate">
                  {t.typeField}
                </label>
                <input
                  type="text"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  placeholder={t.typePlaceholder}
                  className="mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass"
                />
              </div>

              {!walletAddress ? (
                <button
                  onClick={connectAndCheck}
                  disabled={step === "connecting" || step === "checking"}
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {step === "connecting" && t.connecting}
                  {step === "checking" && t.checkingButton}
                  {step === "ready" && t.connect}
                </button>
              ) : (
                <button
                  onClick={signAndRecord}
                  disabled={!canSign}
                  title={
                    !canSign
                      ? network === "solana" && !withinSolanaLimit
                        ? t.solanaLimit
                        : t.signBlocked
                      : undefined
                  }
                  className="mt-2 border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  {t.sign}
                </button>
              )}

              {network === "solana" && !withinSolanaLimit && (
                <p className="font-body text-xs text-red-700">{t.solanaLimit}</p>
              )}

              {walletAddress && (
                <p className="font-mono text-xs text-slate">
                  {t.connectedWallet} {shortAddress(walletAddress)}
                </p>
              )}
            </div>
          )}

          {step === "signing" && (
            <p className="mt-5 font-body text-sm text-slate">
              {t.waiting}
            </p>
          )}

          {step === "confirmed" && txHash && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">
                {t.success}
              </p>
              <a
                href={txLink(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
              >
                {txHash} ↗{" "}
                {network === "solana"
                  ? t.viewOnSolana
                  : network === "base-sepolia"
                    ? t.viewOnBase
                    : network === "robinhood-testnet"
                      ? t.viewOnRobinhood
                      : network === "hyperevm-testnet"
                        ? t.viewOnHyperEvm
                        : network === "tempo-testnet"
                          ? t.viewOnTempo
                          : t.viewOnSepolia}
              </a>
            </div>
          )}

          {step === "error" && errorMessage && (
            <p className="mt-5 max-w-md font-body text-sm text-red-700">{errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
