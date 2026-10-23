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
    verify: "Verify",
    transferable: "Transferable Records",
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
      "Sign a PDF with your ICP-Brasil certificate (PAdES) or register any file, and record its fingerprint on-chain. You receive a non-transferable receipt in your wallet and a proof package with a W3C verifiable credential. The document never leaves your browser.",
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
    historyV2Title: "Registered documents",
    historyV2Lede:
      "Records from the current registry: only the fingerprint, the hash scheme and the receipt are public. Names and types stay with each holder.",
    privateDocument: "Private document",
    privateName: "name private",
    receiptLabel: "receipt",
    verifyLabel: "verify",
    legacyHistoryTitle: "Previous version (name and type public)",
    disconnected:
      "The indexer is not connected to a Postgres database on this instance. This does not mean there are no documents — it means the read path has not been switched on yet.",
  },

  register: {
    networkTitle: "Network",
    modeTitle: "Document",
    modeSign: "Sign a PDF with ICP-Brasil",
    modeSignHint: "PAdES signature made in your browser with your A1 or A3 certificate",
    modeSigned: "PDF already signed",
    modeSignedHint: "A PDF that already carries PAdES signatures",
    modeOther: "Any other file",
    modeOtherHint: "Recorded with a private salt; no digital signature inside",
    choosePdf: "Choose the PDF",
    chooseFile: "Choose the file",
    computing: "Reading the file in your browser...",
    file: "File:",
    privacyNote:
      "Nothing is uploaded: the file stays in your browser. On-chain only the fingerprint goes, plus a commitment to the name and type that cannot be read without your salt.",
    alreadyHint: "Registered this file before? Its proof package is the only way to find that record.",
    alreadyHintLink: "check it on Verify",
    seenHere: "This file was already registered from this browser:",
    seenHereSalted:
      "Registering it again creates a new, independent record with a new salt. The first record is still the proof that counts.",
    metaTitle: "Document",
    metaHint:
      "The name stays private: only a salted commitment to it goes on-chain, and it goes into your proof package so you can prove it later. The type is public and appears in the registry.",
    nameField: "Document name (private)",
    typeField: "Document type (public)",
    namePlaceholder: 'e.g. "Shareholders meeting minutes — 09/10/2026"',
    typePlaceholder: "Choose the type",
    nameTypeRequired: "Fill in the name and choose the type to register.",
    recordHashTitle: "Record hash (what goes on-chain)",
    schemeSigned: "SHA-256 of the signed PDF. Its signature makes it impossible to guess from a template.",
    schemeSalted: "SHA-256 of salt + file hash. Without your salt nobody can link it to the file.",
    connect: "Connect wallet",
    connecting: "Connecting...",
    checking: "Checking the network...",
    register: "Register and receive the receipt",
    waiting: "Confirm in your wallet and wait for the transaction...",
    connectedWallet: "Connected wallet:",
    alreadyRecorded: "This record already exists on this network.",
    alreadyRecordedV1: "This file was recorded with the previous version of the Register (name and type public).",
    notDeployed:
      "The new registry is not deployed on this network yet. Choose another network or wait for the deploy.",
    noReceiptConfig: "Receipts are not configured on Solana yet.",
    noWallet: "No EVM wallet detected. Install MetaMask (or a compatible wallet).",
    wrongNetwork:
      "Your wallet is on another network (chain id {chain}) and did not switch. Switch it to the network chosen above (if more than one wallet is installed, check which one answered) and try again.",
    contractNotOnWallet:
      "Your wallet's connection does not see the registry on this network. Check the network's RPC in the wallet and try again.",
    noSolanaWallet: "No Solana wallet detected. Install Phantom (or Solflare).",
    walletEvm: "MetaMask or compatible",
    walletSolana: "Phantom or Solflare",
    rejected: "The request was rejected in the wallet.",
    error: "Could not register the document.",
    success: "Registered. The receipt is in your wallet.",
    receiptEvm: "Soulbound receipt (ERC-721 + ERC-5192), token id",
    receiptSolana: "Soulbound receipt (compressed NFT, frozen collection), asset id",
    receiptWalletNote:
      "It shows in wallets that list NFTs (on Solana, only with an RPC that supports the DAS API). It cannot be transferred, not even by you.",
    viewTx: "view transaction",
    verifyLink: "open the verification page",
    networks: {
      sepolia: "Ethereum Sepolia",
      "base-sepolia": "Base Sepolia",
      "robinhood-testnet": "Robinhood Chain Testnet",
      "hyperevm-testnet": "HyperEVM Testnet",
      "tempo-testnet": "Tempo Testnet",
      "solana-devnet": "Solana Devnet",
    },
  },

  pades: {
    sourceTitle: "Certificate",
    sourceA1: "A1 file (.pfx / .p12)",
    sourceA3: "A3 token or installed certificate",
    sourceA3Hint: "Uses the Web PKI component (free on localhost; production needs a Lacuna license).",
    pfxFile: "Certificate file",
    password: "Password",
    open: "Open certificate",
    opening: "Opening...",
    wrongPassword: "Wrong password, or the file is not a certificate.",
    listA3: "List certificates",
    listing: "Looking for certificates...",
    webPkiMissing: "The Web PKI component is not installed.",
    installWebPki: "Install Web PKI",
    noCertificates: "No certificate found.",
    icpBadge: "ICP-Brasil",
    signerLabel: "Signer:",
    validUntil: "valid until",
    reason: "Reason (optional, goes inside the signature)",
    sign: "Sign PDF",
    signing: "Signing in your browser...",
    signed: "PDF signed. Download it: the file you keep is the one registered.",
    download: "Download signed PDF",
    signError: "Could not sign the PDF.",
    keyNote:
      "Your private key never leaves your computer: the A1 file is opened only in this tab and the A3 key stays in the token.",
    policyNote:
      "Policy ICP-Brasil PA_PAdES_AD_RB_v1_3 (no timestamp). Adobe Acrobat lists this signature type as unknown; check it on the ITI verifier.",
    reportTitle: "Signatures in this PDF",
    noSignatures: "This PDF has no digital signatures.",
    valid: "valid",
    invalid: "INVALID",
    modified: "file changed after this signature",
    coversAll: "covers the whole file",
    chainIcp: "chains to",
    chainIncomplete: "chain not included in the file",
    chainUntrusted: "does not chain to ICP-Brasil",
    policy: "policy",
    noPolicy: "no ICP-Brasil policy declared",
    revocationNote:
      "Revocation (CRL/OCSP) is not checked here. For the official validation use the ITI verifier:",
    itiLink: "validar.iti.gov.br",
  },

  proof: {
    title: "Proof package",
    lede:
      "Niara keeps no copy of your document, salt or name. Everything needed to prove this record later goes into this package — save it with the file.",
    saltWarning:
      "Without this package a salted record cannot be re-verified: the salt exists only here.",
    issue: "Get verifiable credential (W3C VC 2.0)",
    issuing: "Issuing...",
    issued: "Credential issued by Niara (did:web), signed with JOSE.",
    issuerDown: "The credential issuer is not configured on this instance.",
    issueError: "Could not issue the credential.",
    present: "Sign a presentation with your wallet",
    presenting: "Waiting for the wallet signature...",
    presented: "Presentation signed by your wallet.",
    presentEvmNote:
      "On EVM the presentation is signed with EIP-712 (EthereumEip712Signature2021, a W3C CCG draft, not a W3C Recommendation).",
    download: "Download proof package (.json)",
    downloadPdf: "Download signed PDF again",
  },

  verify: {
    eyebrow: "Verification",
    title: "Verify a record",
    lede:
      "Check a document against what is on-chain. Everything runs in your browser: the file and the proof package are not uploaded.",
    hashField: "Record hash",
    networkField: "Network",
    go: "Look up",
    invalidHash: "Enter a 64-hex-digit hash.",
    recordTitle: "On-chain record",
    notFound: "No record with this hash on this network.",
    notDeployed: "The new registry is not deployed on this network yet.",
    rpcDown: "Could not read the network right now. Try again in a moment.",
    signer: "Signer",
    registeredAt: "Registered at",
    scheme: "Hash scheme",
    schemeSigned: "SHA-256 of a signed PDF",
    schemeSalted: "Salted SHA-256",
    documentType: "Document type",
    metadata: "Document name",
    metadataNone: "none committed",
    metadataPrivate: "private (revealed only by the proof package)",
    receipt: "Receipt",
    legacyTitle: "Record from the previous version",
    legacyNote: "Recorded before v2: name and type are public on-chain.",
    dropTitle: "Check your files",
    dropLede: "Drop the document and/or the proof package (.json). Nothing leaves your browser.",
    chooseFiles: "Choose files",
    fileMatches: "The document matches this record.",
    fileDoesNotMatch: "The document does NOT match this record.",
    needSalt: "This record is salted: add the proof package to check the document.",
    metaMatches: "Name and type match the on-chain commitment:",
    metaDoesNotMatch: "Name and type in the package do NOT match the on-chain commitment.",
    vcValid: "Credential signature valid, issued by",
    vcInvalid: "Credential signature INVALID:",
    vcMismatch: "The credential is about another record.",
    vpValid: "Presentation signed by the holder wallet",
    vpInvalid: "Presentation signature INVALID:",
    x5c: "The issuer attached a certificate chain (x5c).",
    issueFromPackage: "Get the verifiable credential for this package",
    issuingFromPackage: "Issuing...",
    issuedFromPackage: "Credential issued. Download the updated package and keep it instead of the old one.",
    downloadUpdated: "Download updated proof package (.json)",
  },

  etr: {
    eyebrow: "Transferable records",
    title: "Electronic transferable records",
    lede:
      "Promissory notes, bills of lading, warehouse receipts: documents whose holder has rights. The record exists once, is controlled by one wallet at a time, and passes from hand to hand on-chain.",
    mletrNote:
      "Designed to line up with the UNCITRAL Model Law on Electronic Transferable Records (MLETR): singularity, exclusive control, integrity, amendment, surrender and termination. MLETR only has legal effect where a country has enacted it, and Brazil has not: this is not a claim of legal compliance.",
    issueTitle: "Issue a record",
    documentFile: "Document (ideally the ICP-Brasil-signed PDF)",
    holder: "First holder (wallet address)",
    issue: "Issue",
    lookupTitle: "Open a record",
    originalHash: "Hash of the original document",
    open: "Open",
    notFound: "No transferable record with this hash on this network.",
    notDeployed: "Transferable records are not deployed on this network yet.",
    issuer: "Issuer",
    controller: "Person in control",
    version: "Version",
    status: "Status",
    statuses: { active: "active", surrendered: "surrendered", terminated: "terminated" },
    currentHash: "Current document hash",
    pending: "Pending amendment",
    actionsTitle: "What your wallet can do",
    noActions: "Connect the wallet that is the issuer or the person in control.",
    transferTo: "Transfer control to",
    transfer: "Transfer control",
    amendFile: "New version of the document",
    propose: "Propose amendment",
    cancel: "Cancel proposal",
    accept: "Accept amendment",
    surrender: "Surrender to the issuer",
    terminate: "Terminate",
    reasons: { 0: "fulfilled", 1: "replaced by paper", 2: "other" },
    done: "Done.",
    connectFirst: "Connect wallet",
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
    verify: "Verificar",
    transferable: "Registros Transferíveis",
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
      "Assine um PDF com seu certificado ICP-Brasil (PAdES) ou registre qualquer arquivo, e grave a impressão digital dele on-chain. Você recebe um recibo intransferível na carteira e um pacote de prova com uma credencial verificável W3C. O documento nunca sai do seu navegador.",
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
    historyV2Title: "Documentos registrados",
    historyV2Lede:
      "Registros do registro atual: só a impressão digital, o esquema do hash e o recibo são públicos. Nomes e tipos ficam com cada titular.",
    privateDocument: "Documento privado",
    privateName: "nome privado",
    receiptLabel: "recibo",
    verifyLabel: "verificar",
    legacyHistoryTitle: "Versão anterior (nome e tipo públicos)",
    disconnected:
      "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de documentos — significa que a leitura ainda não foi ligada.",
  },

  register: {
    networkTitle: "Rede",
    modeTitle: "Documento",
    modeSign: "Assinar um PDF com ICP-Brasil",
    modeSignHint: "Assinatura PAdES feita no seu navegador, com seu certificado A1 ou A3",
    modeSigned: "PDF já assinado",
    modeSignedHint: "Um PDF que já tem assinaturas PAdES",
    modeOther: "Outro arquivo",
    modeOtherHint: "Registrado com um salt privado; sem assinatura digital embutida",
    choosePdf: "Escolha o PDF",
    chooseFile: "Escolha o arquivo",
    computing: "Lendo o arquivo no seu navegador...",
    file: "Arquivo:",
    privacyNote:
      "Nada é enviado: o arquivo fica no seu navegador. On-chain vai só a impressão digital, mais um compromisso com o nome e o tipo que não pode ser lido sem o seu salt.",
    alreadyHint: "Já registrou este arquivo antes? O pacote de prova é a única forma de encontrar aquele registro.",
    alreadyHintLink: "confira em Verificar",
    seenHere: "Este arquivo já foi registrado a partir deste navegador:",
    seenHereSalted:
      "Registrar de novo cria um registro novo e independente, com outro salt. O primeiro registro continua sendo a prova que vale.",
    metaTitle: "Documento",
    metaHint:
      "O nome fica privado: só um compromisso com salt vai para a blockchain, e ele entra no seu pacote de prova para você provar depois. O tipo é público e aparece no registro.",
    nameField: "Nome do documento (privado)",
    typeField: "Tipo do documento (público)",
    namePlaceholder: 'ex.: "Ata de reunião de sócios — 10/09/2026"',
    typePlaceholder: "Escolha o tipo",
    nameTypeRequired: "Preencha o nome e escolha o tipo para registrar.",
    recordHashTitle: "Hash do registro (o que vai on-chain)",
    schemeSigned: "SHA-256 do PDF assinado. A assinatura torna impossível adivinhá-lo a partir de um modelo.",
    schemeSalted: "SHA-256 de salt + hash do arquivo. Sem o seu salt ninguém liga o registro ao arquivo.",
    connect: "Conectar carteira",
    connecting: "Conectando...",
    checking: "Consultando a rede...",
    register: "Registrar e receber o recibo",
    waiting: "Confirme na carteira e aguarde a transação...",
    connectedWallet: "Carteira conectada:",
    alreadyRecorded: "Este registro já existe nesta rede.",
    alreadyRecordedV1: "Este arquivo foi registrado na versão anterior do Register (nome e tipo públicos).",
    notDeployed:
      "O novo registro ainda não foi publicado nesta rede. Escolha outra rede ou aguarde o deploy.",
    noReceiptConfig: "Os recibos ainda não foram configurados na Solana.",
    noWallet: "Nenhuma carteira EVM detectada. Instale a MetaMask (ou uma carteira compatível).",
    wrongNetwork:
      "Sua carteira está em outra rede (chain id {chain}) e não trocou. Troque para a rede escolhida acima (se houver mais de uma carteira instalada, veja qual respondeu) e tente de novo.",
    contractNotOnWallet:
      "A conexão da sua carteira não enxerga o registro nesta rede. Confira o RPC da rede na carteira e tente de novo.",
    noSolanaWallet: "Nenhuma carteira Solana detectada. Instale a Phantom (ou a Solflare).",
    walletEvm: "MetaMask ou compatível",
    walletSolana: "Phantom ou Solflare",
    rejected: "A solicitação foi recusada na carteira.",
    error: "Não foi possível registrar o documento.",
    success: "Registrado. O recibo está na sua carteira.",
    receiptEvm: "Recibo intransferível (ERC-721 + ERC-5192), token id",
    receiptSolana: "Recibo intransferível (NFT comprimido, coleção congelada), asset id",
    receiptWalletNote:
      "Aparece nas carteiras que listam NFTs (na Solana, só com RPC que suporte a DAS API). Não pode ser transferido, nem por você.",
    viewTx: "ver transação",
    verifyLink: "abrir a página de verificação",
    networks: {
      sepolia: "Ethereum Sepolia",
      "base-sepolia": "Base Sepolia",
      "robinhood-testnet": "Robinhood Chain Testnet",
      "hyperevm-testnet": "HyperEVM Testnet",
      "tempo-testnet": "Tempo Testnet",
      "solana-devnet": "Solana Devnet",
    },
  },

  pades: {
    sourceTitle: "Certificado",
    sourceA1: "Arquivo A1 (.pfx / .p12)",
    sourceA3: "Token A3 ou certificado instalado",
    sourceA3Hint: "Usa o componente Web PKI (gratuito em localhost; em produção exige licença da Lacuna).",
    pfxFile: "Arquivo do certificado",
    password: "Senha",
    open: "Abrir certificado",
    opening: "Abrindo...",
    wrongPassword: "Senha incorreta, ou o arquivo não é um certificado.",
    listA3: "Listar certificados",
    listing: "Procurando certificados...",
    webPkiMissing: "O componente Web PKI não está instalado.",
    installWebPki: "Instalar o Web PKI",
    noCertificates: "Nenhum certificado encontrado.",
    icpBadge: "ICP-Brasil",
    signerLabel: "Signatário:",
    validUntil: "válido até",
    reason: "Motivo (opcional, vai dentro da assinatura)",
    sign: "Assinar PDF",
    signing: "Assinando no seu navegador...",
    signed: "PDF assinado. Baixe-o: o arquivo que você guarda é o que fica registrado.",
    download: "Baixar PDF assinado",
    signError: "Não foi possível assinar o PDF.",
    keyNote:
      "Sua chave privada nunca sai do seu computador: o arquivo A1 é aberto só nesta aba e a chave A3 fica no token.",
    policyNote:
      "Política ICP-Brasil PA_PAdES_AD_RB_v1_3 (sem carimbo do tempo). O Adobe Acrobat lista esse tipo de assinatura como desconhecido; confira no verificador do ITI.",
    reportTitle: "Assinaturas neste PDF",
    noSignatures: "Este PDF não tem assinaturas digitais.",
    valid: "válida",
    invalid: "INVÁLIDA",
    modified: "arquivo alterado depois desta assinatura",
    coversAll: "cobre o arquivo inteiro",
    chainIcp: "encadeia até a",
    chainIncomplete: "cadeia não incluída no arquivo",
    chainUntrusted: "não encadeia até a ICP-Brasil",
    policy: "política",
    noPolicy: "nenhuma política ICP-Brasil declarada",
    revocationNote:
      "A revogação (LCR/OCSP) não é verificada aqui. Para a validação oficial, use o verificador do ITI:",
    itiLink: "validar.iti.gov.br",
  },

  proof: {
    title: "Pacote de prova",
    lede:
      "A Niara não guarda cópia do seu documento, do salt nem do nome. Tudo o que é preciso para provar este registro depois vai neste pacote — guarde-o junto com o arquivo.",
    saltWarning:
      "Sem este pacote, um registro com salt não pode ser verificado de novo: o salt só existe aqui.",
    issue: "Obter credencial verificável (W3C VC 2.0)",
    issuing: "Emitindo...",
    issued: "Credencial emitida pela Niara (did:web), assinada com JOSE.",
    issuerDown: "O emissor de credenciais não está configurado nesta instância.",
    issueError: "Não foi possível emitir a credencial.",
    present: "Assinar uma apresentação com sua carteira",
    presenting: "Aguardando a assinatura na carteira...",
    presented: "Apresentação assinada pela sua carteira.",
    presentEvmNote:
      "Na EVM a apresentação é assinada com EIP-712 (EthereumEip712Signature2021, rascunho do W3C CCG, não uma Recomendação W3C).",
    download: "Baixar pacote de prova (.json)",
    downloadPdf: "Baixar o PDF assinado de novo",
  },

  verify: {
    eyebrow: "Verificação",
    title: "Verificar um registro",
    lede:
      "Confira um documento contra o que está on-chain. Tudo roda no seu navegador: o arquivo e o pacote de prova não são enviados.",
    hashField: "Hash do registro",
    networkField: "Rede",
    go: "Consultar",
    invalidHash: "Informe um hash de 64 dígitos hexadecimais.",
    recordTitle: "Registro on-chain",
    notFound: "Nenhum registro com este hash nesta rede.",
    notDeployed: "O novo registro ainda não foi publicado nesta rede.",
    rpcDown: "Não foi possível ler a rede agora. Tente de novo em instantes.",
    signer: "Signatário",
    registeredAt: "Registrado em",
    scheme: "Esquema do hash",
    schemeSigned: "SHA-256 de um PDF assinado",
    schemeSalted: "SHA-256 com salt",
    documentType: "Tipo do documento",
    metadata: "Nome do documento",
    metadataNone: "nenhum compromisso",
    metadataPrivate: "privado (revelado só pelo pacote de prova)",
    receipt: "Recibo",
    legacyTitle: "Registro da versão anterior",
    legacyNote: "Registrado antes da v2: nome e tipo são públicos on-chain.",
    dropTitle: "Confira seus arquivos",
    dropLede: "Solte o documento e/ou o pacote de prova (.json). Nada sai do seu navegador.",
    chooseFiles: "Escolher arquivos",
    fileMatches: "O documento corresponde a este registro.",
    fileDoesNotMatch: "O documento NÃO corresponde a este registro.",
    needSalt: "Este registro usa salt: adicione o pacote de prova para conferir o documento.",
    metaMatches: "Nome e tipo conferem com o compromisso on-chain:",
    metaDoesNotMatch: "Nome e tipo do pacote NÃO conferem com o compromisso on-chain.",
    vcValid: "Assinatura da credencial válida, emitida por",
    vcInvalid: "Assinatura da credencial INVÁLIDA:",
    vcMismatch: "A credencial é sobre outro registro.",
    vpValid: "Apresentação assinada pela carteira titular",
    vpInvalid: "Assinatura da apresentação INVÁLIDA:",
    x5c: "O emissor anexou uma cadeia de certificados (x5c).",
    issueFromPackage: "Obter a credencial verificável para este pacote",
    issuingFromPackage: "Emitindo...",
    issuedFromPackage: "Credencial emitida. Baixe o pacote atualizado e guarde-o no lugar do antigo.",
    downloadUpdated: "Baixar pacote de prova atualizado (.json)",
  },

  etr: {
    eyebrow: "Registros transferíveis",
    title: "Registros eletrônicos transferíveis",
    lede:
      "Notas promissórias, conhecimentos de embarque, certificados de depósito: documentos cujo portador tem direitos. O registro existe uma única vez, é controlado por uma carteira de cada vez e passa de mão em mão on-chain.",
    mletrNote:
      "Desenhado para seguir a Lei Modelo da UNCITRAL sobre Registros Eletrônicos Transferíveis (MLETR): singularidade, controle exclusivo, integridade, aditamento, apresentação e extinção. A MLETR só tem efeito jurídico onde um país a promulgou, e o Brasil não promulgou: isto não é uma afirmação de conformidade legal.",
    issueTitle: "Emitir um registro",
    documentFile: "Documento (de preferência o PDF assinado com ICP-Brasil)",
    holder: "Primeiro portador (endereço da carteira)",
    issue: "Emitir",
    lookupTitle: "Abrir um registro",
    originalHash: "Hash do documento original",
    open: "Abrir",
    notFound: "Nenhum registro transferível com este hash nesta rede.",
    notDeployed: "Os registros transferíveis ainda não foram publicados nesta rede.",
    issuer: "Emissor",
    controller: "Quem tem o controle",
    version: "Versão",
    status: "Situação",
    statuses: { active: "ativo", surrendered: "apresentado ao emissor", terminated: "extinto" },
    currentHash: "Hash da versão atual",
    pending: "Aditamento pendente",
    actionsTitle: "O que sua carteira pode fazer",
    noActions: "Conecte a carteira do emissor ou de quem tem o controle.",
    transferTo: "Transferir o controle para",
    transfer: "Transferir controle",
    amendFile: "Nova versão do documento",
    propose: "Propor aditamento",
    cancel: "Cancelar proposta",
    accept: "Aceitar aditamento",
    surrender: "Apresentar ao emissor",
    terminate: "Extinguir",
    reasons: { 0: "cumprido", 1: "substituído por papel", 2: "outro" },
    done: "Feito.",
    connectFirst: "Conectar carteira",
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
