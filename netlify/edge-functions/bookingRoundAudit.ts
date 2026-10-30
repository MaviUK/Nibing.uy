import type { Config, Context } from "@netlify/edge-functions";

/**
 * Preview 1: do not intercept email bookings with an upstream round lookup.
 *
 * Previously this middleware synchronously called /api/booking-schedule and
 * sendAutomaticBookingConfirmation before the real sendBookingEmail function.
 * The nested call exhausted the 36-second edge execution limit, returning
 * "The edge function invocation timed out" without reaching the email handler.
 *
 * Booking email delivery and reCAPTCHA validation belong to sendBookingEmail.
 * Date lookups can run separately; they must never block booking submission.
 */
export default async function handler(_request: Request, context: Context) {
  return context.next();
}

export const config: Config = {
  path: "/.netlify/functions/sendBookingEmail",
  method: ["POST"],
  onError: "bypass",
};
