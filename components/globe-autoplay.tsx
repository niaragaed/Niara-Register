"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Client shell around the globe's <video>.
 *
 * The video is still rendered on the SERVER: it arrives here as `children`, so
 * poster, sources and attributes are in the initial HTML. This component only
 * adds the mount effect; it draws no video at all.
 *
 * WHY: on the iPhone the globe stayed frozen on the poster on the first visit
 * and only animated after a reload. Reassigning `muted`/`defaultMuted` and
 * calling `play()` covers the case where Safari refused the initial autoplay
 * and does not try again.
 *
 * `play()` is retried when data arrives: on the first visit the file is still
 * downloading, and a single attempt before there is a decoded frame does not
 * stick. On reload the video comes from the cache, which is why it worked
 * there: that is the difference the report described.
 *
 * There is also a safety net for `loop`: in some WebKit builds the video
 * reaches the end and does not restart on its own, despite the attribute. On
 * the `ended` event we rewind and play again. The `loop` attribute stays on the
 * element: it handles it on its own where it works, and when it works `ended`
 * never fires.
 *
 * Under prefers-reduced-motion the <video> has no matching <source>, so there
 * is nothing to play: `play()` rejects, the catch swallows it and the poster
 * stays. Nothing is downloaded.
 */
export function GlobeAutoplay({
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

    // defaultMuted reflects the attribute; muted is the current state. iOS
    // looks at each at different moments of the autoplay decision.
    video.muted = true;
    video.defaultMuted = true;

    const tryPlay = () => {
      // With no matching source (reduced-motion) the promise rejects: silence
      // is the right behavior, the poster is already on screen.
      void video.play().catch(() => {});
    };

    // Loop safety net: only fires where the `loop` attribute failed, because in
    // a browser that honors loop, `ended` never happens.
    const restart = () => {
      video.currentTime = 0;
      void video.play().catch(() => {});
    };

    tryPlay();
    video.addEventListener("loadeddata", tryPlay);
    video.addEventListener("canplay", tryPlay);
    video.addEventListener("ended", restart);

    return () => {
      video.removeEventListener("loadeddata", tryPlay);
      video.removeEventListener("canplay", tryPlay);
      video.removeEventListener("ended", restart);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
