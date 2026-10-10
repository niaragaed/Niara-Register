/**
 * Textos visíveis do site, em inglês e português.
 *
 * O inglês é o padrão e serve de fonte do tipo: `Dictionary` é derivado de `en`,
 * e `pt` precisa satisfazer esse tipo. Qualquer chave que falte ou sobre em `pt`
 * vira erro de compilação, então os dois idiomas não têm como divergir em
 * silêncio.
 *
 * Nada de texto visível fora daqui.
 */

export const en = {
  nav: {
    brand: "Niara",
    product: "Register",
    pmes: "SME Registry",
    global: "Global Registry",
    assinatura: "Document Signing",
    languageLabel: "Language",
  },

  home: {
    eyebrow: "Niara Register",
    headlineLine1: "The Niara ledger.",
    headlineLine2: "Open, verifiable, immutable.",
    lede:
      "Every transaction and every document signature across Niara's products is recorded on the blockchain and mirrored here — with the hash and the link for independent verification on the block explorer.",
    ctaPmes: "View the Niara-SMEs registry",
    ctaAssinatura: "Verify a signature",
    cards: {
      pmes: {
        title: "SME Registry",
        text: "Actual transactions from the SME offerings, indexed directly from the contracts on Sepolia.",
      },
      global: {
        title: "Global Registry",
        text: "Transactions from the Niara Exchange. The Exchange is not yet in production — this section opens empty.",
      },
      assinatura: {
        title: "Document Signing",
        text: "SHA-256 document hashes, anchored on-chain as proof of authorship and integrity.",
      },
    },
  },

  pmes: {
    eyebrow: "SME Registry",
    title: "Niara-SMEs transactions",
    lede:
      "A mirror of the transactions executed on the Niara-SMEs contracts on the Sepolia test network. Each entry points to a verifiable hash on Etherscan.",
    notaNumeracao:
      "Entries are numbered in the order the Register recorded them. Events indexed retroactively keep their original on-chain date.",
    vazio: "No transactions indexed yet.",
    desconectado:
      "The indexer is not connected to a Postgres database on this instance. This does not mean there are no transactions — it means the read path has not been switched on yet.",
  },

  global: {
    eyebrow: "Global Registry",
    title: "Niara Exchange transactions",
    lede: "A mirror of Niara Exchange transactions, once it is operating.",
    vazioTitulo: "No transactions recorded.",
    vazioTexto:
      "The Niara Exchange is not yet in production — the contracts are deployed and tested locally only. This section will be connected to the indexer as soon as there are real transactions on the network.",
  },

  assinatura: {
    eyebrow: "Document Signing",
    title: "Prove that a document is authentic",
    lede:
      "Compute a document's SHA-256 hash and record it on-chain as proof of existence and authorship. The document never leaves your browser — only the hash is recorded.",
    contratoPrefixo: "The signature registry contract (",
    contratoSufixo:
      ") is the same contract on Ethereum Sepolia, Base Sepolia and Robinhood Chain Testnet. The hash is computed in your browser and each signature becomes a real transaction, verifiable on the network's explorer: ",
    historicoTitulo: "Documents already recorded",
    historicoLede:
      "A mirror of every document recorded on Ethereum Sepolia, Base Sepolia, Robinhood Chain Testnet and Solana Devnet, most recent first. Each entry links to its transaction on the network's own block explorer.",
    solanaPrefixo: "The Solana program (",
    solanaSufixo:
      ") follows the same rules on Solana devnet: one record per hash, immutable, with rent paid by the signer's own wallet — Niara never holds the document or the keys.",
    vazio: "No documents recorded yet.",
    desconectado:
      "The indexer is not connected to a Postgres database on this instance. This does not mean there are no documents — it means the read path has not been switched on yet.",
  },

  verificador: {
    selecione: "Select a document to compute its hash",
    calculando: "Computing hash...",
    arquivo: "File:",
    hashTitulo: "SHA-256 hash",
    hashExplicacao:
      "This hash is computed locally, in your browser — the document itself is never uploaded. To record this proof on-chain you sign with a self-custody wallet on the network selected above.",
    jaRegistrado: "already recorded on-chain",
    assinadoPor: "signed by",
    assinadoEm: "on",
    campoNome: "Document name",
    campoTipo: "Document type",
    placeholderNome: 'e.g. "Shareholders meeting minutes — 09/10/2026"',
    placeholderTipo: 'e.g. "minutes", "agreement", "cap table"',
    conectar: "Connect wallet",
    conectando: "Connecting...",
    verificandoBotao: "Checking...",
    assinar: "Sign and record on-chain",
    assinarBloqueado: "Fill in the document name and type before signing",
    aguardando:
      "Waiting for confirmation in your wallet and for the transaction to be mined...",
    sucesso: "recorded on-chain successfully",
    carteiraConectada: "connected wallet:",
    semCarteira:
      "No wallet detected. Install MetaMask (or another compatible wallet) to continue.",
    erroConexao: "Could not connect the wallet.",
    erroRegistro: "Failed to record the document.",
    erroJaRegistrado:
      "That hash was recorded by another transaction while you were filling in the form.",
    verNaSepolia: "view on Sepolia",
    redeTitulo: "Network",
    redeSepolia: "Ethereum Sepolia",
    redeSolana: "Solana Devnet",
    redeBase: "Base Sepolia",
    verNaBase: "view on BaseScan",
    redeRobinhood: "Robinhood Chain Testnet",
    verNaRobinhood: "view on Robinhood Explorer",
    carteiraSepolia: "MetaMask or compatible",
    carteiraSolana: "Phantom or Solflare",
    semCarteiraSolana:
      "No Solana wallet detected. Install Phantom (or Solflare) to continue.",
    limiteSolana:
      "On Solana the name is limited to 128 bytes and the type to 32 bytes.",
    verNaSolana: "view on Solana Explorer",
    naoRegistrado: "not recorded on this network yet",
    erroPhantom:
      "Could not connect to the Solana wallet. Unlock Phantom (and finish its setup, if it is new), then try again.",
    conexaoRecusada: "The connection request was rejected in the wallet.",
  },

  /**
   * Frase de cada evento, montada a partir da coluna `dados`. Os marcadores
   * {chave} são substituídos na exibição — endereços viram link truncado para o
   * Etherscan, o resto entra como texto.
   */
  frases: {
    offering_created:
      "Offering {oferta} created directly by issuer {emissor} — target {metaMinima} to {metaMaxima} {moeda}, {precoPorCota} {moeda} per share, closes {prazo}",
    investment:
      "Investor {investidor} invested {valor} {moeda} in offering {oferta}",
    offering_closed:
      "Offering {oferta} {desfecho} — {totalArrecadado} {moeda} raised",
    offering_cancelled: "Offering {oferta} was cancelled",
    shares_redeemed:
      "Investor {investidor} redeemed {cotas} shares in offering {oferta}",
    funds_released:
      "{valorEmissor} {moeda} released to issuer {emissor}, {taxa} {moeda} protocol fee ({protocolo}), in offering {oferta}",
    refund:
      "Investor {investidor} refunded {valor} {moeda} in offering {oferta}",
  },

  // Frase verbal inteira, não um adjetivo: as duas línguas constroem o
  // encerramento de formas diferentes demais para um único molde.
  desfechos: {
    success: "closed successfully",
    failure: "closed without reaching its target",
    unknown: "closed with an undetermined outcome",
  },

  entrada: {
    numeroPrefixo: "no.",
    confirmado: "confirmed on-chain",
    aguardandoConfirmacao: "awaiting confirmation",
    // o status de assinatura e outro campo do banco ("assinado_onchain" |
    // "pendente"), com os termos proprios do glossario
    assinadoOnchain: "Signed on-chain",
    // chave espelha o valor "pendente" do banco; o rótulo é o texto decidido
    pendente: "Awaiting confirmation",
    verNaSepolia: "view on Sepolia",
    verNaSolana: "view on Solana Explorer",
    verNaBase: "view on BaseScan",
    verNaRobinhood: "view on Robinhood Explorer",
    redeSepolia: "Ethereum Sepolia",
    redeSolana: "Solana Devnet",
    redeBase: "Base Sepolia",
    redeRobinhood: "Robinhood Chain Testnet",
    hash: "hash",
    assinante: "signer",
  },

  /**
   * Rótulo por tipo de evento. O indexer grava `descricao` em português no
   * Postgres e nós não mexemos nem no banco nem no indexer, então o rótulo vem
   * daqui pelo `tipo_evento` e a `descricao` só aparece como fallback.
   */
  eventos: {
    "Oferta criada": "Offering created",
    Aporte: "Investment",
    "Oferta encerrada": "Offering closed",
    "Oferta cancelada": "Offering cancelled",
    "Resgate de cotas": "Shares redeemed",
    "Recursos liberados": "Funds released",
    Reembolso: "Refund",
    "Documento assinado": "Document signed",
  },

  carregando: "Loading...",

  /**
   * Rótulo por tipo de documento, SÓ para exibição. O campo é texto livre no
   * formulário, então este mapa cobre os valores em uso; qualquer valor novo
   * aparece como foi digitado. O que está gravado on-chain nunca muda.
   */
  tiposDocumento: {
    NDA: "NDA",
    "Contrato de Locação": "Lease Agreement",
    Ata: "Minutes",
  },

  /**
   * Rótulo de exibição da moeda, pelo symbol() que o indexer grava em `dados`.
   * O token de teste se chama "mBRL" on-chain; na tela aparece "MockBRL", para
   * não haver dúvida de que não é real. Símbolo fora do mapa aparece como veio.
   */
  moedas: {
    mBRL: "MockBRL",
  },

  naoEncontrado: {
    titulo: "Page not found",
    texto: "The address you tried does not exist in the Niara Register.",
    voltar: "Back to home",
  },

  erro: {
    titulo: "Something went wrong",
    texto:
      "We could not load this page. The record itself is on-chain and unaffected — only this view failed.",
    tentar: "Try again",
  },

  meta: {
    titulo: "Niara Register",
    descricao:
      "Niara's ledger of transactions and signatures — on-chain proofs, queryable and verifiable.",
  },
};

