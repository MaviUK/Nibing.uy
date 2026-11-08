import React from "react";

/**
 * Decorative game-style level transition. n64-level-run.js plays the sprite
 * when the checker strip scrolls into view, then reveals LEVEL COMPLETED!
 * Existing React pages and booking interactions stay unchanged.
 */
export default function LevelWasher() {
  return (
    <div className="n64-level-track" aria-hidden="true">
      <picture className="n64-level-washer">
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
          loading="eager"
          decoding="async"
          draggable={false}
        />
      </picture>
      <span className="n64-level-complete">LEVEL COMPLETED!</span>
    </div>
  );
}
