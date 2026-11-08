"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {matchCustomers,matchCustomersAcrossPages,normalName,addressKey,
  detectDuplicateSignals}=
  require("../netlify/functions/lib/squeegeeCustomerMatcher");

const A="33333333-3333-4333-8333-333333333333";
const B="44444444-4444-4444-8444-444444444444";
const booking={
  name:"Gavin Stevenson",
  address:"78 Groomsport Rd, Bangor BT20 5NF",
  email:"new-contact@example.org",
  phone:"02891469191",
};
const existing={
  _id:A,
  name:"GAVIN  STEVENSON",
  address:{addressDescription:"78 Groomsport Road, Bangor BT20 5NF"},
  email:"old-contact@example.org",
  phoneNumber:"07700900123",
  status:"active",
};
test("case/spacing and RD/ROAD normalisation still require the full postcode and street",()=>{
  assert.equal(normalName(" Gavin   Stevenson "),"GAVIN STEVENSON");
  assert.equal(addressKey(existing.address),addressKey(booking.address));
  assert.notEqual(addressKey("78 Another Road, Bangor BT20 5NF"),addressKey(booking.address));
});
test("same customer full name + full property match even if BOTH email and phone differ",()=>{
  const found=matchCustomers(booking,[existing]);
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"exact_property_and_name");
  assert.equal(found.customerId,A);
});
test("missing matching name and contact is still ambiguous at a shared address",()=>{
  const found=matchCustomers(booking,[{...existing,name:"Different Resident"}]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_without_name_or_contact_match");
});
test("matching address with same surname only is never an exact-name match",()=>{
  const found=matchCustomers(booking,[{...existing,name:"Mary Stevenson"}]);
  assert.equal(found.status,"needs_review");
});
test("two exact name+address customers are never selected arbitrarily",()=>{
  const found=matchCustomers(booking,[existing,{...existing,_id:B}]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"multiple_name_address_matches");
});
test("conflicting name and contact matches at the same address require review",()=>{
  const contactRow={...existing,_id:B,name:"Other Person",email:booking.email};
  const found=matchCustomers(booking,[existing,contactRow]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"conflicting_name_and_contact_matches");
});
test("same name + email + phone at another address reuses the existing customer",()=>{
  const request={...booking,email:existing.email,phone:existing.phoneNumber,
    address:"33 Ballycrochan Avenue, Bangor BT19 7LA"};
  const old={...existing,address:{addressDescription:
    "34 Ballycrochan Avenue, Bangor BT19 7LA"}};
  const found=matchCustomers(request,[old]);
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"exact_identity_other_property");
  assert.equal(found.customerId,A);
});
test("same email and name at another address, but changed phone, does not auto-link",()=>{
  const found=matchCustomers({...booking,email:existing.email,
    address:"33 Ballycrochan Avenue, Bangor BT19 7LA"},[{
      ...existing,address:{addressDescription:
        "34 Ballycrochan Avenue, Bangor BT19 7LA"},
  }]);
  assert.equal(found.status,"not_found");
});
test("two records with the same complete identity require manual review",()=>{
  const request={...booking,email:existing.email,phone:existing.phoneNumber,
    address:"33 Ballycrochan Avenue, Bangor BT19 7LA"};
  const found=matchCustomers(request,[
    {...existing,address:{addressDescription:
      "34 Ballycrochan Avenue, Bangor BT19 7LA"}},
    {...existing,_id:B,address:{addressDescription:
      "35 Ballycrochan Avenue, Bangor BT19 7LA"}},
  ]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"multiple_exact_customer_identities");
});
test("a previously duplicated customer at the new property creates an identity conflict",()=>{
  const request={...booking,email:existing.email,phone:existing.phoneNumber,
    address:"33 Ballycrochan Avenue, Bangor BT19 7LA"};
  const found=matchCustomers(request,[
    {...existing,address:{addressDescription:
      "34 Ballycrochan Avenue, Bangor BT19 7LA"}},
    {...existing,_id:B,email:"different@example.org",
      phoneNumber:"07000000000",address:{addressDescription:
      "33 Ballycrochan Avenue, Bangor BT19 7LA"}},
  ]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"conflicting_property_and_identity_accounts");
});
test("nearby property with same house number+postcode but other street is not reused",()=>{
  const found=matchCustomers(booking,[{
    ...existing,address:{addressDescription:"78 Other Road, Bangor BT20 5NF"},
  }]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"possible_existing_address");
});
test("inactive and deactivated exact-name+property customers are marked for reactivation, not duplicated",()=>{
  for(const status of ["inactive","deactivated"]) {
    const found=matchCustomers(booking,[{...existing,status}]);
    assert.equal(found.status,"reactivation_required");
    assert.equal(found.reason,"existing_customer_requires_reactivation");
    assert.equal(found.customerId,A);
    assert.equal(found.matchReason,"exact_property_and_name");
  }
});
test("deleted, cancelled or archived customers are not blindly reactivated",()=>{
  for(const status of ["deleted","cancelled","archived","canceled"]) {
    const found=matchCustomers(booking,[{...existing,status}]);
    assert.equal(found.status,"needs_review");
  }
});
test("full pagination can find matching name/address with changed contacts on final page",async()=>{
  const match=await matchCustomersAcrossPages(booking,async({page})=>({
    customers:page===19?[existing]:[],
    page,hasMore:page<19,pageSize:100,
  }),{maxPages:25});
  assert.equal(match.status,"matched");
  assert.equal(match.reason,"exact_property_and_name");
  assert.equal(match.pagesScanned,19);
  assert.equal(match.customerId,A);
});


