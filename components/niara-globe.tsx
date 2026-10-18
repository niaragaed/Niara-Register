/**
 * Niara globe in the hero.
 *
 * It is the brand GIF's own animation, converted to video: the same 40 frames
 * at 70 ms, same direction and same speed. The files in public/brand/ are
 * generated from public/brand/niara-globe-ref.gif (kept out of git) with a
 * 520x520 crop at (68,60), the smallest square that holds the artwork across
 * the 40 frames with a margin.
 *
 * Server component: markup only, no state and no JS in the browser.
 *
 * The `media` on the <source> elements handles "no video under
 * prefers-reduced-motion": when the visitor asks for less motion no source
 * matches, the element has no resource and shows only the poster, with no
 * download. The same markup is served and hydrated, so server and client do
 * not diverge.
 *
 * The video's white background disappears on bone through mix-blend-mode in
 * app/globals.css.
 */

import { GlobeAutoplay } from "@/components/globe-autoplay";

const SIDE = 340;

const NO_REDUCED_MOTION = "(prefers-reduced-motion: no-preference)";

export function NiaraGlobe({ className }: { className?: string }) {
  return (
    // The <video> below is rendered on the server and handed over as children:
    // GlobeAutoplay only hangs the iOS autoplay effect around it.
    <GlobeAutoplay className={className}>
      <video
        className="niara-globe__video"
        width={SIDE}
        height={SIDE}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/brand/niara-globe-poster.png"
        aria-hidden="true"
      >
        {/* MP4 FIRST, on purpose. WebKit answers "probably" for video/webm,
            picks that source for being first and then stalls without loading,
            and the element does not fall back to the next source, so the
            poster was left frozen on the iPhone. With H.264 first every
            browser picks a source that really plays. The webm stays as a
            backup; it is 14 KB smaller, which does not pay for the risk of
            being first. */}
        <source
          src="/brand/niara-globe.mp4"
          type="video/mp4"
          media={NO_REDUCED_MOTION}
        />
        <source
          src="/brand/niara-globe.webm"
          type="video/webm"
          media={NO_REDUCED_MOTION}
        />
      </video>
    </GlobeAutoplay>
  );
}
