"use client";
// Transferable records (MLETR-aligned) on the five EVM networks and Solana.
import { useState } from "react";
import { Contract, getAddress, isAddress, type Signer } from "ethers";
import { PublicKey } from "@solana/web3.js";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";
import { formatTimestamp } from "@/lib/i18n/format";
import { ZERO_HASH, isHash32, sha256, toHex } from "@/lib/commitments";
import { ETR_STATUS, TRANSFERABLE_RECORD_ABI, v2Deployment } from "@/lib/register-v2-evm";
import * as sol from "@/lib/register-v2-solana";
import { isEvm, type RegisterNetwork } from "@/lib/networks";
import type { SolanaProvider } from "@/lib/solana";
import { WalletMissing, connectEvm, connectSolana, isRejection, sendSolana, solanaConnection } from "@/lib/wallets";
import { Label, NetworkPicker, Notice, inputClass, linkClass, primaryButton, readFile, secondaryButton, short } from "@/components/v2/ui";
import { useWalletPicker } from "@/components/v2/wallet-picker";
import { UnlistedWalletConnectPeer } from "@/lib/walletconnect";

type Wallet =
  | { kind: "evm"; signer: Signer; address: string; name: string }
  | { kind: "solana"; provider: SolanaProvider; address: string; name: string };
type View = {
  originalHash: string;
  issuer: string;
  controller: string;
  version: number;
  status: "active" | "surrendered" | "terminated";
  issuedAt: number;
  documentHash: string;
  pendingHash: string | null;
};
type Texts = Pick<Dictionary, "etr" | "register">;