/**
 * O tipo sai do inglês, que é o padrão. Sem `as const` de propósito: com ele os
 * valores virariam tipos literais e o português nunca satisfaria o tipo.
 */
export type Dictionary = typeof en;

/**
 * O `tipo_evento` vem do banco como string livre, então a busca precisa de um
 * acesso dinâmico. Fica isolada aqui para o dicionário seguir com as chaves
 * estritamente tipadas — se um idioma esquecer um evento, o build acusa.
 */
export function rotuloEvento(dict: Dictionary, tipoEvento: string): string | undefined {
  return (dict.eventos as Record<string, string>)[tipoEvento];
}

/**
 * Rótulo de exibição do tipo de documento. O valor vem de um input livre e há
 * registros gravados com espaço sobrando, então a busca é feita sobre o valor
 * aparado. Sem correspondência, devolve o próprio valor aparado — nunca some
 * informação que o usuário registrou.
 */
export function rotuloTipoDocumento(dict: Dictionary, tipoDocumento: string): string {
  const chave = tipoDocumento.trim();
  return (dict.tiposDocumento as Record<string, string>)[chave] ?? chave;
}

/** Rótulo de exibição da moeda; sem correspondência, o próprio símbolo. */
export function rotuloMoeda(dict: Dictionary, simbolo: string): string {
  return (dict.moedas as Record<string, string>)[simbolo] ?? simbolo;
}

