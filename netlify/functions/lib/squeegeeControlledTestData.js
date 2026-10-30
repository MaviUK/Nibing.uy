"use strict";

const TEST_REFERENCE="NBG-P77-CONTROLLED-TEST-20261030-R11";
const TEST_CUSTOMER={
  name:"NI BIN GUY - API TEST - DO NOT CLEAN",
  address:{text:"API TEST RECORD - DO NOT VISIT, BANGOR BT20 4AA"},
  reference:TEST_REFERENCE,
  notes:"TEST RECORD ONLY. DO NOT VISIT, CLEAN, INVOICE OR BILL. Created solely to validate NI Bin Guy Preview 1 Squeegee API integration; remove manually after verification.",
};
const FIRST_DATE="2026-11-02";
const CLEAN_TYPE="Black";
const GROUP_NUMBER=11;
const TEST_JOB_NOTES="TEST ONLY: NI BIN GUY API integration. DO NOT VISIT, CLEAN, INVOICE OR BILL. 4-weekly black bin, Round 11, first clean 2026-11-02. Remove this test job after verification.";

function createTestJob({serviceId,groupId}){
  return {
    date:FIRST_DATE,
    frequencyType:"weeks",
    frequencyInterval:4,
    services:[serviceId],
    jobGroup:groupId,
    notes:TEST_JOB_NOTES,
    tags:[],
    firstAppointment:{initialDate:FIRST_DATE,tags:[]},
    price:0,
  };
}
function pickUnique(rows,name){
  const matched=(Array.isArray(rows)?rows:[]).filter(r=>String(r?.description||"").trim()===name);
  if(matched.length!==1||!/^[0-9a-f]{8}(-[0-9a-f]{4}){4}$/i.test(matched[0].id)){
    return {ok:false,error:"No unique valid ID for "+name};
  }
  return {ok:true,id:matched[0].id};
}
module.exports={TEST_REFERENCE,TEST_CUSTOMER,FIRST_DATE,CLEAN_TYPE,GROUP_NUMBER,
  TEST_JOB_NOTES,createTestJob,pickUnique};