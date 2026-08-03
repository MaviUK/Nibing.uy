(function () {
  const section = document.getElementById("customer-reviews");
  const reviewList = document.getElementById("google-reviews-list");
  const ratingSummary = document.getElementById("google-rating-summary");
  const googleButton = document.getElementById("google-reviews-button");

  if (!section || !reviewList) return;

  let started = false;

  function setFallback(message) {
    reviewList.replaceChildren();
    const p = document.createElement("p");
    p.style.margin = "0";
    p.style.color = "#a1a1aa";
    p.style.lineHeight = "1.65";
    p.textContent = message;
    reviewList.appendChild(p);
  }

  function starText(rating) {
    const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
  }

  function makeReviewCard(review) {
    const article = document.createElement("article");
    article.style.background = "rgba(24,24,27,0.92)";
    article.style.border = "1px solid rgba(255,255,255,0.14)";
    article.style.borderRadius = "16px";
    article.style.padding = "16px";
    article.style.marginTop = "12px";

    if (review.rating) {
      const rating = document.createElement("div");
      rating.style.color = "#facc15";
      rating.style.letterSpacing = "1px";
      rating.style.marginBottom = "8px";
      rating.setAttribute("aria-label", review.rating + " star review");
      rating.textContent = starText(review.rating);
      article.appendChild(rating);
    }

    const text = document.createElement("p");
    text.style.margin = "0 0 12px";
    text.style.color = "#e4e4e7";
    text.style.lineHeight = "1.65";
    text.textContent = "“" + (review.text || "") + "”";
    article.appendChild(text);

    const meta = document.createElement("div");
    meta.style.display = "flex";
    meta.style.justifyContent = "space-between";
    meta.style.gap = "12px";
    meta.style.alignItems = "center";

    const author = document.createElement("strong");
    author.style.color = "white";
    author.textContent = review.author || "Google reviewer";
    meta.appendChild(author);

    if (review.published) {
      const published = document.createElement("span");
      published.style.color = "#71717a";
      published.style.fontSize = "0.85rem";
      published.textContent = review.published;
      meta.appendChild(published);
    }

    article.appendChild(meta);
    return article;
  }

  function loadReviews() {
    if (started) return;
    started = true;

    fetch("/.netlify/functions/googleReviews")
      .then((res) => {
        if (!res.ok) throw new Error("Review request failed");
        return res.json();
      })
      .then((data) => {
        if (data.googleMapsUri && googleButton) googleButton.href = data.googleMapsUri;
        if (data.googleReviewsUrl && googleButton) googleButton.href = data.googleReviewsUrl;

        if (data.rating && ratingSummary) {
          const count = data.userRatingCount
            ? " from " + Number(data.userRatingCount).toLocaleString() + " Google reviews"
            : " on Google";
          ratingSummary.textContent = Number(data.rating).toFixed(1) + "★" + count;
        }

        const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 5) : [];
        if (!reviews.length) {
          setFallback("Google reviews are available using the button below.");
          return;
        }

        reviewList.replaceChildren();
        reviews.forEach((review) => reviewList.appendChild(makeReviewCard(review)));
      })
      .catch(() => {
        setFallback("Google reviews could not be loaded right now. Use the button below to view them on Google.");
      });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadReviews();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(section);
  } else {
    window.setTimeout(loadReviews, 1500);
  }
})();

(function () {
  const PAGE_URL = "https://www.facebook.com/profile.php?id=100064103796752";
  const BASE_URL = "https://www.facebook.com/plugins/page.php";
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 500;
  const HEIGHT = 500;

  function clampWidth(value) {
    const n = Math.floor(Number(value) || MAX_WIDTH);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
  }

  function buildSrc(width) {
    const params = new URLSearchParams({
      href: PAGE_URL,
      tabs: "timeline",
      width: String(width),
      height: String(HEIGHT),
      small_header: "false",
      adapt_container_width: "true",
      hide_cover: "false",
      show_facepile: "true",
    });
    return BASE_URL + "?" + params.toString();
  }

  function fitFacebookFeed() {
    const frame = document.querySelector('iframe[title="Ni Bin Guy Facebook page"]');
    if (!frame) return;

    frame.loading = "lazy";
    const parent = frame.parentElement;
    const width = clampWidth(parent ? parent.clientWidth : frame.clientWidth);
    const nextSrc = buildSrc(width);

    frame.width = String(width);
    frame.height = String(HEIGHT);
    frame.style.width = width + "px";
    frame.style.maxWidth = "100%";
    frame.style.margin = "0 auto";
    frame.style.display = "block";
    if (frame.src !== nextSrc) frame.src = nextSrc;
  }

  let resizeTimer = null;
  function scheduleFit() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(fitFacebookFeed, 200);
  }

  fitFacebookFeed();
  window.addEventListener("resize", scheduleFit, { passive: true });
})();

(function () {
  const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=100064103796752";

  function centreButtons() {
    const googleButton = document.getElementById("google-reviews-button");
    if (googleButton) {
      googleButton.style.alignSelf = "center";
      googleButton.style.marginLeft = "auto";
      googleButton.style.marginRight = "auto";
      googleButton.style.textAlign = "center";
    }

    const facebookButton = document.querySelector('#customer-reviews a[href="' + FACEBOOK_URL + '"]');
    if (facebookButton) {
      facebookButton.style.display = "block";
      facebookButton.style.width = "fit-content";
      facebookButton.style.marginLeft = "auto";
      facebookButton.style.marginRight = "auto";
      facebookButton.style.textAlign = "center";
    }
  }

  function openBookingForm() {
    const bookingButton = Array.from(document.querySelectorAll("button")).find((candidate) => {
      const label = (candidate.textContent || "").trim();
      return label === "Book a Clean" && candidate.id !== "site-menu-toggle" && !candidate.closest("#site-section-menu");
    });

    if (bookingButton) bookingButton.click();
    else document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function wireQuestionButton() {
    const section = document.getElementById("wheelie-bin-cleaning-questions");
    if (!section) return;

    const button = Array.from(section.querySelectorAll("a, button")).find((candidate) => {
      const label = (candidate.textContent || "").trim();
      return label === "Book a Bin Clean" || label === "Book a Clean";
    });

    if (!button || button.dataset.opensBookingForm === "true") return;
    button.textContent = "Book a Clean";
    button.setAttribute("href", "#");
    button.setAttribute("role", "button");
    button.dataset.opensBookingForm = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openBookingForm();
    });
  }

  centreButtons();
  wireQuestionButton();
  window.setTimeout(() => {
    centreButtons();
    wireQuestionButton();
  }, 400);
})();
