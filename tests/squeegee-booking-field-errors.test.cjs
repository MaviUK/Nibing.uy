"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const helper=()=>import(pathToFileURL(path.resolve(__dirname,"../src/bookingFormValidation.mjs")).href);
const valid={name:"Test Client",email:"test@example.org",phone:"07123456789",
  address:"7 Test Road Bangor BT20 4AA",hasNiPostcode:true,validPhone:true,
  bins:[{type:"Black Bin",count:1,planId:"domestic_4w"}],
  termsConfirmed:true,agreeToTerms:true};
test("valid form passes without clearing or modifying booking details",async()=>{
  const {validateArcadeBookingFields}=await helper();
  assert.deepEqual(validateArcadeBookingFields(valid),{});
  assert.equal(valid.address,"7 Test Road Bangor BT20 4AA");
});
test("missing UK postcode, bad email, contact and empty name produce field errors",async()=>{
  const {validateArcadeBookingFields}=await helper();
  const errors=validateArcadeBookingFields({...valid,name:"   ",email:"bad",
    hasNiPostcode:false,validPhone:false});
  for(const k of ["name","address","email","phone"])assert.equal(typeof errors[k],"string");
  assert.match(errors.address,/BT postcode/);
});
test("missing commercial size, empty bin, bad count and invalid discount are pinpointed",async()=>{
  const {validateArcadeBookingFields}=await helper();
  const errors=validateArcadeBookingFields({...valid,
    bins:[{type:"",count:0,planId:"comm_gt660_4w",sizeLitres:null}],
    discountCode:"FAKE",discountValid:false});
  for(const k of ["binType0","binCount0","binSize0","discount"])
    assert.equal(typeof errors[k],"string");
});
test("acceptance remains locked until modal confirmation",async()=>{
  const {validateArcadeBookingFields}=await helper();
  assert.ok(validateArcadeBookingFields({...valid,termsConfirmed:false}).terms);
  assert.ok(validateArcadeBookingFields({...valid,agreeToTerms:false}).terms);
});
test("every validation error focuses a stable visible field",async()=>{
  const {bookingFieldTarget}=await helper();
  assert.equal(bookingFieldTarget("binType3"),"booking-bin-type-3");
  assert.equal(bookingFieldTarget("binCount3"),"booking-bin-count-3");
  assert.equal(bookingFieldTarget("binSize3"),"large-bin-size-3");
  assert.equal(bookingFieldTarget("address"),"booking-address-input");
});
