#!/usr/bin/env bash
# Generates a THROWAWAY EU-style certificate chain for the eIDAS tests: a fake
# root, a fake "qualified" issuing CA and two signers whose QCStatements
# (ETSI EN 319 412-5) declare them qualified:
#   eu-signer-qes.p12     ECDSA P-256, QcCompliance + QcSSCD + QcType esign
#   eu-signer-adesqc.p12  RSA 2048,    QcCompliance + QcType esign (no QSCD)
# None of this is on any EU trusted list; the keys are public test material.
# The two CA certificates are written as .crt (PEM inside) because *.pem is
# gitignored in this repository. Re-run to regenerate.
set -euo pipefail
cd "$(dirname "$0")"
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT

cat > "$D/eu.cnf" <<'CNF'
[ v3_ca ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[ v3_int ]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[ v3_qes ]
basicConstraints = CA:FALSE
keyUsage = critical,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
1.3.6.1.5.5.7.1.3 = ASN1:SEQUENCE:qcs_qes
[ v3_adesqc ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
1.3.6.1.5.5.7.1.3 = ASN1:SEQUENCE:qcs_adesqc
[ qcs_qes ]
s1 = SEQUENCE:qc_compliance
s2 = SEQUENCE:qc_sscd
s3 = SEQUENCE:qc_type
[ qcs_adesqc ]
s1 = SEQUENCE:qc_compliance
s2 = SEQUENCE:qc_type
[ qc_compliance ]
id = OID:0.4.0.1862.1.1
[ qc_sscd ]
id = OID:0.4.0.1862.1.4
[ qc_type ]
id = OID:0.4.0.1862.1.6
types = SEQUENCE:qc_types
[ qc_types ]
t1 = OID:0.4.0.1862.1.6.1
CNF

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/root.key" -out eu-test-root.crt -days 3650 \
  -subj "/C=LU/O=TEST ONLY/CN=Test EU Root (not on any trusted list)" -extensions v3_ca -config "$D/eu.cnf" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$D/ca.key" -out "$D/ca.csr" \
  -subj "/C=LU/O=TEST ONLY/CN=Test Qualified CA for Signatures" 2>/dev/null
openssl x509 -req -in "$D/ca.csr" -CA eu-test-root.crt -CAkey "$D/root.key" -CAcreateserial -out eu-test-ca.crt -days 3650 \
  -extfile "$D/eu.cnf" -extensions v3_int 2>/dev/null

# QES signer: EC P-256 (keys on smart cards and eID cards are often EC).
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout "$D/qes.key" -out "$D/qes.csr" \
  -subj "/C=DE/O=TEST ONLY/GN=Erika/SN=Mustermann/CN=ERIKA MUSTERMANN" 2>/dev/null
openssl x509 -req -in "$D/qes.csr" -CA eu-test-ca.crt -CAkey "$D/ca.key" -CAcreateserial -out "$D/qes.pem" -days 3650 \
  -extfile "$D/eu.cnf" -extensions v3_qes 2>/dev/null
openssl pkcs12 -export -inkey "$D/qes.key" -in "$D/qes.pem" -certfile eu-test-ca.crt \
  -passout pass:teste123 -out eu-signer-qes.p12

# Advanced signature with a qualified certificate: RSA software certificate.
openssl req -newkey rsa:2048 -nodes -keyout "$D/adesqc.key" -out "$D/adesqc.csr" \
  -subj "/C=ES/O=TEST ONLY/CN=JUAN ESPANOL" 2>/dev/null
openssl x509 -req -in "$D/adesqc.csr" -CA eu-test-ca.crt -CAkey "$D/ca.key" -CAcreateserial -out "$D/adesqc.pem" -days 3650 \
  -extfile "$D/eu.cnf" -extensions v3_adesqc 2>/dev/null
openssl pkcs12 -export -inkey "$D/adesqc.key" -in "$D/adesqc.pem" -certfile eu-test-ca.crt \
  -passout pass:teste123 -out eu-signer-adesqc.p12
rm -f ./*.srl
echo "ok"
