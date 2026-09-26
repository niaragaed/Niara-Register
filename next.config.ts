import type { NextConfig } from "next";

/**
 * As rotas do site são em inglês e iguais nos dois idiomas — o idioma vem do
 * cookie, não da URL.
 *
 * Os caminhos antigos em português foram compartilhados antes da renomeação,
 * então respondem com redirect permanente (308) em vez de 404. `permanent: true`
 * emite 308, que preserva o método da requisição; o 301 clássico não garante
 * isso. Não remover sem dar tempo de os links antigos saírem de circulação.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/registro-pmes", destination: "/sme-registry", permanent: true },
      { source: "/registro-global", destination: "/global-registry", permanent: true },
      { source: "/assinatura", destination: "/signatures", permanent: true },
    ];
  },
};

export default nextConfig;
