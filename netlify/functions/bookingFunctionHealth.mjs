// Read-only diagnostic for booking function startup; no customer data or writes.
// An isolated function can report a broken booking module without requiring
// a live POST, a CAPTCHA, or a Squeegee API call.
export default async function handler(request){
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  try{
    const booking=await import("./sendBookingEmail.js");
    if(typeof (booking.handler||booking.default?.handler)!=="function")
      throw new Error("booking_handler_missing");
    return Response.json({status:"ready",bookingHandler:"loaded"},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("Booking module startup failed",error);
    return Response.json({status:"unavailable",bookingHandler:"startup_failed"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
