/**
 * The site's visible text, in English and Portuguese.
 *
 * English is the default and is the source of the type: `Dictionary` is derived
 * from `en`, and `pt` must satisfy that type. Any key missing from or extra in
 * `pt` becomes a compile error, so the two languages cannot drift apart
 * silently.
 *
 * No visible text outside this file. The Portuguese copy is the product's
 * Brazilian UI and stays in Portuguese.
 */

export const en = {
  nav: {
    brand: "Niara",
    product: "Register",
    pmes: "SME Registry",
    global: "Global Registry",
    signing: "Document Signing",
    languageLabel: "Language",
  },

  home: {
    eyebrow: "Niara Register",
    headlineLine1: "The Niara ledger.",
    headlineLine2: "Open, verifiable, immutable.",
    lede:
      "Every transaction and every document signature across Niara's products is recorded on the blockchain and mirrored here — with the hash and the link for independent verification on the block explorer.",
    ctaPmes: "View the Niara-SMEs registry",
    ctaSigning: "Verify a signature",
    cards: {
      pmes: {
        title: "SME Registry",
        text: "Actual transactions from the SME offerings, indexed directly from the contracts on Sepolia and the program on Solana Devnet.",
      },
      global: {
        title: "Global Registry",
        text: "Transactions from the Niara Exchange. The Exchange is not yet in production — this section opens empty.",
      },
      signing: {
        title: "Document Signing",
        text: "SHA-256 document hashes, anchored on-chain as proof of authorship and integrity.",
      },
    },
  },

  pmes: {
    eyebrow: "SME Registry",
    title: "Niara-SMEs transactions",
    lede:
      "A mirror of the transactions executed on the Niara-SMEs contracts on the Sepolia test network and on the niara-pmes-solana program on Solana Devnet. Each entry shows its network and points to the transaction on that network's explorer.",
    numberingNote:
      "Entries are numbered in the order the Register recorded them. Events indexed retroactively keep their original on-chain date.",
    empty: "No transactions indexed yet.",
    disconnected:
      "The indexer is not connected to a Postgres database on this instance. This does not mean there are no transactions — it means the read path has not been switched on yet.",
  },

  global: {
    eyebrow: "Global Registry",
    title: "Niara Exchange transactions",
    lede: "A mirror of Niara Exchange transactions, once it is operating.",
    emptyTitle: "No transactions recorded.",
    emptyText:
      "The Niara Exchange is not yet in production — the contracts are deployed and tested locally only. This section will be connected to the indexer as soon as there are real transactions on the network.",
  },

  signing: {
    eyebrow: "Document Signing",
    title: "Prove that a document is authentic",
    lede:
      "Compute a document's SHA-256 hash and record it on-chain as proof of existence and authorship. The document never leaves your browser — only the hash is recorded.",
    contractPrefix: "The signature registry contract (",
    contractSuffix:
      ") is the same contract on Ethereum Sepolia, Base Sepolia, Robinhood Chain Testnet, HyperEVM Testnet and Tempo Testnet. The hash is computed in your browser and each signature becomes a real transaction, verifiable on the network's explorer: ",
    historyTitle: "Documents already recorded",
    historyLede:
      "A mirror of every document recorded on Ethereum Sepolia, Base Sepolia, Robinhood Chain Testnet, HyperEVM Testnet, Tempo Testnet and Solana Devnet, most recent first. Each entry links to its transaction on the network's own block explorer — except HyperEVM Testnet, which has no working public explorer: there the link opens a page that reads the transaction live from the network's official RPC.",
    hyperEvmReader: "HyperEVM (read from RPC)",
    solanaPrefix: "The Solana program (",
    solanaSuffix:
      ") follows the same rules on Solana devnet: one record per hash, immutable, with rent paid by the signer's own wallet — Niara never holds the document or the keys.",
    empty: "No documents recorded yet.",
    disconnected:
      "The indexer is not connected to a Postgres database on this instance. This does not mean there are no documents — it means the read path has not been switched on yet.",
  },

  verifier: {
    selectPrompt: "Select a document to compute its hash",
    computing: "Computing hash...",
    file: "File:",
    hashTitle: "SHA-256 hash",
    hashExplanation:
      "This hash is computed locally, in your browser — the document itself is never uploaded. To record this proof on-chain you sign with a self-custody wallet on the network selected above.",
    alreadyRecorded: "already recorded on-chain",
    signedBy: "signed by",
    signedOn: "on",
    nameField: "Document name",
    typeField: "Document type",
    namePlaceholder: 'e.g. "Shareholders meeting minutes — 09/10/2026"',
    typePlaceholder: 'e.g. "minutes", "agreement", "cap table"',
    connect: "Connect wallet",
    connecting: "Connecting...",
    checkingButton: "Checking...",
    sign: "Sign and record on-chain",
    signBlocked: "Fill in the document name and type before signing",
    waiting:
      "Waiting for confirmation in your wallet and for the transaction to be mined...",
    success: "recorded on-chain successfully",
    connectedWallet: "connected wallet:",
    noWallet:
      "No wallet detected. Install MetaMask (or another compatible wallet) to continue.",
    connectionError: "Could not connect the wallet.",
    recordError: "Failed to record the document.",
    alreadyRecordedError:
      "That hash was recorded by another transaction while you were filling in the form.",
    viewOnSepolia: "view on Sepolia",
    networkTitle: "Network",
    networkSepolia: "Ethereum Sepolia",
    networkSolana: "Solana Devnet",
    networkBase: "Base Sepolia",
    viewOnBase: "view on BaseScan",
    networkRobinhood: "Robinhood Chain Testnet",
    viewOnRobinhood: "view on Robinhood Explorer",
    networkHyperEvm: "HyperEVM Testnet",
    viewOnHyperEvm: "verify on-chain",
    networkTempo: "Tempo Testnet",
    viewOnTempo: "view on Tempo Explorer",
    walletEvm: "MetaMask or compatible",
    walletSolana: "Phantom or Solflare",
    noSolanaWallet:
      "No Solana wallet detected. Install Phantom (or Solflare) to continue.",
    solanaLimit:
      "On Solana the name is limited to 128 bytes and the type to 32 bytes.",
    viewOnSolana: "view on Solana Explorer",
    notRecorded: "not recorded on this network yet",
    phantomError:
      "Could not connect to the Solana wallet. Unlock Phantom (and finish its setup, if it is new), then try again.",
    connectionRejected: "The connection request was rejected in the wallet.",
  },

  /**
   * Sentence for each event, built from the `dados` column. The {key}
   * placeholders are replaced at display time: addresses become a truncated
   * link to the explorer, the rest goes in as text.
   */
  phrases: {
    offering_created:
      "Offering {offering} created directly by issuer {issuer} — target {minTarget} to {maxTarget} {currency}, {pricePerShare} {currency} per share, closes {deadline}",
    investment:
      "Investor {investor} invested {amount} {currency} in offering {offering}",
    offering_closed:
      "Offering {offering} {outcome} — {totalRaised} {currency} raised",
    offering_cancelled: "Offering {offering} was cancelled",
    shares_redeemed:
      "Investor {investor} redeemed {shares} shares in offering {offering}",
    funds_released:
      "{issuerAmount} {currency} released to issuer {issuer}, {fee} {currency} protocol fee ({protocol}), in offering {offering}",
    refund:
      "Investor {investor} refunded {amount} {currency} in offering {offering}",
  },

  // A whole verb phrase, not an adjective: the two languages phrase the
  // closing too differently for a single template.
  outcomes: {
    success: "closed successfully",
    failure: "closed without reaching its target",
    unknown: "closed with an undetermined outcome",
  },

  entry: {
    numberPrefix: "no.",
    confirmed: "confirmed on-chain",
    awaitingConfirmation: "awaiting confirmation",
    // the signature status is another database field ("assinado_onchain" |
    // "pendente"), with its own glossary terms
    signedOnchain: "Signed on-chain",
    // the key mirrors the database value "pendente"; the label is the chosen text
    pending: "Awaiting confirmation",
    viewOnSepolia: "view on Sepolia",
    viewOnSolana: "view on Solana Explorer",
    viewOnBase: "view on BaseScan",
    viewOnRobinhood: "view on Robinhood Explorer",
    viewOnHyperEvm: "verify on-chain",
    networkHyperEvm: "HyperEVM Testnet",
    viewOnTempo: "view on Tempo Explorer",
    networkTempo: "Tempo Testnet",
    networkSepolia: "Ethereum Sepolia",
    networkSolana: "Solana Devnet",
    networkBase: "Base Sepolia",
    networkRobinhood: "Robinhood Chain Testnet",
    hash: "hash",
    signer: "signer",
  },

  /**
   * Label per event type. The indexer stores `tipo_evento` and `descricao` in
   * Portuguese in Postgres (existing data), so the label comes from here, keyed
   * by `tipo_evento`, and `descricao` only shows as a fallback.
   */
  events: {
    "Oferta criada": "Offering created",
    Aporte: "Investment",
    "Oferta encerrada": "Offering closed",
    "Oferta cancelada": "Offering cancelled",
    "Resgate de cotas": "Shares redeemed",
    "Recursos liberados": "Funds released",
    Reembolso: "Refund",
    "Documento assinado": "Document signed",
  },

  loading: "Loading...",

  /**
   * Label per document type, for display ONLY. The field is free text in the
   * form, so this map covers the values in use; any new value shows as it was
   * typed. What is recorded on-chain never changes.
   */
  documentTypes: {
    NDA: "NDA",
    "Contrato de Locação": "Lease Agreement",
    Ata: "Minutes",
  },

  /**
   * Display label of the currency, by the symbol() the indexer stores in
   * `dados`. The test token is called "mBRL" on-chain; on screen it shows as
   * "MockBRL", so there is no doubt it is not real. A symbol outside the map
   * shows as it came.
   */
  currencies: {
    mBRL: "MockBRL",
  },

  explorer: {
    eyebrowTx: "Transaction",
    eyebrowAddress: "Address",
    sourcePrefix: "Read live from the official RPC of ",
    sourceSuffix:
      " when this page loaded — not from Niara's database. Anyone can repeat the same query (see below).",
    status: "Status",
    success: "Success",
    reverted: "Reverted — nothing was recorded",
    pending: "Pending — not yet included in a block",
    block: "Block",
    confirmations: "confirmations",
    blockTime: "Block time",
    from: "From (signer)",
    to: "To",
    niaraContract: "Niara Register contract",
    createdContract: "Contract created",
    gasUsed: "Gas used",
    recordTitle: "Document recorded — DocumentoRegistrado event",
    document: "Document",
    type: "Type",
    documentHash: "SHA-256 hash",
    signer: "Signer",
    recordedAt: "Recorded at",
    checkTitle: "Checked now on the contract — verificar(hash)",
    matches:
      "The contract confirms this record: same hash, signer and timestamp. It cannot be changed or overwritten.",
    mismatch:
      "The contract currently returns different data for this hash than the event above.",
    checkFailed:
      "The RPC did not answer the verificar(hash) call just now. The event above is still on-chain; reload to try again.",
    noRecord:
      "This transaction did not emit a DocumentoRegistrado event from the Niara Register contract.",
    deployText:
      "Deployment of the Niara Register contract (RegistroAssinaturas) on this network.",
    notFoundTitle: "Transaction not found",
    notFoundText:
      "The network's RPC does not know this transaction hash. Check the hash and the network.",
    rpcTitle: "The network did not answer",
    rpcText:
      "The official RPC is unavailable or rate-limited right now. Nothing is wrong with the record — reload in a few seconds.",
    accountType: "Type",
    contractAccount: "Contract",
    plainAccount: "Account (no code)",
    codeSize: "Bytecode size",
    bytes: "bytes",
    nonce: "Transactions sent (nonce)",
    deployTx: "Deployment transaction",
    recordsTitle: "Documents recorded on this network",
    recordsLede:
      "From the Niara Register indexer (mirror of the contract's events). Each one opens the transaction read live from the RPC.",
    checkYourselfTitle: "Check it yourself",
    checkYourselfText: "The same data, straight from the network, with no Niara code in between:",
    back: "Back to Document Signing",
  },

  notFound: {
    title: "Page not found",
    text: "The address you tried does not exist in the Niara Register.",
    back: "Back to home",
  },

  error: {
    title: "Something went wrong",
    text:
      "We could not load this page. The record itself is on-chain and unaffected — only this view failed.",
    retry: "Try again",
  },

  meta: {
    title: "Niara Register",
    description:
      "Niara's ledger of transactions and signatures — on-chain proofs, queryable and verifiable.",
  },
};