test("same address + email and phone is NOT sufficient when the registered full name differs",()=>{
  const other={...existing,name:"Different Registered Customer",
    email:booking.email,phoneNumber:booking.phone};
  const found=matchCustomers(booking,[other]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_contact_name_conflict");
});


test("legacy first-name-only customer matches exact property and unique phone despite new email",()=>{
  const old={...existing,name:"Gavin",phoneNumber:booking.phone,
    email:"gavin@example.org"};
  const found=matchCustomers(booking,[old]);
  assert.equal(found.status,"matched");
  assert.equal(found.customerId,A);
  assert.equal(found.reason,"exact_property_first_name_phone");
  const flags=detectDuplicateSignals(booking,[old]);
  assert.ok(!flags.includes("address_registered_to_other_name"));
});
test("first-name-only match works after scanning all Squeegee customer pages",async()=>{
  const old={...existing,name:"Gavin",phoneNumber:booking.phone,
    email:"gavin@example.org"};
  const found=await matchCustomersAcrossPages(booking,async({page})=>({
    customers:page===3?[old]:[],hasMore:page<3,page,
  }),{maxPages:5});
  assert.equal(found.status,"matched");
  assert.equal(found.reason,"exact_property_first_name_phone");
  assert.equal(found.pagesScanned,3);
});
test("first-name-only matching requires exact phone and never accepts email alone",()=>{
  const row={...existing,name:"Gavin",email:booking.email};
  const found=matchCustomers(booking,[row]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_contact_name_conflict");
});
test("different full surname at same property still requires manual review",()=>{
  const row={...existing,name:"Gavin McDonald",
    phoneNumber:booking.phone,email:booking.email};
  const found=matchCustomers(booking,[row]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_contact_name_conflict");
});
test("a matching first name and phone never overrides duplicate residents at one property",()=>{
  const row={...existing,name:"Gavin",phoneNumber:booking.phone,
    email:"gavin@example.org"};
  const housemate={...existing,_id:B,name:"Different Resident",
    phoneNumber:"07444000123",email:"housemate@example.org"};
  const found=matchCustomers(booking,[row,housemate]);
  assert.equal(found.status,"needs_review");
  const flags=detectDuplicateSignals(booking,[row,housemate]);
  assert.ok(flags.includes("multiple_records_at_address"));
});
test("a first-name-only match does not reuse a phone shared with another account",()=>{
  const row={...existing,name:"Gavin",phoneNumber:booking.phone};
  const other={...existing,_id:B,name:"Different Customer",
    address:{addressDescription:"21 Other Street, Bangor BT20 5NF"},
    phoneNumber:booking.phone};
  const found=matchCustomers(booking,[row,other]);
  assert.equal(found.status,"needs_review");
  assert.equal(found.reason,"same_address_contact_name_conflict");
});
test("first-name-only inactive account stays inactive and requires owner reactivation",()=>{
  const row={...existing,name:"Gavin",phoneNumber:booking.phone,status:"inactive"};
  const found=matchCustomers(booking,[row]);
  assert.equal(found.status,"reactivation_required");
  assert.equal(found.matchReason,"exact_property_first_name_phone");
});
