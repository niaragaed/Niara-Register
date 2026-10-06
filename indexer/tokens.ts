import { ethers } from "ethers";

/**
 * Tudo o que o indexer precisa saber sobre os tokens de uma oferta, lido da
 * chain — nunca assumido.
 *
 * Casas decimais: tratar 18 como constante funcionava por acidente. Nada no
 * contrato garante isso, e um token futuro com 6 casas gravaria valores mil
 * trilhões de vezes errados sem nenhum erro aparente. Aqui vem de `decimals()`.
 *
 * Moeda: cada OfertaCaptacao declara o próprio token de pagamento em `moeda()`.
 * As 11 legadas usam um MockBRL e as do OfertaOrquestrador outro, então o
 * endereço é perguntado a cada oferta, e o símbolo gravado em `dados` é o
 * `symbol()` desse token (hoje "mBRL" nos dois), não um literal.
 *
 * Cada leitura é feita no máximo uma vez por processo: o resultado fica em
 * cache, e a promessa em andamento também, para chamadas simultâneas não
 * dispararem duas requisições ao RPC. Em erro a entrada sai do cache, para a
 * próxima tentativa perguntar de novo.
 */

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// A OfertaCaptacao expõe o token de pagamento por `moeda()` e o token de
// participação por `token()`.
const OFERTA_TOKENS_ABI = [
  "function moeda() view returns (address)",
  "function token() view returns (address)",
];

// ParticipacaoToken: além do ERC-20, guarda a empresa emissora.
const PARTICIPACAO_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function empresa() view returns (string)",
];

export type MetadadosToken = {
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
};

/** O que o indexador usa dos tokens — o teste injeta uma versão falsa. */
export type LeitorTokens = Pick<
  Tokens,
  "daMoeda" | "simboloDaMoeda" | "moedaDaOferta" | "doTokenDeCotas" | "metadados"
>;

export class Tokens {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly provider: ethers.Provider) {}

  private lembrar<T>(chave: string, ler: () => Promise<T>, descricao: string): Promise<T> {
    const emCache = this.cache.get(chave);
    if (emCache) return emCache as Promise<T>;

    const promessa = ler().catch((erro: unknown) => {
      // Sem o dado não há como formatar sem inventar: deixa o erro subir para o
      // chamador decidir (o indexer registra e tenta de novo no próximo ciclo).
      this.cache.delete(chave);
      throw new Error(`Falha ao ler ${descricao}: ${(erro as Error).message}`);
    });
    this.cache.set(chave, promessa);
    return promessa;
  }

  /** Casas decimais de um ERC-20 qualquer. */
  de(endereco: string): Promise<number> {
    return this.lembrar(
      `decimals:${endereco.toLowerCase()}`,
      async () => Number(await new ethers.Contract(endereco, ERC20_ABI, this.provider).decimals()),
      `decimals() de ${endereco}`,
    );
  }

  /** symbol() de um ERC-20 qualquer. */
  simbolo(endereco: string): Promise<string> {
    return this.lembrar(
      `symbol:${endereco.toLowerCase()}`,
      async () => String(await new ethers.Contract(endereco, ERC20_ABI, this.provider).symbol()),
      `symbol() de ${endereco}`,
    );
  }

  /** Endereço do token de pagamento declarado pela própria oferta (moeda()). */
  moedaDaOferta(oferta: string): Promise<string> {
    return this.lembrar(
      `moeda:${oferta.toLowerCase()}`,
      async () => String(await new ethers.Contract(oferta, OFERTA_TOKENS_ABI, this.provider).moeda()),
      `moeda() da oferta ${oferta}`,
    );
  }

  /** Casas decimais do token de pagamento usado por uma oferta. */
  async daMoeda(oferta: string): Promise<number> {
    return this.de(await this.moedaDaOferta(oferta));
  }

  /** symbol() do token de pagamento usado por uma oferta. */
  async simboloDaMoeda(oferta: string): Promise<string> {
    return this.simbolo(await this.moedaDaOferta(oferta));
  }

  /**
   * Casas decimais do token de participação (cotas) de uma oferta. Usa o
   * endereço conhecido quando existe; senão pergunta à própria oferta.
   */
  async doTokenDeCotas(oferta: string, tokenConhecido: string | null): Promise<number> {
    const token =
      tokenConhecido ??
      (await this.lembrar(
        `token:${oferta.toLowerCase()}`,
        async () => String(await new ethers.Contract(oferta, OFERTA_TOKENS_ABI, this.provider).token()),
        `token() da oferta ${oferta}`,
      ));
    return this.de(token);
  }

  /**
   * name(), symbol() e empresa() do ParticipacaoToken. Cada campo é opcional:
   * um token que não exponha empresa() (a chamada reverte) não impede o
   * registro da oferta. Erro de rede, ao contrário, sobe — senão a oferta
   * ficaria gravada sem empresa por uma falha momentânea.
   */
  async metadados(token: string): Promise<MetadadosToken> {
    const c = new ethers.Contract(token, PARTICIPACAO_TOKEN_ABI, this.provider);
    const ler = async (f: "name" | "symbol" | "empresa") => {
      try {
        return String(await c[f]());
      } catch (erro) {
        if (ethers.isError(erro, "CALL_EXCEPTION") || ethers.isError(erro, "BAD_DATA")) return null;
        throw erro;
      }
    };
    return { nome: await ler("name"), simbolo: await ler("symbol"), empresa: await ler("empresa") };
  }
}