export const pt: Dictionary = {
  nav: {
    brand: "Niara",
    product: "Register",
    pmes: "Registro PMEs",
    global: "Registro Global",
    assinatura: "Assinatura",
    languageLabel: "Idioma",
  },

  home: {
    eyebrow: "Niara Register",
    headlineLine1: "O livro de registros da Niara.",
    headlineLine2: "Aberto, verificável, imutável.",
    lede:
      "Cada transação e cada assinatura de documento dos produtos Niara fica registrada na blockchain e espelhada aqui — com o hash e o link para conferência independente no explorador da rede.",
    ctaPmes: "Consultar registro do Niara-PMEs",
    ctaAssinatura: "Verificar uma assinatura",
    cards: {
      pmes: {
        title: "Registro PMEs",
        text: "Transações reais da captação de PMEs, indexadas diretamente dos contratos na Sepolia.",
      },
      global: {
        title: "Registro Global",
        text: "Transações da Niara Exchange. A Exchange ainda não opera em produção — esta área abre vazia.",
      },
      assinatura: {
        title: "Assinatura de documentos",
        text: "Hash SHA-256 de documentos, ancorado on-chain como prova de autoria e integridade.",
      },
    },
  },

  pmes: {
    eyebrow: "Registro PMEs",
    title: "Transações do Niara-PMEs",
    lede:
      "Espelho das transações reais executadas nos contratos do Niara-PMEs na rede de testes Sepolia. Cada linha aponta para o hash verificável no Etherscan.",
    notaNumeracao:
      "A numeração segue a ordem em que o Register registrou cada evento. Eventos indexados retroativamente mantêm a data original on-chain.",
    vazio: "Nenhuma transação indexada ainda.",
    desconectado:
      "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de transações — significa que a leitura ainda não foi ligada.",
  },

  global: {
    eyebrow: "Registro Global",
    title: "Transações da Niara Exchange",
    lede: "Espelho das transações da Niara Exchange, quando em operação.",
    vazioTitulo: "Nenhuma transação registrada.",
    vazioTexto:
      "A Niara Exchange ainda não opera em produção — os contratos estão deployados e testados apenas localmente. Esta área será ligada ao indexador assim que houver transações reais na rede.",
  },

  assinatura: {
    eyebrow: "Assinatura de documentos",
    title: "Prove que um documento é original",
    lede:
      "Calcule o hash SHA-256 de um documento e registre-o on-chain como prova de existência e autoria. O documento nunca sai do seu navegador — só o hash é registrado.",
    contratoPrefixo: "O contrato de registro de assinaturas (",
    contratoSufixo:
      ") é o mesmo contrato na Ethereum Sepolia, na Base Sepolia e na Robinhood Chain Testnet. O hash é calculado no seu navegador e cada assinatura vira uma transação de verdade, verificável no explorador da rede: ",
    historicoTitulo: "Documentos já registrados",
    historicoLede:
      "Espelho de todos os documentos registrados na Ethereum Sepolia, na Base Sepolia, na Robinhood Chain Testnet e na Solana Devnet, mais recentes primeiro. Cada registro aponta para a transação no explorador da própria rede.",
    solanaPrefixo: "O programa na Solana (",
    solanaSufixo:
      ") segue as mesmas regras na devnet da Solana: um registro por hash, imutável, com o rent pago pela própria carteira de quem assina — a Niara nunca guarda o documento nem as chaves.",
    vazio: "Nenhum documento registrado ainda.",
    desconectado:
      "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de documentos — significa que a leitura ainda não foi ligada.",
  },

  verificador: {
    selecione: "Selecione um documento para calcular o hash",
    calculando: "Calculando hash...",
    arquivo: "Arquivo:",
    hashTitulo: "Hash SHA-256",
    hashExplicacao:
      "Este hash é calculado localmente, no seu navegador — o documento em si nunca é enviado. Para registrar esta prova on-chain, você assina com uma carteira de autocustódia na rede selecionada acima.",
    jaRegistrado: "já registrado on-chain",
    assinadoPor: "assinado por",
    assinadoEm: "em",
    campoNome: "Nome do documento",
    campoTipo: "Tipo de documento",
    placeholderNome: 'ex.: "Ata de reunião de sócios — 10/09/2026"',
    placeholderTipo: 'ex.: "ata", "contrato", "cap table"',
    conectar: "Conectar carteira",
    conectando: "Conectando...",
    verificandoBotao: "Verificando...",
    assinar: "Assinar e registrar on-chain",
    assinarBloqueado: "Preencha nome e tipo do documento antes de assinar",
    aguardando:
      "Aguardando confirmação na sua carteira e mineração da transação...",
    sucesso: "registrado on-chain com sucesso",
    carteiraConectada: "carteira conectada:",
    semCarteira:
      "Nenhuma carteira detectada. Instale a MetaMask (ou outra carteira compatível) para continuar.",
    erroConexao: "Não foi possível conectar a carteira.",
    erroRegistro: "Falha ao registrar o documento.",
    erroJaRegistrado:
      "Esse hash já foi registrado por outra transação enquanto você preenchia o formulário.",
    verNaSepolia: "ver na Sepolia",
    redeTitulo: "Rede",
    redeSepolia: "Ethereum Sepolia",
    redeSolana: "Solana Devnet",
    redeBase: "Base Sepolia",
    verNaBase: "ver no BaseScan",
    redeRobinhood: "Robinhood Chain Testnet",
    verNaRobinhood: "ver no Robinhood Explorer",
    carteiraSepolia: "MetaMask ou compatível",
    carteiraSolana: "Phantom ou Solflare",
    semCarteiraSolana:
      "Nenhuma carteira Solana detectada. Instale a Phantom (ou Solflare) para continuar.",
    limiteSolana:
      "Na Solana, o nome é limitado a 128 bytes e o tipo a 32 bytes.",
    verNaSolana: "ver no Solana Explorer",
    naoRegistrado: "ainda não registrado nesta rede",
    erroPhantom:
      "Não foi possível conectar à carteira Solana. Desbloqueie a Phantom (e termine a configuração, se ela for nova) e tente de novo.",
    conexaoRecusada: "O pedido de conexão foi recusado na carteira.",
  },

  frases: {
    offering_created:
      "Oferta {oferta} criada diretamente pelo emissor {emissor} — meta de {metaMinima} a {metaMaxima} {moeda}, {precoPorCota} {moeda} por cota, encerra em {prazo}",
    investment:
      "Investidor {investidor} aportou {valor} {moeda} na oferta {oferta}",
    offering_closed:
      "Oferta {oferta} {desfecho} — {totalArrecadado} {moeda} arrecadados",
    offering_cancelled: "Oferta {oferta} foi cancelada",
    shares_redeemed:
      "Investidor {investidor} resgatou {cotas} cotas na oferta {oferta}",
    funds_released:
      "{valorEmissor} {moeda} liberados ao emissor {emissor}, {taxa} {moeda} de taxa do protocolo ({protocolo}), na oferta {oferta}",
    refund:
      "Investidor {investidor} reembolsado em {valor} {moeda} na oferta {oferta}",
  },

  desfechos: {
    success: "encerrada com sucesso",
    failure: "encerrada sem atingir a meta",
    unknown: "encerrada com desfecho indeterminado",
  },

  entrada: {
    numeroPrefixo: "nº",
    confirmado: "confirmado on-chain",
    aguardandoConfirmacao: "aguardando confirmação",
    assinadoOnchain: "Assinado on-chain",
    pendente: "Aguardando confirmação",
    verNaSepolia: "ver na Sepolia",
    verNaSolana: "ver no Solana Explorer",
    verNaBase: "ver no BaseScan",
    verNaRobinhood: "ver no Robinhood Explorer",
    redeSepolia: "Ethereum Sepolia",
    redeSolana: "Solana Devnet",
    redeBase: "Base Sepolia",
    redeRobinhood: "Robinhood Chain Testnet",
    hash: "hash",
    assinante: "assinante",
  },

  eventos: {
    "Oferta criada": "Oferta criada",
    Aporte: "Aporte",
    "Oferta encerrada": "Oferta encerrada",
    "Oferta cancelada": "Oferta cancelada",
    "Resgate de cotas": "Resgate de cotas",
    "Recursos liberados": "Recursos liberados",
    Reembolso: "Reembolso",
    "Documento assinado": "Documento assinado",
  },

  carregando: "Carregando...",

  tiposDocumento: {
    NDA: "NDA",
    "Contrato de Locação": "Contrato de Locação",
    Ata: "Ata",
  },

  moedas: {
    mBRL: "MockBRL",
  },

  naoEncontrado: {
    titulo: "Página não encontrada",
    texto: "O endereço que você tentou não existe no Niara Register.",
    voltar: "Voltar para o início",
  },

  erro: {
    titulo: "Algo deu errado",
    texto:
      "Não foi possível carregar esta página. O registro em si está on-chain e não foi afetado — só esta visualização falhou.",
    tentar: "Tentar de novo",
  },

  meta: {
    titulo: "Niara Register",
    descricao:
      "Livro de registro de transações e assinaturas da Niara — provas on-chain, consultáveis e verificáveis.",
  },
};

export const dictionaries = { en, pt };
