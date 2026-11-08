// Shared, pure N64 booking validation. Never erase the customer's inputs
// when an error is found; every key maps to a visible field and focus target.
export function validateArcadeBookingFields({
  name="",email="",phone="",address="",hasNiPostcode=false,
  validPhone=false,bins=[],discountCode="",discountValid=true,
  termsConfirmed=false,agreeToTerms=false,
}={}) {
  const errors={};
  if (!String(name).trim())errors.name="Enter the customer's name.";
  if (!Array.isArray(bins) || bins.length===0)
    errors.binType0="Select at least one bin.";
  for (const [index,bin] of (Array.isArray(bins)?bins:[]).entries()) {
    if(!bin?.type)errors["binType"+index]="Choose a bin colour.";
    if(!Number.isSafeInteger(Number(bin?.count)) ||
       Number(bin?.count)<1 || Number(bin?.count)>200)
      errors["binCount"+index]="Enter a quantity between 1 and 200.";
    if(["comm_gt660_4w","comm_gt660_oneoff"].includes(bin?.planId) &&
       bin.sizeLitres!==660 && bin.sizeLitres!==1100)
      errors["binSize"+index]="Select 660L or 1100L.";
  }
  if(String(discountCode).trim() && !discountValid)
    errors.discount="Check your discount code or remove it.";
  if(!String(address).trim())errors.address="Enter your full service address.";
  else if(!hasNiPostcode)
    errors.address="Include the full BT postcode in your address.";
  if(!String(phone).trim())errors.phone="Enter a contact number.";
  else if(!validPhone)errors.phone="Enter a valid UK mobile or landline number.";
  const mail=String(email).trim();
  if(!mail)errors.email="Enter your email address.";
  else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))
    errors.email="Enter a valid email address.";
  if(!termsConfirmed||!agreeToTerms)
    errors.terms="Review the Terms, then select Confirm & Agree.";
  return errors;
}
export function bookingFieldTarget(key) {
  if(/^binType\d+$/.test(key))return "booking-bin-type-"+key.slice(7);
  if(/^binCount\d+$/.test(key))return "booking-bin-count-"+key.slice(8);
  if(/^binSize\d+$/.test(key))return "large-bin-size-"+key.slice(7);
  return ({
    name:"booking-customer-name",
    discount:"booking-discount-code",
    address:"booking-address-input",
    phone:"booking-contact-phone",
    email:"booking-contact-email",
    terms:"booking-terms-open",
  })[key]||"booking-form-error-summary";
}


/**
 * Carry the same council-matched date the customer saw in the booking form
 * to the receipt screen. This is display evidence, NOT proof that Squeegee
 * created an appointment. Never show an incomplete, stale or altered
 * browser snapshot as a confirmed booking.
 */
export function matchedBookingDatePreview(snapshot,{address="",bins=[]}={}) {
  const postcodeMatch=String(address).toUpperCase().match(/\bBT\d{1,2}[A-Z0-9]?\s*\d[A-Z]{2}\b/);
  if(!postcodeMatch || snapshot?.version!==1 ||
     snapshot?.matched!==true || !Array.isArray(snapshot.results) ||
     !Array.isArray(bins) || bins.length<1 ||
     snapshot.results.length!==bins.length)return null;
  const normalizedPostcode=value=>String(value||"").toUpperCase().replace(/\s+/g,"");
  if(normalizedPostcode(snapshot.postcode)!==
     normalizedPostcode(postcodeMatch[0]))return null;
  const normalizeBin=value=>String(value||"").trim().replace(/\s+bin$/i,"").toUpperCase();
  const results=[];
  for(let i=0;i<bins.length;i++){
    const row=snapshot.results[i];
    const date=String(row?.assignedCleanDate||"");
    if(row?.automatic!==true || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
       normalizeBin(row?.type)!==normalizeBin(bins[i]?.type))return null;
    const parsed=new Date(date+"T12:00:00Z");
    if(!Number.isFinite(parsed.getTime()) ||
       parsed.toISOString().slice(0,10)!==date)return null;
    results.push({bin:String(bins[i].type).trim(),assignedCleanDate:date});
  }
  return {source:"council_lookup_display_only",results};
}
