"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Casca de cliente em volta do <video> do globo.
 *
 * O vídeo continua sendo renderizado no SERVIDOR — ele chega aqui como
 * `children`, então poster, sources e atributos estão no HTML inicial. Este
 * componente só acrescenta o efeito de mount; não desenha vídeo nenhum.
 *
 * POR QUÊ: no iPhone o globo ficava parado no poster na primeira visita e só
 * animava ao recarregar. Reatribuir `muted`/`defaultMuted` e chamar `play()`
 * cobre o caso em que o Safari recusou o autoplay inicial e não tenta de novo.
 *
 * O `play()` é retentado quando os dados chegam: na primeira visita o arquivo
 * ainda está sendo baixado, e uma tentativa única antes de haver quadro
 * decodificado não pega. No recarregamento o vídeo vem do cache e por isso
 * funcionava — é a diferença que o relato descreve.
 *
 * Sob prefers-reduced-motion o <video> não tem nenhum <source> que case, então
 * não há o que tocar: `play()` rejeita, o catch engole e o poster permanece.
 * Nada é baixado.
 */
export function GloboAutoplay({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = ref.current?.querySelector("video");
    if (!video) return;

    // defaultMuted reflete o atributo; muted é o estado atual. O iOS olha os
    // dois em momentos diferentes da decisão de autoplay.
    video.muted = true;
    video.defaultMuted = true;

    const tentarTocar = () => {
      // Sem source que case (reduced-motion) a promessa rejeita: silêncio é o
      // comportamento correto, o poster já está na tela.
      void video.play().catch(() => {});
    };

    tentarTocar();
    video.addEventListener("loadeddata", tentarTocar);
    video.addEventListener("canplay", tentarTocar);

    return () => {
      video.removeEventListener("loadeddata", tentarTocar);
      video.removeEventListener("canplay", tentarTocar);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
