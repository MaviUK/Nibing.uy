import React from "react";

/** Visual-only 8-bit NI Bin Guy character at each checkerboard level divider. */
export default function LevelWasher() {
  return (
    <picture className="n64-level-washer" aria-hidden="true">
      <source
        media="(prefers-reduced-motion: reduce)"
        srcSet="/n64-pixel-bin-washer-still.svg"
        type="image/svg+xml"
      />
      <img
        src="/n64-pixel-bin-washer.svg"
        alt=""
        width="244"
        height="149"
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}
