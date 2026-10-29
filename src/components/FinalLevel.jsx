import React from "react";
import LevelWasher from "./LevelWasher.jsx";

/**
 * Last gameplay stage, after the customer portal and above the real footer.
 * Uses the existing hero booking action, so no new booking implementation.
 */
export default function FinalLevel() {
  const openBooking = () => {
    const primaryBookingButton = document.querySelector(
      "#main-content.n64-world button.n64-btn--start"
    );
    if (primaryBookingButton) {
      primaryBookingButton.click();
    } else {
      window.location.assign("/?book=1");
    }
  };

  return (
    <section id="level-08-final" className="n64-final-level" aria-labelledby="n64-finale-title">
      <LevelWasher />
      <div className="n64-final-level-inner">
        <div className="n64-final-kicker">LEVEL 08 / FINAL LEVEL</div>
        <h2 id="n64-finale-title">MISSION COMPLETE!</h2>
        <p>You've explored the levels. Ready to power up your own bins?</p>
        <button type="button" className="n64-final-book" onClick={openBooking}>
          ★ Book a Clean
        </button>
        <p className="n64-final-caption">From £5 per bin, every four weeks — or book a one-off clean.</p>
      </div>
    </section>
  );
}
