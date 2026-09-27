/**
 * Globo da Niara no hero.
 *
 * É a própria animação do GIF de marca, convertida para vídeo — mesmos 40 frames
 * a 70 ms, mesmo sentido e mesma velocidade. Os arquivos em public/brand/ são
 * gerados a partir de public/brand/niara-globe-ref.gif (que fica fora do git) com
 * um recorte de 520x520 em (68,60), o menor quadrado que contém a arte nos 40
 * frames com margem.
 *
 * Server component: só markup, sem estado e sem JS no navegador.
 *
 * O `media` nos <source> resolve o "nada de vídeo sob prefers-reduced-motion":
 * quando o visitante pede menos movimento nenhuma fonte casa, o elemento fica
 * sem recurso e exibe apenas o poster — sem download. O mesmo markup é servido e
 * hidratado, então não há divergência entre servidor e cliente.
 *
 * O fundo branco do vídeo some no bone pelo mix-blend-mode em app/globals.css.
 */

import { GloboAutoplay } from "@/components/globo-autoplay";

const LADO = 340;

const SEM_MOVIMENTO_REDUZIDO = "(prefers-reduced-motion: no-preference)";

export function NiaraGlobe({ className }: { className?: string }) {
  return (
    // O <video> abaixo é renderizado no servidor e entregue como children: o
    // GloboAutoplay só pendura o efeito de autoplay do iOS em volta dele.
    <GloboAutoplay className={className}>
      <video
        className="niara-globe__video"
        width={LADO}
        height={LADO}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/brand/niara-globe-poster.png"
        aria-hidden="true"
      >
        {/* MP4 PRIMEIRO, de propósito. O WebKit responde "probably" para
            video/webm, escolhe essa fonte por ser a primeira e então trava sem
            carregar — e o elemento não volta atrás para a fonte seguinte, então
            sobrava o poster parado no iPhone. Com H.264 na frente todos os
            navegadores pegam uma fonte que realmente toca. O webm fica como
            reserva; custa 14 KB a menos, o que não paga o risco de ser o
            primeiro. */}
        <source
          src="/brand/niara-globe.mp4"
          type="video/mp4"
          media={SEM_MOVIMENTO_REDUZIDO}
        />
        <source
          src="/brand/niara-globe.webm"
          type="video/webm"
          media={SEM_MOVIMENTO_REDUZIDO}
        />
      </video>
    </GloboAutoplay>
  );
}
