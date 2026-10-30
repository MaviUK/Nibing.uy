"use strict";

/**
 * Group independently verified per-bin Squeegee job plans into the MINIMUM
 * number of jobs for one accepted property booking.
 *
 * A Squeegee job accepts multiple service UUIDs, but has only ONE first
 * appointment, job group, and frequency. Only jobs sharing ALL of those
 * independently verified fields may be combined. Never group by weekday
 * alone and never merge one-off services into recurring four-weekly jobs.
 *
 * This is a pure planner: NO Squeegee network calls or claims happen here.
 * The automatic worker still claims every original bin independently before
 * posting any grouped job and reconciles every member on an ambiguous POST.
 */
const {validDate}=require("./squeegeeBookingPlan");
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function groupedSqueegeeJobs(perBinJobs,bookingId) {
  if(!Array.isArray(perBinJobs)||perBinJobs.length<1||
     typeof bookingId!=="string"||
     !/^NBG-[A-Z0-9]+-[A-Z0-9]{8,12}$/i.test(bookingId)) {
    throw new Error("Invalid verified job list or booking ID");
  }

  const groups=new Map();
  const memberIndices=new Set();
  const seenServiceIds=new Set();
  for(const item of perBinJobs) {
    const input=item?.input;
    if(item?.status!=="ready" ||
       !Number.isInteger(item.index) || item.index<0 ||
       memberIndices.has(item.index) ||
       !validDate(item.date) || input?.date!==item.date ||
       input?.firstAppointment?.initialDate!==item.date ||
       !UUID_RE.test(String(input.jobGroup||"")) ||
       !Array.isArray(input.services) || input.services.length!==1 ||
       !UUID_RE.test(String(input.services[0]||"")) ||
       seenServiceIds.has(input.services[0]) ||
       !Array.isArray(input.tags) ||
       !Array.isArray(input.firstAppointment.tags) ||
       (input.frequencyType!=="weeks" && input.frequencyType!=="adhoc") ||
       (input.frequencyType==="weeks" && input.frequencyInterval!==4) ||
       (input.frequencyType==="adhoc" && input.frequencyInterval!==undefined) ||
       !Number.isInteger(item.quantity) || item.quantity<1 ||
       typeof item.bin!=="string" || !item.bin.trim() ||
       typeof input.price!=="number" ||
       !Number.isFinite(input.price) || input.price<0 ||
       !Number.isSafeInteger(Math.round(input.price*100)) ||
       Math.abs(input.price*100-Math.round(input.price*100))>0.00001) {
      throw new Error("Incomplete or inconsistent per-bin job plan");
    }
    memberIndices.add(item.index);
    seenServiceIds.add(input.services[0]);

    // A single date is not sufficient: a one-off and a four-weekly clean
    // cannot share a Squeegee recurrence even if collected on the same day.
    const groupKey=JSON.stringify([
      item.date,input.frequencyType,input.frequencyInterval??null,
      input.jobGroup,input.tags,input.firstAppointment.tags,
    ]);
    let group=groups.get(groupKey);
    if(!group) {
      group={
        members:[],
        input:{
          ...input,services:[],tags:[...input.tags],
          firstAppointment:{...input.firstAppointment,
            tags:[...input.firstAppointment.tags]},
          price:0,
        },
        pricePence:0,
      };
      groups.set(groupKey,group);
    }
    group.members.push(item);
    group.input.services.push(input.services[0]);
    group.pricePence+=Math.round(input.price*100);
    if(!Number.isSafeInteger(group.pricePence))
      throw new Error("Grouped job price is too large");
  }

  // Stable order: the first bin's position in the original booking determines
  // the position of its group. Service order follows the booking bin order.
  return [...groups.values()].map(group=>{
    group.input.price=group.pricePence/100;
    if(group.members.length>1) {
      const type=group.input.frequencyType==="weeks"?
        "Every 4 weeks":"One-off clean";
      group.input.notes=[
        "NI Bin Guy website booking: "+bookingId,
        group.members.map(item=>item.quantity+" x "+item.bin).join(" + "),
        type,"Website date: "+group.input.date,
      ].join(" | ");
    }
    delete group.pricePence;
    return group;
  });
}

module.exports={groupedSqueegeeJobs};
