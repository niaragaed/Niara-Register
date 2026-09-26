/**
 * Globo da Niara no hero.
 *
 * É a própria animação do GIF de marca, convertida para vídeo — mesmos 40 frames
 * a 70 ms, mesmo sentido e mesma velocidade. Os arquivos em public/brand/ são
 * gerados a partir de public/brand/niara-globe-ref.gif (que fica fora do git) com
 * um recorte de 520x520 em (68,60), o menor quadrado que contém a arte nos 40
 * frames com margem.
 *
 * Server component: sem estado e sem bundle de cliente.
 *
 * O <video> nasce SEM <source>, então o HTML servido não referencia vídeo nenhum
 * e o navegador mostra só o poster. O script abaixo acrescenta as fontes apenas
 * quando o visitante não pediu menos movimento. Foi o único jeito de cumprir
 * "sob prefers-reduced-motion nada de vídeo é baixado": o Chrome ignora o
 * atributo media em <source> de vídeo, e preload="none" é atropelado pelo
 * autoplay — os dois foram testados e baixaram o arquivo do mesmo jeito.
 *
 * Sem JS o resultado é o poster parado, que é a degradação aceitável para um
 * elemento decorativo.
 *
 * O fundo branco do vídeo some no bone pelo mix-blend-mode em app/globals.css.
 */

const LADO = 340;

const ID = "niara-globe";

const FONTES = [
  ["/brand/niara-globe.webm", "video/webm"],
  ["/brand/niara-globe.mp4", "video/mp4"],
] as const;

const SCRIPT = `(function(){
var v=document.getElementById(${JSON.stringify(ID)});
if(!v||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
${JSON.stringify(FONTES)}.forEach(function(f){
var s=document.createElement("source");s.src=f[0];s.type=f[1];v.appendChild(s);
});
v.load();
})();`;

export function NiaraGlobe({ className }: { className?: string }) {
  return (
    <div className={className}>
      <video
        id={ID}
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
      />
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </div>
  );
}