const sameAccount = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function EtrPanel({ t, locale }: { t: Texts; locale: Locale }) {
  const te = t.etr;
  const walletPicker = useWalletPicker(t.register);
  const [network, setNetwork] = useState<RegisterNetwork>("sepolia");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [issueHash, setIssueHash] = useState<string | null>(null);
  const [holder, setHolder] = useState("");
  const [lookup, setLookup] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [amendHash, setAmendHash] = useState<string | null>(null);
  const [reason, setReason] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "neutral"; text: string } | null>(null);

  const etrAddress = isEvm(network) ? v2Deployment(network).etr : null;
  const unavailable = isEvm(network) && !etrAddress;

  function fail(e: unknown) {
    console.error(e);
    const text =
      e instanceof UnlistedWalletConnectPeer
        ? t.register.unlistedWallet.replace("{name}", e.peerName)
        : e instanceof WalletMissing
        ? isEvm(network)
          ? t.register.noWallet
          : t.register.noSolanaWallet
        : isRejection(e)
          ? t.register.rejected
          : (!isEvm(network) && sol.solanaV2ErrorReason(e)) || (e instanceof Error ? e.message : String(e));
    setMessage({ tone: "bad", text });
  }

  async function connect() {
    setMessage(null);
    try {
      if (isEvm(network)) {
        const chosen = await walletPicker.chooseEvm();
        const { signer, address } = await connectEvm(network, chosen.provider);
        setWallet({ kind: "evm", signer, address, name: chosen.name });
        if (!holder) setHolder(address);
      } else {
        const chosen = await walletPicker.chooseSolana();
        const { provider, address } = await connectSolana(chosen.provider);
        setWallet({ kind: "solana", provider, address, name: chosen.name });
        if (!holder) setHolder(address);
      }
    } catch (e) {
      fail(e);
    }
  }

  async function load(originalHash: string) {
    setMessage(null);
    const hex = originalHash.replace(/^0x/, "").toLowerCase();
    if (!isHash32(hex)) return;
    try {
      if (isEvm(network)) {
        if (!wallet || wallet.kind !== "evm") return;
        const c = new Contract(etrAddress!, TRANSFERABLE_RECORD_ABI, wallet.signer);
        const r = await c.getRecord(BigInt(`0x${hex}`));
        const status = ETR_STATUS[Number(r.status)];
        if (status === "none") {
          setView(null);
          setMessage({ tone: "neutral", text: te.notFound });
          return;
        }
        const pending = await c.pendingAmendment(BigInt(`0x${hex}`));
        const controller = status === "terminated" ? "" : String(await c.controllerOf(BigInt(`0x${hex}`)));
        const pendingHash = String(pending.documentHash).slice(2);
        setView({
          originalHash: hex,
          issuer: String(r.issuer),
          controller,
          version: Number(r.version),
          status,
          issuedAt: Number(r.issuedAt),
          documentHash: String(r.documentHash).slice(2),
          pendingHash: /^0+$/.test(pendingHash) ? null : pendingHash,
        });
      } else {
        const r = await sol.fetchTransferableRecord(solanaConnection(), hex);
        if (!r) {
          setView(null);
          setMessage({ tone: "neutral", text: te.notFound });
          return;
        }
        setView({ ...r, originalHash: r.originalHash });
      }
    } catch (e) {
      fail(e);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "ok", text: te.done });
      if (view) await load(view.originalHash);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const evm = () => {
    if (!wallet || wallet.kind !== "evm") throw new WalletMissing("evm");
    return new Contract(etrAddress!, TRANSFERABLE_RECORD_ABI, wallet.signer);
  };
  const solProvider = () => {
    if (!wallet || wallet.kind !== "solana") throw new WalletMissing("solana");
    return wallet.provider;
  };
  const tokenId = () => BigInt(`0x${view!.originalHash}`);
  const recordKey = () => sol.transferableRecordAddress(view!.originalHash);

  async function issue() {
    if (!issueHash) return;
    await run(async () => {
      if (isEvm(network)) {
        if (!isAddress(holder)) throw new Error(t.etr.holder);
        await (await evm().issue(`0x${issueHash}`, `0x${ZERO_HASH}`, getAddress(holder))).wait();
      } else {
        const p = solProvider();
        await sendSolana(p, sol.issueRecordInstruction(p.publicKey!, issueHash, ZERO_HASH, new PublicKey(holder)));
      }
      setLookup(`0x${issueHash}`);
    });
    await load(issueHash);
  }

  const isIssuer = Boolean(wallet && view && sameAccount(wallet.address, view.issuer));
  const isController = Boolean(wallet && view && view.controller && sameAccount(wallet.address, view.controller));
  const active = view?.status === "active";

  return (
    <div className="mt-10 space-y-10">
      {walletPicker.element}
      <div className="border border-slate/25 px-6 py-8">
        <Label>{t.register.networkTitle}</Label>
        <NetworkPicker
          value={network}
          onChange={(n) => {
            setNetwork(n);
            setWallet(null);
            setView(null);
            setMessage(null);
          }}
          names={t.register.networks}
          walletEvm={t.register.walletEvm}
          walletSolana={t.register.walletSolana}
        />
        {unavailable && <Notice tone="bad">{te.notDeployed}</Notice>}
        <div className="mt-5">
          {wallet ? (
            <span className="font-mono text-xs text-slate">
              {t.register.connectedWallet} {short(wallet.address)}
              {wallet && (
                <>
                  {" "}
                  ({wallet.name}) ·{" "}
                  <button className={linkClass} disabled={busy} onClick={() => connect()}>
                    {t.register.changeWallet}
                  </button>
                </>
              )}
            </span>
          ) : (
            <button className={primaryButton} disabled={unavailable} onClick={() => connect()}>
              {te.connectFirst}
            </button>
          )}
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>

      <section className="border border-slate/25 px-6 py-8">
        <h2 className="font-display text-xl text-ink">{te.issueTitle}</h2>
        <label className="mt-4 block">
          <span className="block font-mono text-xs uppercase tracking-wide text-slate">{te.documentFile}</span>
          <input
            type="file"
            className="mt-1 block font-body text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setIssueHash(f ? toHex(await sha256(await readFile(f))) : null);
            }}
          />
        </label>
        {issueHash && <p className="mt-2 break-all font-mono text-xs text-ink">0x{issueHash}</p>}
        <label className="mt-4 block">
          <span className="block font-mono text-xs uppercase tracking-wide text-slate">{te.holder}</span>
          <input value={holder} onChange={(e) => setHolder(e.target.value.trim())} className={`${inputClass} font-mono`} />
        </label>
        <button className={`${primaryButton} mt-4`} disabled={!wallet || !issueHash || !holder || busy || unavailable} onClick={issue}>
          {te.issue}
        </button>
      </section>

      <section className="border border-slate/25 px-6 py-8">
        <h2 className="font-display text-xl text-ink">{te.lookupTitle}</h2>
        <label className="mt-4 block">
          <span className="block font-mono text-xs uppercase tracking-wide text-slate">{te.originalHash}</span>
          <input value={lookup} onChange={(e) => setLookup(e.target.value)} className={`${inputClass} font-mono`} placeholder="0x…" />
        </label>
        <button className={`${secondaryButton} mt-4`} disabled={!wallet || unavailable} onClick={() => load(lookup)}>
          {te.open}
        </button>

        {view && (
          <div className="mt-6">
            <dl className="space-y-2 font-body text-sm">
              <div>
                <span className="font-mono text-xs uppercase text-slate">{te.status}: </span>
                {te.statuses[view.status]} · {te.version} {view.version} · {formatTimestamp(view.issuedAt, locale)}
              </div>
              <div className="break-all">
                <span className="font-mono text-xs uppercase text-slate">{te.issuer}: </span>
                {view.issuer}
              </div>
              {view.controller && (
                <div className="break-all">
                  <span className="font-mono text-xs uppercase text-slate">{te.controller}: </span>
                  {view.controller}
                </div>
              )}
              <div className="break-all">
                <span className="font-mono text-xs uppercase text-slate">{te.currentHash}: </span>
                <span className="font-mono text-xs">0x{view.documentHash}</span>
              </div>
              {view.pendingHash && (
                <div className="break-all">
                  <span className="font-mono text-xs uppercase text-slate">{te.pending}: </span>
                  <span className="font-mono text-xs">0x{view.pendingHash}</span>
                </div>
              )}
            </dl>

            <div className="mt-6 border-t border-slate/15 pt-5">
              <Label>{te.actionsTitle}</Label>
              {!isIssuer && !isController && <p className="mt-2 font-body text-sm text-slate">{te.noActions}</p>}

              {active && isController && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="block font-mono text-xs uppercase tracking-wide text-slate">{te.transferTo}</span>
                    <input value={transferTo} onChange={(e) => setTransferTo(e.target.value.trim())} className={`${inputClass} font-mono`} />
                  </label>
                  <button
                    className={secondaryButton}
                    disabled={busy || !transferTo}
                    onClick={() =>
                      run(async () => {
                        if (isEvm(network)) {
                          await (await evm().transferFrom(wallet!.address, getAddress(transferTo), tokenId())).wait();
                        } else {
                          const p = solProvider();
                          await sendSolana(p, sol.transferControlInstruction(p.publicKey!, recordKey(), new PublicKey(transferTo)));
                        }
                      })
                    }
                  >
                    {te.transfer}
                  </button>
                </div>
              )}

              {active && isIssuer && (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="block font-mono text-xs uppercase tracking-wide text-slate">{te.amendFile}</span>
                    <input
                      type="file"
                      className="mt-1 block font-body text-sm"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        setAmendHash(f ? toHex(await sha256(await readFile(f))) : null);
                      }}
                    />
                  </label>
                  <button
                    className={secondaryButton}
                    disabled={busy || !amendHash}
                    onClick={() =>
                      run(async () => {
                        if (isEvm(network)) await (await evm().proposeAmendment(tokenId(), `0x${amendHash}`, `0x${ZERO_HASH}`)).wait();
                        else {
                          const p = solProvider();
                          await sendSolana(p, sol.proposeAmendmentInstruction(p.publicKey!, recordKey(), amendHash!, ZERO_HASH));
                        }
                      })
                    }
                  >
                    {te.propose}
                  </button>
                  {view.pendingHash && (
                    <button
                      className={secondaryButton}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (isEvm(network)) await (await evm().cancelAmendment(tokenId())).wait();
                          else {
                            const p = solProvider();
                            await sendSolana(p, sol.cancelAmendmentInstruction(p.publicKey!, recordKey()));
                          }
                        })
                      }
                    >
                      {te.cancel}
                    </button>
                  )}
                </div>
              )}

              {active && isController && view.pendingHash && (
                <button
                  className={`${secondaryButton} mt-4`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (isEvm(network)) await (await evm().acceptAmendment(tokenId(), `0x${view.pendingHash}`)).wait();
                      else {
                        const p = solProvider();
                        await sendSolana(p, sol.acceptAmendmentInstruction(p.publicKey!, recordKey(), view.pendingHash!));
                      }
                    })
                  }
                >
                  {te.accept}
                </button>
              )}

              {active && isController && (
                <button
                  className={`${secondaryButton} mt-4 ml-0 block`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (isEvm(network)) await (await evm().surrender(tokenId())).wait();
                      else {
                        const p = solProvider();
                        await sendSolana(p, sol.surrenderInstruction(p.publicKey!, recordKey()));
                      }
                    })
                  }
                >
                  {te.surrender}
                </button>
              )}

              {view.status === "surrendered" && isIssuer && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select
                    value={reason}
                    onChange={(e) => setReason(Number(e.target.value) as 0 | 1 | 2)}
                    className="border border-slate/30 bg-bone px-3 py-2 font-body text-sm"
                  >
                    {([0, 1, 2] as const).map((r) => (
                      <option key={r} value={r}>
                        {te.reasons[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    className={secondaryButton}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (isEvm(network)) await (await evm().terminate(tokenId(), reason)).wait();
                        else {
                          const p = solProvider();
                          await sendSolana(p, sol.terminateInstruction(p.publicKey!, recordKey(), reason));
                        }
                      })
                    }
                  >
                    {te.terminate}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
