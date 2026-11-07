import React, { useEffect, useRef, useState } from "react";
import LevelWasher from "./LevelWasher.jsx";

/**
 * Two informational homepage sections, kept outside the numbered arcade levels
 * so the original 01-08 score and completed-level animations are unchanged.
 */
const GOOGLE_REVIEWS_URL = "https://share.google/hE0fuZuoDjknpdsjF";
const FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=100064103796752";

const FAQs = [
  {
    question: "How much does wheelie bin cleaning cost?",
    answer: "Regular domestic wheelie bin cleaning is £5 per bin every four weeks. A one-off domestic clean is £15 per bin. Contact us for commercial pricing.",
  },
  {
    question: "Do you charge extra for the first clean?",
    answer: "No. There is no additional first-clean fee on our regular service.",
  },
  {
    question: "What areas does Ni Bin Guy cover?",
    answer: "We cover selected rounds across North Down and the Ards area. Use Check Your Area at the top of the page to check your postcode and the next available cleaning date.",
  },
  {
    question: "How often should I have my wheelie bin cleaned?",
    answer: "Our regular service is every four weeks, normally after your bin has been emptied. You can also book a one-off clean.",
  },
  {
    question: "Can bin cleaning help with maggots and bad smells?",
    answer: "Yes. Washing, sanitising and deodorising helps remove the residue that attracts flies and causes unpleasant smells.",
  },
  {
    question: "Do you clean both domestic and commercial bins?",
    answer: "Yes. We clean household wheelie bins and larger commercial bins, including 360L, 660L and 1100L containers.",
  },
  {
    question: "When is the best time to clean a wheelie bin?",
    answer: "Just after your waste collection, while the bin is empty, is usually the best time.",
  },
  {
    question: "Do I need to be home for a bin clean?",
    answer: "No. As long as the bin is empty and safely accessible for cleaning, you normally do not need to be home.",
  },
  {
    question: "What if there is loose waste left in the bin?",
    answer: "A small amount of leftover waste may be removed where it is safe to do so. Heavy or unsafe waste may need to be cleared before the bin can be cleaned.",
  },
  {
    question: "How do I book a wheelie bin clean?",
    answer: "Use Book a Clean on this website to enter your address, select your bins and see the cleaning schedule for your area.",
  },
];

