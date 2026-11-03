import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");

    const { data, error } = await supabase
      .from("booking_requests")
      .insert({
        name: body.name,
        email: body.email,
        phone: body.phone,
        address: body.address,
        place_id: body.placeId,
        lat: body.lat,
        lng: body.lng,
        bins: body.bins,
        discount_code: body.discountCode,
        pricing: body.pricing,
        terms_accepted: body.termsAccepted,
        terms_version: body.termsVersion,
        terms_acceptance_text: body.termsAcceptanceText,
        source: body.source || "website_booking_form",
        status: "new",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to save booking" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, booking: data }),
    };
  } catch (err) {
    console.error("createBooking error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
