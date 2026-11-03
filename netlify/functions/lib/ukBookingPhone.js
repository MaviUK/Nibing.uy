"use strict";

/** Canonical national-format UK number for both NI landlines and UK mobiles.
 * Accept normal spaces/punctuation and +44/0044 international prefixes.
 * Reject postcodes, phone extensions, short numbers and alphabetic characters.
 */
function normaliseUkBookingPhone(input) {
  if (typeof input!=="string" && typeof input!=="number") return null;
  const compact=String(input).trim().replace(/[\s().-]/g,"");
  if (/^0[1-9]\d{9}$/.test(compact)) return compact;
  if (/^\+44[1-9]\d{9}$/.test(compact)) return "0"+compact.slice(3);
  if (/^0044[1-9]\d{9}$/.test(compact)) return "0"+compact.slice(4);
  return null;
}
module.exports={normaliseUkBookingPhone};
