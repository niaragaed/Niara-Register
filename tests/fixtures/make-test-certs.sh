#!/usr/bin/env bash
# Generates a THROWAWAY certificate chain for the PAdES tests: a fake root, a
# fake intermediate and two signers with ICP-Brasil-style SAN fields (CPF in
# 2.16.76.1.3.1, CNPJ in 2.16.76.1.3.3). None of this is ICP-Brasil; the keys
# are public test material. Re-run to regenerate.
set -euo pipefail
cd "$(dirname "$0")"
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT

cat > "$D/ca.cnf" <<'CNF'
[ v3_ca ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[ v3_int ]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[ v3_pf ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = @pf_san
[ pf_san ]
otherName.1 = 2.16.76.1.3.1;PRINTABLESTRING:15051990123456789010000000000000000000000000000
email.1 = maria.teste@example.com
[ v3_pj ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = @pj_san
[ pj_san ]
otherName.1 = 2.16.76.1.3.3;PRINTABLESTRING:12345678000199
otherName.2 = 2.16.76.1.3.4;PRINTABLESTRING:01011980987654321000000000000000000000000000000
CNF

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/root.key" -out test-root.pem -days 3650 \
  -subj "/C=BR/O=TEST ONLY/CN=Test Root (not ICP-Brasil)" -extensions v3_ca -config "$D/ca.cnf" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$D/int.key" -out "$D/int.csr" -subj "/C=BR/O=TEST ONLY/CN=Test Intermediate" 2>/dev/null
openssl x509 -req -in "$D/int.csr" -CA test-root.pem -CAkey "$D/root.key" -CAcreateserial -out "$D/int.pem" -days 3650 \
  -extfile "$D/ca.cnf" -extensions v3_int 2>/dev/null

for who in pf pj; do
  cn=$([ "$who" = pf ] && echo "MARIA TESTE:12345678901" || echo "EMPRESA TESTE LTDA:12345678000199")
  openssl req -newkey rsa:2048 -nodes -keyout "$D/$who.key" -out "$D/$who.csr" -subj "/C=BR/O=TEST ONLY/CN=$cn" 2>/dev/null
  openssl x509 -req -in "$D/$who.csr" -CA "$D/int.pem" -CAkey "$D/int.key" -CAcreateserial -out "$D/$who.pem" -days 3650 \
    -extfile "$D/ca.cnf" -extensions "v3_$who" 2>/dev/null
  cat "$D/int.pem" > "$D/chain.pem"
  # Legacy PBE (3DES + SHA1 MAC), the format most ICP-Brasil A1 files still use.
  openssl pkcs12 -export -legacy -inkey "$D/$who.key" -in "$D/$who.pem" -certfile "$D/chain.pem" \
    -passout pass:teste123 -out "signer-$who.p12" 2>/dev/null || \
  openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -inkey "$D/$who.key" \
    -in "$D/$who.pem" -certfile "$D/chain.pem" -passout pass:teste123 -out "signer-$who.p12"
done
cp "$D/int.pem" test-intermediate.pem
echo "ok"