/**
 * The type comes from English, the default. No `as const` on purpose: with it
 * the values would become literal types and Portuguese would never satisfy the
 * type.
 */
export type Dictionary = typeof en;

/**
 * `tipo_evento` comes from the database as a free string, so the lookup needs
 * dynamic access. It is isolated here so the dictionary keeps strictly typed
 * keys: if a language forgets an event, the build complains.
 */
export function eventLabel(dict: Dictionary, eventType: string): string | undefined {
  return (dict.events as Record<string, string>)[eventType];
}

/**
 * Display label of the document type. The value comes from a free input and
 * some records were stored with extra spaces, so the lookup uses the trimmed
 * value. With no match, it returns the trimmed value itself: information the
 * user recorded never disappears.
 */
export function documentTypeLabel(dict: Dictionary, documentType: string): string {
  const key = documentType.trim();
  return (dict.documentTypes as Record<string, string>)[key] ?? key;
}

/** Display label of the currency; with no match, the symbol itself. */
export function currencyLabel(dict: Dictionary, symbol: string): string {
  return (dict.currencies as Record<string, string>)[symbol] ?? symbol;
}

export const pt: Dictionary = {
  nav: {
    brand: "Niara",
    product: "Register",
    pmes: "Registro PMEs",
    global: "Registro Global",
    signing: "Assinatura",
    languageLabel: "Idioma",
  },

  home: {
    eyebrow: "Niara Register",
    headlineLine1: "O livro de registros da Niara.",
    headlineLine2: "Aberto, verificável, imutável.",
    lede:
      "Cada transação e cada assinatura de documento dos produtos Niara fica registrada na blockchain e espelhada aqui — com o hash e o link para conferência independente no explorador da rede.",
    ctaPmes: "Consultar registro do Niara-PMEs",
    ctaSigning: "Verificar uma assinatura",
    cards: {
      pmes: {
        title: "Registro PMEs",
        text: "Transações reais da captação de PMEs, indexadas diretamente dos contratos na Sepolia e do programa na Solana Devnet.",
      },
      global: {
        title: "Registro Global",
        text: "Transações da Niara Exchange. A Exchange ainda não opera em produção — esta área abre vazia.",
      },
      signing: {
        title: "Assinatura de documentos",
        text: "Hash SHA-256 de documentos, ancorado on-chain como prova de autoria e integridade.",
      },
    },
  },

  pmes: {
    eyebrow: "Registro PMEs",
    title: "Transações do Niara-PMEs",
    lede:
      "Espelho das transações reais executadas nos contratos do Niara-PMEs na rede de testes Sepolia e no programa niara-pmes-solana na Solana Devnet. Cada linha mostra a rede e aponta para a transação no explorador dela.",
    numberingNote:
      "A numeração segue a ordem em que o Register registrou cada evento. Eventos indexados retroativamente mantêm a data original on-chain.",
    empty: "Nenhuma transação indexada ainda.",
    disconnected:
      "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de transações — significa que a leitura ainda não foi ligada.",
  },

  global: {
    eyebrow: "Registro Global",
    title: "Transações da Niara Exchange",
    lede: "Espelho das transações da Niara Exchange, quando em operação.",
    emptyTitle: "Nenhuma transação registrada.",
    emptyText:
      "A Niara Exchange ainda não opera em produção — os contratos estão deployados e testados apenas localmente. Esta área será ligada ao indexador assim que houver transações reais na rede.",
  },

  signing: {
    eyebrow: "Assinatura de documentos",
    title: "Prove que um documento é original",
    lede:
      "Calcule o hash SHA-256 de um documento e registre-o on-chain como prova de existência e autoria. O documento nunca sai do seu navegador — só o hash é registrado.",
    contractPrefix: "O contrato de registro de assinaturas (",
    contractSuffix:
      ") é o mesmo contrato na Ethereum Sepolia, na Base Sepolia, na Robinhood Chain Testnet, na HyperEVM Testnet e na Tempo Testnet. O hash é calculado no seu navegador e cada assinatura vira uma transação de verdade, verificável no explorador da rede: ",
    historyTitle: "Documentos já registrados",
    historyLede:
      "Espelho de todos os documentos registrados na Ethereum Sepolia, na Base Sepolia, na Robinhood Chain Testnet, na HyperEVM Testnet, na Tempo Testnet e na Solana Devnet, mais recentes primeiro. Cada registro aponta para a transação no explorador da própria rede — menos na HyperEVM Testnet, que não tem explorador público funcionando: lá o link abre uma página que lê a transação na hora, direto do RPC oficial da rede.",
    hyperEvmReader: "HyperEVM (lido do RPC)",
    solanaPrefix: "O programa na Solana (",
    solanaSuffix:
      ") segue as mesmas regras na devnet da Solana: um registro por hash, imutável, com o rent pago pela própria carteira de quem assina — a Niara nunca guarda o documento nem as chaves.",
    empty: "Nenhum documento registrado ainda.",
    disconnected:
      "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de documentos — significa que a leitura ainda não foi ligada.",
  },

  verifier: {
    selectPrompt: "Selecione um documento para calcular o hash",
    computing: "Calculando hash...",
    file: "Arquivo:",
    hashTitle: "Hash SHA-256",
    hashExplanation:
      "Este hash é calculado localmente, no seu navegador — o documento em si nunca é enviado. Para registrar esta prova on-chain, você assina com uma carteira de autocustódia na rede selecionada acima.",
    alreadyRecorded: "já registrado on-chain",
    signedBy: "assinado por",
    signedOn: "em",
    nameField: "Nome do documento",
    typeField: "Tipo de documento",
    namePlaceholder: 'ex.: "Ata de reunião de sócios — 10/09/2026"',
    typePlaceholder: 'ex.: "ata", "contrato", "cap table"',
    connect: "Conectar carteira",
    connecting: "Conectando...",
    checkingButton: "Verificando...",
    sign: "Assinar e registrar on-chain",
    signBlocked: "Preencha nome e tipo do documento antes de assinar",
    waiting:
      "Aguardando confirmação na sua carteira e mineração da transação...",
    success: "registrado on-chain com sucesso",
    connectedWallet: "carteira conectada:",
    noWallet:
      "Nenhuma carteira detectada. Instale a MetaMask (ou outra carteira compatível) para continuar.",
    connectionError: "Não foi possível conectar a carteira.",
    recordError: "Falha ao registrar o documento.",
    alreadyRecordedError:
      "Esse hash já foi registrado por outra transação enquanto você preenchia o formulário.",
    viewOnSepolia: "ver na Sepolia",
    networkTitle: "Rede",
    networkSepolia: "Ethereum Sepolia",
    networkSolana: "Solana Devnet",
    networkBase: "Base Sepolia",
    viewOnBase: "ver no BaseScan",
    networkRobinhood: "Robinhood Chain Testnet",
    viewOnRobinhood: "ver no Robinhood Explorer",
    networkHyperEvm: "HyperEVM Testnet",
    viewOnHyperEvm: "verificar on-chain",
    networkTempo: "Tempo Testnet",
    viewOnTempo: "ver no Tempo Explorer",
    walletEvm: "MetaMask ou compatível",
    walletSolana: "Phantom ou Solflare",
    noSolanaWallet:
      "Nenhuma carteira Solana detectada. Instale a Phantom (ou Solflare) para continuar.",
    solanaLimit:
      "Na Solana, o nome é limitado a 128 bytes e o tipo a 32 bytes.",
    viewOnSolana: "ver no Solana Explorer",
    notRecorded: "ainda não registrado nesta rede",
    phantomError:
      "Não foi possível conectar à carteira Solana. Desbloqueie a Phantom (e termine a configuração, se ela for nova) e tente de novo.",
    connectionRejected: "O pedido de conexão foi recusado na carteira.",
  },

  phrases: {
    offering_created:
      "Oferta {offering} criada diretamente pelo emissor {issuer} — meta de {minTarget} a {maxTarget} {currency}, {pricePerShare} {currency} por cota, encerra em {deadline}",
    investment:
      "Investidor {investor} aportou {amount} {currency} na oferta {offering}",
    offering_closed:
      "Oferta {offering} {outcome} — {totalRaised} {currency} arrecadados",
    offering_cancelled: "Oferta {offering} foi cancelada",
    shares_redeemed:
      "Investidor {investor} resgatou {shares} cotas na oferta {offering}",
    funds_released:
      "{issuerAmount} {currency} liberados ao emissor {issuer}, {fee} {currency} de taxa do protocolo ({protocol}), na oferta {offering}",
    refund:
      "Investidor {investor} reembolsado em {amount} {currency} na oferta {offering}",
  },

  outcomes: {
    success: "encerrada com sucesso",
    failure: "encerrada sem atingir a meta",
    unknown: "encerrada com desfecho indeterminado",
  },

  entry: {
    numberPrefix: "nº",
    confirmed: "confirmado on-chain",
    awaitingConfirmation: "aguardando confirmação",
    signedOnchain: "Assinado on-chain",
    pending: "Aguardando confirmação",
    viewOnSepolia: "ver na Sepolia",
    viewOnSolana: "ver no Solana Explorer",
    viewOnBase: "ver no BaseScan",
    viewOnRobinhood: "ver no Robinhood Explorer",
    viewOnHyperEvm: "verificar on-chain",
    networkHyperEvm: "HyperEVM Testnet",
    viewOnTempo: "ver no Tempo Explorer",
    networkTempo: "Tempo Testnet",
    networkSepolia: "Ethereum Sepolia",
    networkSolana: "Solana Devnet",
    networkBase: "Base Sepolia",
    networkRobinhood: "Robinhood Chain Testnet",
    hash: "hash",
    signer: "assinante",
  },

  events: {
    "Oferta criada": "Oferta criada",
    Aporte: "Aporte",
    "Oferta encerrada": "Oferta encerrada",
    "Oferta cancelada": "Oferta cancelada",
    "Resgate de cotas": "Resgate de cotas",
    "Recursos liberados": "Recursos liberados",
    Reembolso: "Reembolso",
    "Documento assinado": "Documento assinado",
  },

  loading: "Carregando...",

  documentTypes: {
    NDA: "NDA",
    "Contrato de Locação": "Contrato de Locação",
    Ata: "Ata",
  },

  currencies: {
    mBRL: "MockBRL",
  },

  explorer: {
    eyebrowTx: "Transação",
    eyebrowAddress: "Endereço",
    sourcePrefix: "Lido na hora do RPC oficial da ",
    sourceSuffix:
      " quando esta página carregou — não do banco da Niara. Qualquer pessoa pode repetir a mesma consulta (veja abaixo).",
    status: "Status",
    success: "Sucesso",
    reverted: "Revertida — nada foi registrado",
    pending: "Pendente — ainda não incluída em um bloco",
    block: "Bloco",
    confirmations: "confirmações",
    blockTime: "Data do bloco",
    from: "De (quem assinou)",
    to: "Para",
    niaraContract: "contrato do Niara Register",
    createdContract: "Contrato criado",
    gasUsed: "Gás usado",
    recordTitle: "Documento registrado — evento DocumentoRegistrado",
    document: "Documento",
    type: "Tipo",
    documentHash: "Hash SHA-256",
    signer: "Assinante",
    recordedAt: "Registrado em",
    checkTitle: "Conferido agora no contrato — verificar(hash)",
    matches:
      "O contrato confirma este registro: mesmo hash, mesmo assinante e mesma data. Ele não pode ser alterado nem sobrescrito.",
    mismatch:
      "O contrato devolve hoje dados diferentes do evento acima para este hash.",
    checkFailed:
      "O RPC não respondeu à chamada verificar(hash) agora. O evento acima continua on-chain; recarregue para tentar de novo.",
    noRecord:
      "Esta transação não emitiu o evento DocumentoRegistrado do contrato do Niara Register.",
    deployText:
      "Deploy do contrato do Niara Register (RegistroAssinaturas) nesta rede.",
    notFoundTitle: "Transação não encontrada",
    notFoundText:
      "O RPC da rede não conhece este hash de transação. Confira o hash e a rede.",
    rpcTitle: "A rede não respondeu",
    rpcText:
      "O RPC oficial está indisponível ou limitando requisições agora. Não há nada de errado com o registro — recarregue em alguns segundos.",
    accountType: "Tipo",
    contractAccount: "Contrato",
    plainAccount: "Conta (sem código)",
    codeSize: "Tamanho do bytecode",
    bytes: "bytes",
    nonce: "Transações enviadas (nonce)",
    deployTx: "Transação de deploy",
    recordsTitle: "Documentos registrados nesta rede",
    recordsLede:
      "Do indexador do Niara Register (espelho dos eventos do contrato). Cada um abre a transação lida na hora do RPC.",
    checkYourselfTitle: "Confira você mesmo",
    checkYourselfText: "Os mesmos dados, direto da rede, sem nenhum código da Niara no meio:",
    back: "Voltar para Assinatura de documentos",
  },

  notFound: {
    title: "Página não encontrada",
    text: "O endereço que você tentou não existe no Niara Register.",
    back: "Voltar para o início",
  },

  error: {
    title: "Algo deu errado",
    text:
      "Não foi possível carregar esta página. O registro em si está on-chain e não foi afetado — só esta visualização falhou.",
    retry: "Tentar de novo",
  },

  meta: {
    title: "Niara Register",
    description:
      "Livro de registro de transações e assinaturas da Niara — provas on-chain, consultáveis e verificáveis.",
  },
};

export const dictionaries = { en, pt };
