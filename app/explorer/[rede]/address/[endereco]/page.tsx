import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ethers } from "ethers";
import {
  Aviso,
  CabecalhoExplorador,
  Campo,
  Campos,
  ConfiraVoceMesmo,
  LinkInterno,
  Voltar,
} from "@/components/explorador";
import { REDES_EVM, linkLeitorTx } from "@/lib/registro-contract";
import { ehRedeEvm, lerEndereco, RpcIndisponivel, type LeituraEndereco } from "@/lib/leitor-evm";
import { supabase, supabaseConfigurado, type RegistroAssinatura } from "@/lib/supabase";
import { dictionaries, rotuloTipoDocumento } from "@/lib/i18n/dictionaries";
import { formatarData } from "@/lib/i18n/formato";
import { getLocale } from "@/lib/i18n/get-locale";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ rede: string; endereco: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { endereco } = await params;
  return { title: `${endereco.slice(0, 8)}…${endereco.slice(-4)} · Niara Register` };
}

export default async function EnderecoPage({ params }: Props) {
  const { rede, endereco: bruto } = await params;
  if (!ehRedeEvm(rede) || !ethers.isAddress(bruto)) notFound();
  const endereco = ethers.getAddress(bruto);

  const locale = await getLocale();
  const tudo = dictionaries[locale];
  const t = tudo.explorador;
  const cfg = REDES_EVM[rede];
  const ehNiara = endereco.toLowerCase() === cfg.endereco.toLowerCase();

  let leitura: LeituraEndereco | null = null;
  try {
    leitura = await lerEndereco(rede, endereco);
  } catch (erro) {
    if (!(erro instanceof RpcIndisponivel)) throw erro;
  }

  // Lista do indexador só para o contrato da Niara: é o espelho dos eventos dele.
  const { data } =
    ehNiara && supabaseConfigurado
      ? await supabase
          .from("registro_assinaturas")
          .select("*")
          .eq("rede", rede)
          .order("assinado_em", { ascending: false })
          .limit(50)
      : { data: null };
  const registros = (data ?? []) as RegistroAssinatura[];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <CabecalhoExplorador t={t} rede={rede} eyebrow={t.eyebrowEndereco} titulo={endereco} />

      {leitura === null ? (
        <Aviso titulo={t.rpcTitulo} texto={t.rpcTexto} />
      ) : (
        <div className="mt-6">
          <Campos>
            <Campo rotulo={t.tipoConta}>
              {leitura.tamanhoCodigo > 0 ? t.contaContrato : t.contaComum}
              {ehNiara && <span className="text-slate"> · {t.contratoNiara} (RegistroAssinaturas)</span>}
            </Campo>
            {leitura.tamanhoCodigo > 0 && (
              <Campo rotulo={t.tamanhoCodigo}>
                <span className="font-mono text-xs">
                  {leitura.tamanhoCodigo.toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                </span>{" "}
                {t.bytes}
              </Campo>
            )}
            {/* Em contrato o nonce só conta contratos criados por ele (EIP-161), não transações. */}
            {leitura.tamanhoCodigo === 0 && (
              <Campo rotulo={t.nonce}>
                <span className="font-mono text-xs">{leitura.nonce}</span>
              </Campo>
            )}
            {ehNiara && cfg.txDeploy && (
              <Campo rotulo={t.txDeploy}>
                <LinkInterno href={linkLeitorTx(rede, cfg.txDeploy)}>{cfg.txDeploy}</LinkInterno>
              </Campo>
            )}
          </Campos>
        </div>
      )}

      {registros.length > 0 && (
        <section className="mt-12 border-t border-slate/15 pt-8">
          <h2 className="font-display text-xl text-ink">{t.registrosTitulo}</h2>
          <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{t.registrosLede}</p>
          <ul className="mt-4 divide-y divide-slate/10">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <span className="font-body text-sm text-ink">
                  {r.documento_nome}
                  {r.tipo_documento && (
                    <span className="text-slate"> · {rotuloTipoDocumento(tudo, r.tipo_documento)}</span>
                  )}
                </span>
                <span className="flex flex-wrap items-baseline gap-3">
                  {r.assinado_em && (
                    <time className="font-mono text-xs text-slate">{formatarData(r.assinado_em, locale)}</time>
                  )}
                  {r.tx_hash && (
                    <LinkInterno href={linkLeitorTx(rede, r.tx_hash)}>
                      {r.tx_hash.slice(0, 10)}…{r.tx_hash.slice(-4)}
                    </LinkInterno>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfiraVoceMesmo
        t={t}
        rpcUrl={cfg.rpcUrl}
        chamadas={[{ method: "eth_getCode", params: [endereco, "latest"] }]}
      />
      <Voltar t={t} />
    </div>
  );
}
