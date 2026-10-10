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
import { REDES_EVM, REGISTRO_ASSINATURAS_ABI, linkLeitorEndereco } from "@/lib/registro-contract";
import { ehRedeEvm, lerTransacao, RpcIndisponivel, type LeituraTx } from "@/lib/leitor-evm";
import { dictionaries, rotuloTipoDocumento } from "@/lib/i18n/dictionaries";
import { formatarTimestamp } from "@/lib/i18n/formato";
import { getLocale } from "@/lib/i18n/get-locale";

// Sempre lido na hora: o status e as confirmações mudam a cada bloco.
export const dynamic = "force-dynamic";

const HASH_TX = /^0x[0-9a-fA-F]{64}$/;
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

type Props = { params: Promise<{ rede: string; hash: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  return { title: `Tx ${hash.slice(0, 10)}…${hash.slice(-4)} · Niara Register` };
}

export default async function TransacaoPage({ params }: Props) {
  const { rede, hash } = await params;
  if (!ehRedeEvm(rede) || !HASH_TX.test(hash)) notFound();

  const locale = await getLocale();
  const tudo = dictionaries[locale];
  const t = tudo.explorador;
  const cfg = REDES_EVM[rede];
  const contrato = cfg.endereco.toLowerCase();

  let leitura: LeituraTx | null = null;
  try {
    leitura = await lerTransacao(rede, hash);
  } catch (erro) {
    if (!(erro instanceof RpcIndisponivel)) throw erro;
  }

  const ehNiara = (endereco: string | null) => endereco?.toLowerCase() === contrato;
  const enderecoComLink = (endereco: string) => (
    <>
      <LinkInterno href={linkLeitorEndereco(rede, endereco)}>{endereco}</LinkInterno>
      {ehNiara(endereco) && <span className="text-slate"> · {t.contratoNiara}</span>}
    </>
  );

  const chamadas: { method: string; params: unknown[] }[] = [
    { method: "eth_getTransactionReceipt", params: [hash] },
  ];
  if (leitura?.tipo === "incluida" && leitura.registros[0]) {
    chamadas.push({
      method: "eth_call",
      params: [
        {
          to: cfg.endereco,
          data: iface.encodeFunctionData("verificar", [leitura.registros[0].hashDocumento]),
        },
        "latest",
      ],
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <CabecalhoExplorador t={t} rede={rede} eyebrow={t.eyebrowTx} titulo={hash.toLowerCase()} />

      {leitura === null && <Aviso titulo={t.rpcTitulo} texto={t.rpcTexto} />}
      {leitura?.tipo === "nao-encontrada" && (
        <Aviso titulo={t.naoEncontradaTitulo} texto={t.naoEncontradaTexto} />
      )}

      {leitura?.tipo === "pendente" && (
        <div className="mt-6">
          <Campos>
            <Campo rotulo={t.status}>
              <span className="text-slate">{t.pendente}</span>
            </Campo>
            <Campo rotulo={t.de}>{enderecoComLink(leitura.de)}</Campo>
            {leitura.para && <Campo rotulo={t.para}>{enderecoComLink(leitura.para)}</Campo>}
          </Campos>
        </div>
      )}

      {leitura?.tipo === "incluida" && (
        <>
          <div className="mt-6">
            <Campos>
              <Campo rotulo={t.status}>
                {leitura.sucesso ? (
                  <span className="text-moss">{t.sucesso}</span>
                ) : (
                  <span className="text-slate">{t.revertida}</span>
                )}
              </Campo>
              <Campo rotulo={t.bloco}>
                <span className="font-mono text-xs">{leitura.bloco}</span>
                <span className="text-slate">
                  {" · "}
                  {leitura.confirmacoes.toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}{" "}
                  {t.confirmacoes}
                </span>
              </Campo>
              {leitura.dataBloco !== null && (
                <Campo rotulo={t.data}>
                  <span className="font-mono text-xs">
                    {formatarTimestamp(leitura.dataBloco, locale)}
                  </span>
                </Campo>
              )}
              <Campo rotulo={t.de}>{enderecoComLink(leitura.de)}</Campo>
              {leitura.para && <Campo rotulo={t.para}>{enderecoComLink(leitura.para)}</Campo>}
              {leitura.contratoCriado && (
                <Campo rotulo={t.contratoCriado}>{enderecoComLink(leitura.contratoCriado)}</Campo>
              )}
              <Campo rotulo={t.gasUsado}>
                <span className="font-mono text-xs">{leitura.gasUsado}</span>
              </Campo>
            </Campos>
          </div>

          {ehNiara(leitura.contratoCriado) && (
            <p className="mt-6 font-body text-sm text-slate">{t.deployTexto}</p>
          )}

          {leitura.registros.map((r) => (
            <section key={r.logIndex} className="mt-10 border border-moss/40 px-6 py-6">
              <h2 className="font-display text-lg text-ink">{t.registroTitulo}</h2>
              <div className="mt-3">
                <Campos>
                  <Campo rotulo={t.documento}>{r.nomeDocumento}</Campo>
                  <Campo rotulo={t.tipo}>{rotuloTipoDocumento(tudo, r.tipoDocumento)}</Campo>
                  <Campo rotulo={t.hashDocumento}>
                    <span className="font-mono text-xs">{r.hashDocumento}</span>
                  </Campo>
                  <Campo rotulo={t.assinante}>{enderecoComLink(r.assinante)}</Campo>
                  <Campo rotulo={t.registradoEm}>
                    <span className="font-mono text-xs">{formatarTimestamp(r.timestamp, locale)}</span>
                  </Campo>
                </Campos>
              </div>

              <h3 className="mt-6 font-mono text-xs uppercase tracking-wide text-slate">
                {t.verificacaoTitulo}
              </h3>
              <p
                className={`mt-2 font-body text-sm leading-relaxed ${
                  r.confere ? "text-moss" : "text-slate"
                }`}
              >
                {r.noContrato === null ? t.verificacaoFalhou : r.confere ? t.confere : t.naoConfere}
              </p>
            </section>
          ))}

          {leitura.sucesso && leitura.registros.length === 0 && !ehNiara(leitura.contratoCriado) && (
            <p className="mt-8 font-body text-sm text-slate">{t.semRegistro}</p>
          )}
        </>
      )}

      <ConfiraVoceMesmo t={t} rpcUrl={cfg.rpcUrl} chamadas={chamadas} />
      <Voltar t={t} />
    </div>
  );
}
