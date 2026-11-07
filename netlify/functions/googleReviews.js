// netlify/functions/googleReviews.js

const DEFAULT_SEARCH_QUERY = "Ni Bin Guy Bangor County Down";
const DEFAULT_GOOGLE_REVIEWS_URL = "https://share.google/hE0fuZuoDjknpdsjF";

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": status === 200 ? "public, max-age=3600" : "no-store",
      ...extraHeaders,
    },
  });
}

function getText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  return "";
}

function normalizeReview(review) {
  const author = review.authorAttribution || {};
  const text = getText(review.text) || getText(review.originalText);

  return {
    author: author.displayName || "Google reviewer",
    authorPhoto: author.photoUri || "",
    authorUrl: author.uri || "",
    rating: Number(review.rating) || null,
    text,
    published: review.relativePublishTimeDescription || review.publishTime || "",
    reviewUrl: review.googleMapsUri || author.uri || "",
  };
}

async function findPlaceId(apiKey, query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.googleMapsUri",
    },
    body: JSON.stringify({ textQuery: query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Text Search failed: ${res.status} ${text.slice(0, 180)}`);
  }

  const data = await res.json();
  return data?.places?.[0]?.id || "";
}

async function getPlaceDetails(apiKey, placeId) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", "en-GB");
  url.searchParams.set("regionCode", "GB");

  const res = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,reviews,googleMapsUri",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Place Details failed: ${res.status} ${text.slice(0, 180)}`);
  }

  return res.json();
}

export default async function handler(req) {
  if (req.method && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const configuredPlaceId = process.env.GOOGLE_PLACE_ID || process.env.NI_BIN_GUY_GOOGLE_PLACE_ID;
    const searchQuery = process.env.GOOGLE_PLACE_SEARCH_QUERY || DEFAULT_SEARCH_QUERY;
    const googleReviewsUrl = process.env.GOOGLE_REVIEWS_URL || DEFAULT_GOOGLE_REVIEWS_URL;

    if (!apiKey) {
      return json({
        configured: false,
        error: "Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY",
        googleReviewsUrl,
        reviews: [],
      });
    }

    const placeId = configuredPlaceId || (await findPlaceId(apiKey, searchQuery));

    if (!placeId) {
      return json({
        configured: false,
        error: "No Google Place ID found",
        googleReviewsUrl,
        reviews: [],
      });
    }

    const place = await getPlaceDetails(apiKey, placeId);
    const reviews = Array.isArray(place.reviews) ? place.reviews.map(normalizeReview).filter((r) => r.text) : [];

    return json({
      configured: true,
      placeId: place.id || placeId,
      businessName: getText(place.displayName) || "Ni Bin Guy",
      rating: Number(place.rating) || null,
      userRatingCount: Number(place.userRatingCount) || null,
      googleMapsUri: place.googleMapsUri || googleReviewsUrl,
      googleReviewsUrl,
      reviews: reviews.slice(0, 5),
    });
  } catch (err) {
    console.error("googleReviews error", err);
    return json({
      configured: false,
      error: err.message || "Unable to load Google reviews",
      googleReviewsUrl: DEFAULT_GOOGLE_REVIEWS_URL,
      reviews: [],
    }, 200);
  }
}
