import { ethers } from "ethers";

/**
 * Casas decimais dos tokens, lidas da chain — não assumidas.
 *
 * Tratar 18 como constante funcionava por acidente: é o que MockBRL e os 11
 * ParticipacaoToken usam hoje, mas nada no contrato garante isso, e um token
 * futuro com 6 casas (padrão de stablecoin) gravaria valores mil trilhões de
 * vezes errados sem nenhum erro aparente. Aqui o valor vem de `decimals()`.
 *
 * Cada endereço é consultado no máximo uma vez por processo: o resultado fica
 * em cache, e a promessa em andamento também, para chamadas simultâneas não
 * dispararem duas requisições ao RPC.
 */

const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

// A OfertaCaptacao expõe o token de pagamento por `moeda()` e o token de
// participação por `token()`. Ler daí evita hardcodar o endereço do MockBRL.
const OFERTA_TOKENS_ABI = [
  "function moeda() view returns (address)",
  "function token() view returns (address)",
];

export class Decimais {
  private readonly cache = new Map<string, Promise<number>>();
  private moedaPorOferta = new Map<string, Promise<string>>();

  constructor(private readonly provider: ethers.Provider) {}

  /** Casas decimais de um ERC-20 qualquer. */
  de(endereco: string): Promise<number> {
    const chave = endereco.toLowerCase();
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    const promessa = new ethers.Contract(endereco, ERC20_DECIMALS_ABI, this.provider)
      .decimals()
      .then((d: bigint | number) => Number(d))
      .catch((erro: unknown) => {
        // Sem o número de casas não há como formatar sem inventar: deixa o erro
        // subir para o chamador decidir (o indexer registra e tenta de novo no
        // próximo ciclo; o backfill conta como falha e segue).
        this.cache.delete(chave);
        throw new Error(
          `Falha ao ler decimals() de ${endereco}: ${(erro as Error).message}`,
        );
      });

    this.cache.set(chave, promessa);
    return promessa;
  }

  /** Endereço do token de pagamento (MockBRL) declarado pela própria oferta. */
  private moedaDaOferta(oferta: string): Promise<string> {
    const chave = oferta.toLowerCase();
    const emCache = this.moedaPorOferta.get(chave);
    if (emCache) return emCache;

    const promessa = new ethers.Contract(oferta, OFERTA_TOKENS_ABI, this.provider)
      .moeda()
      .then((a: string) => a)
      .catch((erro: unknown) => {
        this.moedaPorOferta.delete(chave);
        throw new Error(
          `Falha ao ler moeda() da oferta ${oferta}: ${(erro as Error).message}`,
        );
      });

    this.moedaPorOferta.set(chave, promessa);
    return promessa;
  }

  /** Casas decimais do token de pagamento usado por uma oferta. */
  async daMoeda(oferta: string): Promise<number> {
    return this.de(await this.moedaDaOferta(oferta));
  }

  /**
   * Casas decimais do token de participação (cotas) de uma oferta. Usa o
   * endereço da config quando existe; senão pergunta à própria oferta.
   */
  async doTokenDeCotas(oferta: string, tokenConhecido: string | null): Promise<number> {
    if (tokenConhecido) return this.de(tokenConhecido);

    const endereco = await new ethers.Contract(oferta, OFERTA_TOKENS_ABI, this.provider)
      .token()
      .catch((erro: unknown) => {
        throw new Error(
          `Falha ao ler token() da oferta ${oferta}: ${(erro as Error).message}`,
        );
      });
    return this.de(endereco);
  }
}