function ratingStars(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

export function CustomerReviews() {
  const rootRef = useRef(null);
  const [status, setStatus] = useState("waiting");
  const [reviewData, setReviewData] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let observer;
    let started = false;
    let mounted = true;

    const loadReviews = () => {
      if (started) return;
      started = true;
      setStatus("loading");

      fetch("/.netlify/functions/googleReviews", { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("Reviews temporarily unavailable");
          return response.json();
        })
        .then((data) => {
          if (!mounted) return;
          setReviewData(data && typeof data === "object" ? data : {});
          setStatus("ready");
        })
        .catch((error) => {
          if (!mounted || error?.name === "AbortError") return;
          setStatus("unavailable");
        });
    };

    if ("IntersectionObserver" in window && rootRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          loadReviews();
        },
        { rootMargin: "450px 0px" }
      );
      observer.observe(rootRef.current);
    } else {
      loadReviews();
    }

    return () => {
      mounted = false;
      observer?.disconnect();
      controller.abort();
    };
  }, []);

  const reviews = Array.isArray(reviewData?.reviews)
    ? reviewData.reviews.filter((review) => review && typeof review.text === "string" && review.text.trim()).slice(0, 5)
    : [];
  const rating = Number(reviewData?.rating);
  const ratingCount = Number(reviewData?.userRatingCount);
  const googleLink = reviewData?.googleMapsUri || reviewData?.googleReviewsUrl || GOOGLE_REVIEWS_URL;
  // The Places API provides Google's own write-a-review URL when configured.
  // Fall back to the already-published business profile link if unavailable.
  const writeReviewLink = reviewData?.writeReviewUrl || reviewData?.googleReviewsUrl || GOOGLE_REVIEWS_URL;

  return (
    <section
      ref={rootRef}
      id="customer-reviews"
      className="n64-trust-section n64-trust-section--reviews"
      aria-labelledby="customer-reviews-title"
    >
      <LevelWasher />
      <div className="n64-trust-inner">
        <div className="n64-trust-heading">
          <span className="n64-trust-eyebrow">★ WORD ON THE STREET</span>
          <h2 id="customer-reviews-title">Customer Reviews</h2>
          <p>Don't just take our word for it. See what our customers have to say.</p>
        </div>

        <div className="n64-reviews-head">
          <div className="n64-reviews-head__text">
            <span className="n64-reviews-head__source">GOOGLE REVIEWS</span>
            {status === "ready" && Number.isFinite(rating) && rating > 0 ? (
              <p className="n64-reviews-head__rating" aria-label={"Rated " + rating.toFixed(1) + " out of 5"}>
                <strong>{rating.toFixed(1)}</strong>
                <span aria-hidden="true">★★★★★</span>
                {Number.isFinite(ratingCount) && ratingCount > 0 && (
                  <small>from {ratingCount.toLocaleString("en-GB")} reviews</small>
                )}
              </p>
            ) : (
              <p className="n64-reviews-head__intro">Real customer feedback from Google.</p>
            )}
          </div>
          <div className="n64-reviews-head__actions">
            <a className="n64-trust-link n64-trust-link--write-review"
              href={writeReviewLink} target="_blank" rel="noopener noreferrer"
              aria-label="Leave a Google review for NI Bin Guy, opens Google in a new tab">
              <span aria-hidden="true">★</span> Leave a Google Review
              <span aria-hidden="true">↗</span>
            </a>
            <a className="n64-trust-link n64-trust-link--yellow"
              href={googleLink} target="_blank" rel="noopener noreferrer">
              View on Google <span aria-hidden="true">↗</span>
            </a>
            <small>Your review is written on Google. Google sign-in may be required.</small>
          </div>
        </div>

        {reviews.length > 0 ? (
          <div className="n64-review-cards" aria-label="Recent Google reviews">
            {reviews.map((review, index) => (
              <article className="n64-review-card" key={(review.author || "customer") + "-" + index}>
                {Number(review.rating) > 0 && (
                  <div className="n64-review-card__stars" aria-label={review.rating + " stars"}>
                    {ratingStars(review.rating)}
                  </div>
                )}
                <p className="n64-review-card__quote">“{review.text}”</p>
                <div className="n64-review-card__footer">
                  <strong>{review.author || "Google reviewer"}</strong>
                  {review.published && <small>{review.published}</small>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="n64-reviews-empty" role="status">
            {status === "loading"
              ? "Loading customer reviews…"
              : status === "waiting"
                ? "Customer reviews will load as you reach this section."
                : "Reviews aren't loading here right now. You can still read them on Google using the link above."}
          </p>
        )}

        <div className="n64-reviews-facebook">
          <div>
            <strong>FIND US ON FACEBOOK</strong>
            <p>See our latest updates and customer conversations.</p>
          </div>
          <a className="n64-trust-link n64-trust-link--white" href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer">
            Visit our Facebook <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}

const QUESTION_TOPICS = [
  { id: "pricing", title: "Prices & Plans", subtitle: "What will it cost?", icon: "£", indices: [0, 1] },
  { id: "service", title: "Our Service", subtitle: "How it works", icon: "✦", indices: [3, 4, 5] },
  { id: "clean-day", title: "Clean Day", subtitle: "What to expect", icon: "✓", indices: [6, 7, 8] },
  { id: "booking", title: "Areas & Booking", subtitle: "Where and how", icon: "⌖", indices: [2, 9] },
];

export function CustomerQuestions({ onBook }) {
  const [selectedTopicId, setSelectedTopicId] = useState("pricing");
  const [openQuestion, setOpenQuestion] = useState(null);
  const selectedTopic = QUESTION_TOPICS.find(({ id }) => id === selectedTopicId) || QUESTION_TOPICS[0];

  const chooseTopic = (topic) => {
    if (topic.id === selectedTopicId) return;
    setSelectedTopicId(topic.id);
    setOpenQuestion(null);
  };

  return (
    <section
      id="wheelie-bin-cleaning-questions"
      className="n64-trust-section n64-trust-section--questions"
      aria-labelledby="customer-questions-title"
    >
      <LevelWasher />
      <div className="n64-trust-inner n64-help-centre">
        <div className="n64-help-hero">
          <div className="n64-help-hero__copy">
            <span className="n64-help-hero__tag">
              <span aria-hidden="true">★</span> PLAYER HELP DESK
            </span>
            <h2 id="customer-questions-title">Customer<br />Questions<span className="n64-help-hero__punctuation">?</span></h2>
            <p>Need a hand? Choose a topic for quick, straightforward answers.</p>
            <span className="n64-help-hero__total">10 QUESTIONS <span aria-hidden="true">•</span> 4 TOPICS</span>
          </div>
          <div className="n64-help-hero__art" aria-hidden="true">
            <div className="n64-help-hero__question-mark">?</div>
            <span className="n64-help-hero__spark n64-help-hero__spark--one">✦</span>
            <span className="n64-help-hero__spark n64-help-hero__spark--two">✦</span>
          </div>
        </div>

        <div className="n64-help-body">
          <div className="n64-help-topics-heading">
            <span className="n64-help-section-index">01</span>
            <strong>PICK A TOPIC</strong>
          </div>
          <div className="n64-help-topics" role="group" aria-label="Choose a question topic">
            {QUESTION_TOPICS.map((topic) => (
              <button
                key={topic.id}
                type="button"
                className={"n64-help-topic" + (selectedTopicId === topic.id ? " n64-help-topic--active" : "")}
                data-topic={topic.id}
                aria-pressed={selectedTopicId === topic.id}
                onClick={() => chooseTopic(topic)}
              >
                <span className="n64-help-topic__icon" aria-hidden="true">{topic.icon}</span>
                <span className="n64-help-topic__text">
                  <strong>{topic.title}</strong>
                  <small>{topic.subtitle}</small>
                </span>
                <span className="n64-help-topic__count" aria-label={topic.indices.length + " questions"}>
                  {topic.indices.length}
                </span>
              </button>
            ))}
          </div>

          <div className="n64-help-answer-sheet" id="n64-help-answer-sheet">
            <div className="n64-help-answer-sheet__heading">
              <div>
                <span>02 / THE ANSWERS</span>
                <h3>{selectedTopic.title}</h3>
              </div>
              <span className="n64-help-answer-sheet__count">
                {selectedTopic.indices.length} {selectedTopic.indices.length === 1 ? "ANSWER" : "ANSWERS"}
              </span>
            </div>
            <div className="n64-help-answer-list">
              {selectedTopic.indices.map((faqIndex) => {
                const faq = FAQs[faqIndex];
                const isOpen = openQuestion === faqIndex;
                return (
                  <div className={"n64-help-answer" + (isOpen ? " n64-help-answer--open" : "")} key={faq.question}>
                    <button
                      className="n64-help-answer__button"
                      id={"n64-help-question-" + faqIndex}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={"n64-help-answer-" + faqIndex}
                      onClick={() => setOpenQuestion(isOpen ? null : faqIndex)}
                    >
                      <span className="n64-help-answer__question">{faq.question}</span>
                      <span className="n64-help-answer__toggle" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                    </button>
                    <div
                      id={"n64-help-answer-" + faqIndex}
                      className="n64-help-answer__content"
                      role="region"
                      aria-labelledby={"n64-help-question-" + faqIndex}
                      hidden={!isOpen}
                    >
                      <p>{faq.answer}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="n64-help-action">
            <div>
              <span className="n64-help-action__eyebrow">MISSION READY?</span>
              <strong>Time to give that bin a proper clean.</strong>
            </div>
            <button type="button" onClick={onBook} className="n64-help-action__button">
              <span aria-hidden="true">★</span> Book a Clean
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
