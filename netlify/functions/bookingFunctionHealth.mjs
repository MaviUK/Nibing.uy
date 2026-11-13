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
    const detail=error?.message==="booking_handler_missing"?"handler_export_missing":
      error instanceof SyntaxError?"syntax_error":
      error instanceof ReferenceError?"reference_error":
      error instanceof TypeError?"type_error":
      error?.code==="MODULE_NOT_FOUND"?"module_missing":"module_initialization_error";
    return Response.json({status:"unavailable",bookingHandler:"startup_failed",reason:detail},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
