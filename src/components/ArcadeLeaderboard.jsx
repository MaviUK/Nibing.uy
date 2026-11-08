import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { scrollToArcadeTabs, stabilizeArcadeTabScroll } from "./scrollToArcadeBoardStart.mjs";

const REFRESH_MS = 10000;
const ENDPOINT = "/.netlify/functions/arcadeLeaderboard";
const PRODUCTION_ENDPOINT="/api/n64-production-leaderboard";
const LIVE_N64=typeof window!=="undefined"&&window.location.hostname==="nibing.uy";
const CUSTOMER_SUMMARY_ENDPOINT="/api/customer-hq?view=rank-summary";
const OWNER_ENDPOINT="/api/squeegee-preview-verified-leaderboard";
const OWNER_LOGIN_RETURN="/?ntl-drawer-state=hidden&owner-board=1&owner-auth-complete=1#live-leaderboard";
const OWNER_LOGIN_URL="/api/squeegee-preview-test?returnTo="+encodeURIComponent(OWNER_LOGIN_RETURN);
const CustomerHQ=React.lazy(()=>import("../pages/CustomerHQ"));

function TopFiveCleanRecords({values,unit="cleans",label}){
  if(!Array.isArray(values)||values.length===0)
    return <div className="n64-record-no-results">No qualifying records</div>;
  return <ol className="n64-record-ranks" aria-label={label}>
    {values.slice(0,5).map((row,i)=>
      <li key={i}>
        <span className="n64-record-rank-number">
          #{String(i+1).padStart(2,"0")}
          {i<3 && <span className="n64-record-medal" role="img"
            aria-label={["Gold medal","Silver medal","Bronze medal"][i]}>
            {["🥇","🥈","🥉"][i]}
          </span>}
        </span>
        <span className="n64-record-person">
          <strong>{row.displayName}</strong>
          <span>{row.town} · {row.points.toLocaleString("en-GB")} XP</span>
        </span>
        <strong className="n64-record-rank-result">{row.cleans.toLocaleString("en-GB")} <small>{unit}</small></strong>
      </li>
    )}
  </ol>;
}

export default function ArcadeLeaderboard() {
  const [players, setPlayers] = useState([]);
  const [selectedYear,setSelectedYear] = useState("overall");
  const [availableYears,setAvailableYears] = useState(() =>
    Array.from({length:Math.max(0,new Date().getFullYear()-2023)},(_,i)=>2024+i)
  );
  const [publicShownCount,setPublicShownCount] = useState(20);
  const [publicNamedCount,setPublicNamedCount] = useState(0);
  // The owner-only view is accessible via a deliberate deep link, not a
  // visible sign-in requirement on the public leaderboard.
  const [showOwnerControls] = useState(()=>
    new URLSearchParams(window.location.search).get("owner-board")==="1"
  );
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connection, setConnection] = useState("connecting");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [historyStatus, setHistoryStatus] = useState(null);
  const [publicAchievements,setPublicAchievements]=useState(null);
  const [scoreUpdatePending,setScoreUpdatePending]=useState(false);
  const [nameConsentMode, setNameConsentMode] = useState(false);
  const [eligibilityPending, setEligibilityPending] = useState(false);
  const [eligiblePlayers, setEligiblePlayers] = useState(null);
  const [verifiedPlayers, setVerifiedPlayers] = useState(null);
  const [verifiedAsOf, setVerifiedAsOf] = useState(null);
  const [eligibleCleaningXp, setEligibleCleaningXp] = useState(null);
  const [activePanel, setActivePanel] = useState("leaderboard");
  const [showPointsGuide,setShowPointsGuide]=useState(false);
  const pointsGuideTriggerRef=useRef(null);
  const pointsGuideDialogRef=useRef(null);

  // Keep the XP explanation usable on Android and from a keyboard.
  useEffect(()=>{
    if(!showPointsGuide)return;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    pointsGuideDialogRef.current?.focus();
    const onKeyDown=(event)=>{
      if(event.key==="Escape"){
        event.preventDefault();
        setShowPointsGuide(false);
        return;
      }
      if(event.key!=="Tab")return;
      const focusable=Array.from(pointsGuideDialogRef.current?.querySelectorAll(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
      )||[]);
      if(focusable.length<1)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener("keydown",onKeyDown);
    return ()=>{
      document.body.style.overflow=oldOverflow;
      document.removeEventListener("keydown",onKeyDown);
      pointsGuideTriggerRef.current?.focus();
    };
  },[showPointsGuide]);
  // A requested owner test starts on the private test panel, not the public
  // anonymous leaderboard while the owner session is being checked.
  const [rankingMode,setRankingMode]=useState(()=>
    new URLSearchParams(window.location.search).get("owner-board")==="1"
      ? "owner" : "public"
  );
  const [ownerPresentation,setOwnerPresentation]=useState("simulation");
  const [ownerState,setOwnerState]=useState("idle");
  const ownerRedirectRequested=useRef(false);
  const [ownerRows,setOwnerRows]=useState([]);
  const [ownerInfo,setOwnerInfo]=useState(null);
  const [ownerSearch,setOwnerSearch]=useState("");
  const [ownerShowCount,setOwnerShowCount]=useState(20);
  // Retain the code-challenge state when switching between the two panels.
  const [hqOpened, setHqOpened] = useState(false);
  const boardSectionRef = useRef(null);
  const boardTabsRef = useRef(null);
  const scrollOnPanelChange = useRef(false);
  const cancelPanelScroll = useRef(null);

  const selectPanel = (panel) => {
    // First position the stable tab row while the public ranking is still
    // tall enough to scroll. It prevents the initial Android scroll clamp.
    cancelPanelScroll.current?.();
    cancelPanelScroll.current = null;
    scrollToArcadeTabs(boardTabsRef.current);
    if(panel === "hq") setHqOpened(true);
    if(activePanel !== panel){
      scrollOnPanelChange.current = true;
      setActivePanel(panel);
    }
  };
  const openHQ = () => selectPanel("hq");
  const openBoard = () => {
    selectPanel("leaderboard");
    window.dispatchEvent(new Event("n64:leaderboard-updated"));
  };
  const openRecords = () => {
    selectPanel("records");
    window.dispatchEvent(new Event("n64:leaderboard-updated"));
  };
  useLayoutEffect(() => {
    if(!scrollOnPanelChange.current) return;
    scrollOnPanelChange.current = false;
    // React.lazy briefly swaps the tall public board for a short loading
    // fallback, then loads Customer HQ and its account. Keep aligning to the
    // TABS (not the section container) after each height change, until the
    // panel settles or the customer starts scrolling manually.
    const panel=boardSectionRef.current?.querySelector(
      ".n64-board-tab-content:not([hidden])"
    );
    const stop=stabilizeArcadeTabScroll(boardTabsRef.current,panel);
    cancelPanelScroll.current=stop;
    return ()=>{
      stop();
      if(cancelPanelScroll.current===stop)cancelPanelScroll.current=null;
    };
  }, [activePanel]);
  const [changes, setChanges] = useState({});
  const previousPlayers = useRef(null);
  const selectYear = (period) => {
    if(selectedYear===period)return;
    setPlayers([]);
    setChanges({});
    previousPlayers.current=null;
    setPublicShownCount(20);
    setConnection("connecting");
    setPublicAchievements(null);
    setSelectedYear(period);
  };
  // Customer totals must come from a verified email-code session, NEVER from
  // this device's arcade cookie or a clicked public leaderboard entry.
  const [customerSummary,setCustomerSummary]=useState(null);
  const [customerSummaryStatus,setCustomerSummaryStatus]=useState("checking");

  function showPublicRankings(){
    setRankingMode("public");
    // No private owner ranking stays in memory after leaving the owner panel.
    setOwnerRows([]);
    setOwnerInfo(null);
    setOwnerState("idle");
    window.dispatchEvent(new Event("n64:leaderboard-updated"));
  }
  async function showOwnerRankings(){
    setRankingMode("owner");
    setOwnerPresentation("simulation");
    setOwnerRows([]);
    setOwnerInfo(null);
    setOwnerState("loading");
    setOwnerShowCount(20);
    try{
      const response=await fetch(OWNER_ENDPOINT,{
        credentials:"same-origin",cache:"no-store",
        headers:{"Accept":"application/json"}
      });
      if(response.status===401){
        setOwnerState("owner-login-required");
        // The screenshot's 401 was caused by the 20-minute owner code
        // expiring. On a deep-linked test, send the owner straight to
        // their existing email-code sign-in, then safely return here.
        // The one-time return marker stops a redirect loop if cookies fail.
        const query=new URLSearchParams(window.location.search);
        if(query.get("owner-board")==="1" &&
           query.get("owner-auth-complete")!=="1" &&
           !ownerRedirectRequested.current){
          ownerRedirectRequested.current=true;
          window.location.assign(OWNER_LOGIN_URL);
        }
        return;
      }
      if(!response.ok)throw new Error("owner_board_unavailable");
      const data=await response.json();
      if(data.ownerView!==true || data.private!==true ||
         !Array.isArray(data.entries) ||
         !Number.isInteger(data.verifiedPlayers) ||
         data.entries.length!==data.verifiedPlayers)
        throw new Error("owner_board_invalid");
      const records=data.entries.map((p,i)=>({
        rank:i+1,
        firstName:typeof p.firstName==="string"&&p.firstName.length<=40?p.firstName:null,
        town:typeof p.town==="string"?p.town.slice(0,40):"Town unavailable",
        points:Number.isSafeInteger(p.points)&&p.points>=0?p.points:0,
        permission:["approved","pending","withdrawn"].includes(p.permission)
          ?p.permission:"pending",
      }));
      setOwnerRows(records);
      setOwnerInfo({
        verifiedPlayers:data.verifiedPlayers,
        historicalCleaningXp:data.historicalCleaningXp,
        sourceAsOf:data.sourceAsOf,
        publicApprovedCount:data.publicApprovedCount,
      });
      setOwnerState("ready");
    }catch{
      setOwnerState("unavailable");
      setOwnerRows([]);
      setOwnerInfo(null);
    }
  }
  const filteredOwnerRows=ownerRows.filter(row=>{
    const query=ownerSearch.trim().toLowerCase();
    return !query || (row.firstName||"").toLowerCase().includes(query) ||
      row.town.toLowerCase().includes(query);
  });
  // Simulated permission is VIEW-ONLY. Never alter Netlify consent records;
  // do not imply an actual customer has agreed. Explicit withdrawals remain
  // excluded from the simulated public view.
  const simulatedOwnerRows=ownerRows.filter(row=>row.permission!=="withdrawn");

  useEffect(()=>{
    let active=true;
    let requestId=0;
    async function refreshCustomer(){
      const current=++requestId;
      try{
        const response=await fetch(CUSTOMER_SUMMARY_ENDPOINT,{
          cache:"no-store",credentials:"same-origin"
        });
        if(!response.ok)throw new Error("customer_summary_unavailable");
        const data=await response.json();
        if(!active || current!==requestId)return;
        if(data?.authenticated!==true || !data.summary){
          setCustomerSummary(null);
          setCustomerSummaryStatus("signed-out");
          return;
        }
        const sum=data.summary;
        if(!Number.isSafeInteger(sum.points) || sum.points<0)
          throw new Error("invalid_customer_total");
        const yearly={};
        for(const [year,stats] of Object.entries(sum.yearly||{})){
          if(!/^20\d{2}$/.test(year) || !Number.isSafeInteger(stats?.points) ||
             stats.points<=0)continue;
          yearly[year]={
            points:stats.points,
            rank:Number.isSafeInteger(stats.rank)&&stats.rank>0?stats.rank:null
          };
        }
        const verifiedYearTotal=Object.values(yearly).reduce(
          (total,entry)=>total+entry.points,0
        );
        // Dated periods MUST add up to Overall. A stale response cannot
        // silently re-credit unsupported legacy website XP.
        if(verifiedYearTotal!==sum.points)
          throw new Error("personal_xp_years_do_not_reconcile");
        setCustomerSummary({
          points:sum.points,
          overduePenaltyPoints:Number.isSafeInteger(sum.overduePenaltyPoints)
            ?sum.overduePenaltyPoints:0,
          rank:Number.isSafeInteger(sum.rank)&&sum.rank>0?sum.rank:null,
          rankingAvailable:sum.rankingAvailable===true,
          firstRecordedServiceYear:Number.isSafeInteger(sum.firstRecordedServiceYear) &&
            sum.firstRecordedServiceYear>=2000 &&
            sum.firstRecordedServiceYear<=new Date().getFullYear()
              ?sum.firstRecordedServiceYear:null,
          yearly
        });
        setCustomerSummaryStatus("ready");
      }catch{
        if(active && current===requestId){
          setCustomerSummary(null);
          setCustomerSummaryStatus("unavailable");
        }
      }
    }
    const onAccountScore=(event)=>{
      if(event?.detail?.points===null){
        // Clearing immediately prevents one account's score appearing while
        // another person signs in on the same phone.
        requestId++;
        setCustomerSummary(null);
        setCustomerSummaryStatus("signed-out");
      }else void refreshCustomer();
    };
    const onVisible=()=>{
      if(document.visibilityState==="visible")void refreshCustomer();
    };
    void refreshCustomer();
    const poll=window.setInterval(onVisible,120000);
    window.addEventListener("n64:account-score",onAccountScore);
    window.addEventListener("n64:verified-total",refreshCustomer);
    window.addEventListener("focus",onVisible);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{
      active=false;requestId++;
      window.clearInterval(poll);
      window.removeEventListener("n64:account-score",onAccountScore);
      window.removeEventListener("n64:verified-total",refreshCustomer);
      window.removeEventListener("focus",onVisible);
      document.removeEventListener("visibilitychange",onVisible);
    };
  },[]);
  // The top public leaderboard year buttons are the single selector for the
  // signed-in customer's verified XP and position too. Missing annual points
  // are zero, never the Overall balance or a stale selection.
  const shownCustomerStats=selectedYear==="overall"
    ?{points:customerSummary?.points??0,rank:customerSummary?.rank??null}
    :customerSummary?.yearly?.[selectedYear]??{points:0,rank:null};
  const noCustomerXpInYear=Boolean(customerSummary &&
    selectedYear!=="overall" && shownCustomerStats.points===0);
  const noRecordedCustomerHistoryInYear=noCustomerXpInYear &&
    Number.isSafeInteger(customerSummary.firstRecordedServiceYear) &&
    Number(selectedYear)<customerSummary.firstRecordedServiceYear;

  useEffect(() => {
    let mounted = true;
    let busy = false;
    let refreshAgain = false;

    async function refresh() {
      if (!mounted || document.visibilityState === "hidden") return;
      if (busy) { refreshAgain = true; return; }
      busy = true;
      try {
        const currentEndpoint=window.location.hostname==="nibing.uy"
          ?PRODUCTION_ENDPOINT:ENDPOINT;
        const url=selectedYear==="overall"?currentEndpoint:
          currentEndpoint+"?year="+encodeURIComponent(selectedYear);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Leaderboard temporarily unavailable");
        const data = await response.json();
        if (!mounted) return;
        // Never display an Overall score as an annual score.
        if(selectedYear!=="overall" && data.period!==selectedYear)
          throw new Error("Unexpected leaderboard year");
        if(Array.isArray(data.availableYears)&&
           data.availableYears.every(y=>Number.isInteger(y)&&y>=2024&&y<=2099))
          setAvailableYears(data.availableYears);
        const publicScores=data.status==="public_eligible_scores" ||
          data.status==="preview_public_first_names";
        const next = Array.isArray(data.entries)
          ? data.entries.slice(0, publicScores?700:10).map((p, i) => ({
              rank: i + 1,
              customerRef: String(p.customerRef || "NBG-UNKNOWN").slice(0, 20),
              displayName: typeof p.displayName === "string"
                ? p.displayName.slice(0, 40) : null,
              anonymous: publicScores && p.anonymous===true,
              town: String(p.town || "Town unavailable").slice(0, 32),
              points: Number(p.points || 0),
            }))
          : [];

        if (previousPlayers.current !== null) {
          const before = previousPlayers.current;
          const movement = {};
          next.forEach((player) => {
            const old = before.find((p) => p.customerRef === player.customerRef);
            if (!old) movement[player.customerRef] = "new";
            else if (old.rank > player.rank) movement[player.customerRef] = "up";
            else if (old.rank < player.rank) movement[player.customerRef] = "down";
            else if (old.points !== player.points) movement[player.customerRef] = "points";
          });
          setChanges(movement);
        }
        previousPlayers.current = next;
        setPlayers(next);
        setTotalPlayers(Number.isFinite(Number(data.totalPlayers))
          ? Math.max(0, Number(data.totalPlayers)) : next.length);
        setUpdatedAt(new Date());
        setHistoryStatus(data.status === "active_status_refresh_required" ? data.status : null);
        setScoreUpdatePending(data.scoreUpdatePending===true);
        const records=data.publicAchievements;
        const colours=["Black","Blue","Green & Brown"];
        const cleanCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
        const validFirstName=value=>typeof value==="string"&&
          /^[\p{L}][\p{L}'’\-]{0,39}$/u.test(value);
        const validPublicTown=value=>typeof value==="string"&&
          value.length>1&&value.length<=80&&value!=="Town unavailable";
        const validTopFive=(list,leader)=>
          Array.isArray(list)&&list.length<=5&&
          list.every((row,i)=>row&&
            validFirstName(row.displayName)&&validPublicTown(row.town)&&
            cleanCount(row.points)&&cleanCount(row.cleans)&&row.cleans>0&&
            (i===0||row.cleans<=list[i-1].cleans))&&
          (list[0]?.cleans||0)===leader;
        const safeRecords=records?.status==="preview_public_named_records"&&
          records.period===selectedYear&&data.period===selectedYear&&
          /^20\d{2}-\d{2}-\d{2}$/.test(records.sourceAsOf||"")&&
          /^20\d{2}-\d{2}-\d{2}$/.test(records.periodEnd||"")&&
          Array.isArray(records.colours)&&records.colours.length===3&&
          records.colours.every((row,i)=>row?.colour===colours[i]&&
            cleanCount(row.current)&&cleanCount(row.highest)&&
            validTopFive(row.currentTop,row.current)&&
            validTopFive(row.highestTop,row.highest))&&
          cleanCount(records.longestJobCurrent)&&
          validTopFive(records.longestJobCurrentTop,records.longestJobCurrent)&&
          cleanCount(records.longestJobHighest)&&
          validTopFive(records.longestJobHighestTop,records.longestJobHighest)&&
          cleanCount(records.longestAllJobsCurrent)&&
          validTopFive(records.longestAllJobsCurrentTop,records.longestAllJobsCurrent)&&
          cleanCount(records.longestAllJobsHighest)&&
          validTopFive(records.longestAllJobsHighestTop,records.longestAllJobsHighest);
        setPublicAchievements(safeRecords?records:null);
        setNameConsentMode(data.status === "consent_only" || data.status === "consent_pending" ||
          data.status === "public_eligible_scores" ||
          data.status === "preview_public_first_names");
        setPublicNamedCount(Number.isInteger(data.publicNamedCount)
          ? data.publicNamedCount:0);
        setEligibilityPending(data.status === "eligibility_pending");
        setEligiblePlayers(Number.isInteger(data.eligiblePlayers) ? data.eligiblePlayers : null);
        setVerifiedPlayers(Number.isInteger(data.verifiedPlayers) ? data.verifiedPlayers : null);
        setVerifiedAsOf(/^\d{4}-\d{2}-\d{2}$/.test(data.verifiedAsOf||"")
          ? data.verifiedAsOf : null);
        setEligibleCleaningXp(Number.isSafeInteger(data.eligibleCleaningXp)
          ? Math.max(0,data.eligibleCleaningXp) : null);
        setConnection("live");
      } catch (_) {
        if (mounted) {
          setPublicAchievements(null);
          setConnection("reconnecting");
        }
      } finally {
        busy = false;
        if (refreshAgain) {
          refreshAgain = false;
          void refresh();
        }
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    if(new URLSearchParams(window.location.search).get("owner-board")==="1")
      void showOwnerRankings();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, selectedYear==="overall"?REFRESH_MS:60000);
    window.addEventListener("n64:leaderboard-updated", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("n64:leaderboard-updated", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selectedYear]);


  return (
    <section ref={boardSectionRef} id="live-leaderboard" className="n64-public-leaderboard" aria-labelledby="n64-board-title">
      <div className={"n64-public-board-inner"+(activePanel==="hq"?" n64-public-board-inner--hq":activePanel==="records"?" n64-public-board-inner--records":"")}>
        <div ref={boardTabsRef} className={"n64-board-tabs"+" n64-board-tabs--three"} role="group" aria-label="Leaderboard, Records and Customer HQ">
          <button type="button" className={activePanel==="leaderboard"?"n64-board-tab n64-board-tab--selected":"n64-board-tab"}
            aria-pressed={activePanel==="leaderboard"} onClick={openBoard}>★ LEADERBOARDS</button>
          <button type="button"
            className={activePanel==="records"?"n64-board-tab n64-board-tab--selected":"n64-board-tab"}
            aria-pressed={activePanel==="records"} onClick={openRecords}>★ RECORDS</button>
          <button type="button" className={activePanel==="hq"?"n64-board-tab n64-board-tab--selected":"n64-board-tab"}
            aria-pressed={activePanel==="hq"} onClick={openHQ}>★ CUSTOMER HQ</button>
        </div>
        <div className="n64-board-tab-content" hidden={activePanel!=="leaderboard"}>
        <h2 id="n64-board-title">{rankingMode==="owner"?"Verified Customer Rankings":
          selectedYear==="overall"?"Global Leaderboard":selectedYear+" Leaderboard"}</h2>
        {showOwnerControls && <div className="n64-rank-visibility" role="group" aria-label="Ranking visibility">
          <button type="button" className={rankingMode==="public"?"n64-rank-visibility--active":""}
            aria-pressed={rankingMode==="public"} onClick={showPublicRankings}>
            PUBLIC LEADERBOARD
          </button>
          <button type="button" className={rankingMode==="owner"?"n64-rank-visibility--active":""}
            aria-pressed={rankingMode==="owner"} onClick={showOwnerRankings}>
            TEST: ALL FIRST NAMES
          </button>
        </div>}
        <div hidden={rankingMode!=="public"} className="n64-rank-public">
        <div className="n64-leaderboard-years" role="group" aria-label="Choose leaderboard year">
          {["overall",...availableYears].map(period=>
            <button type="button" key={period}
              aria-pressed={selectedYear===String(period)}
              className={selectedYear===String(period)?"n64-year-selected":""}
              onClick={()=>selectYear(String(period))}>
              {period==="overall"?"OVERALL":period}
            </button>
          )}
        </div>

        <div className="n64-your-score n64-personal-score"
          aria-label={selectedYear==="overall"
            ?"Your verified overall XP and leaderboard position"
            :"Your verified "+selectedYear+" XP and leaderboard position"}>
          <div className="n64-personal-total">
            <strong>★ {selectedYear==="overall"?"TOTAL XP":selectedYear+" XP"}</strong>
            <span>{customerSummary
              ?shownCustomerStats.points.toLocaleString("en-GB")+" XP"
              :customerSummaryStatus==="checking"?"CHECKING…":"—"}</span>
          </div>
          {customerSummary ? <>
            <div className="n64-personal-position">
              <strong>LEADERBOARD POSITION</strong>
              <span>{noCustomerXpInYear?"—":shownCustomerStats.rank
                ?"#"+shownCustomerStats.rank.toLocaleString("en-GB")
                :customerSummary.rankingAvailable
                  ?"NOT PUBLICLY RANKED":"UNAVAILABLE"}</span>
            </div>
            {noCustomerXpInYear &&
              <p className="n64-personal-period-note" role="status">
                {noRecordedCustomerHistoryInYear
                  ?"No customer history recorded for "+selectedYear+"."
                  :"No verified XP recorded for "+selectedYear+"."}
              </p>}
            {selectedYear==="overall" && customerSummary.overduePenaltyPoints>0 &&
              <small>Includes {customerSummary.overduePenaltyPoints.toLocaleString("en-GB")} XP in verified overdue-job deductions.</small>}
            {customerSummary.rankingAvailable===false && !noCustomerXpInYear &&
              <small>Your verified XP is available, but the public ranking is temporarily unavailable.</small>}
          </> : <small>
            {customerSummaryStatus==="checking"
              ?"Checking for your signed-in cleaning account…"
              :customerSummaryStatus==="unavailable"
              ?"Your total XP and position are temporarily unavailable. Open My Customer HQ to try again."
              :"Sign in to see your total XP, leaderboard position and years with points."}
          </small>}
        </div>


        {scoreUpdatePending && <p className="n64-board-error" role="status">
          <strong>LEADERBOARD SCORE UPDATE PENDING.</strong> The current historical XP
          still uses the earlier customer-wide streak calculation. Each Squeegee
          job will receive its own streak after the owner imports a fresh,
          verified Squeegee backup. These scores have not yet been recalculated.
        </p>}
        <div className="n64-board-join-cta">
          <button type="button" onClick={openHQ}>★ SIGN IN / VIEW MY CLEANING POINTS →</button>
        </div>

        <ol aria-label="Public leaderboard rankings">
          {!players.length ? (
            <li className="n64-board-empty">
              <span>{connection !== "live" ? "Connecting to the leaderboard…" : eligibilityPending
                ? "Verifying customers with registered emails."
                : nameConsentMode && selectedYear!=="overall"
                ? "No verified XP recorded for "+selectedYear+" among eligible customers."
                : nameConsentMode
                ? "Public scores are being prepared."
                : "No registered public players yet."}</span>
              {nameConsentMode && <small>
                {verifiedPlayers!==null
                  ? verifiedPlayers.toLocaleString("en-GB")+" Squeegee accounts are verified from the "+
                    (verifiedAsOf||"imported")+" backup. "
                  : eligiblePlayers!==null
                    ? eligiblePlayers.toLocaleString("en-GB")+" customers are email-eligible. " : ""}
                {eligibleCleaningXp!==null ? eligibleCleaningXp.toLocaleString("en-GB")+" cleaning XP are safely recorded. " : ""}
                First name, town and cleaning points appear on the {LIVE_N64?"public leaderboard":"N64 test leaderboard"}. Sign in to My Customer HQ for your own private breakdown.
              </small>}
            </li>
          ) : players.slice(0,publicShownCount).map((player, i) => {
            const change = changes[player.customerRef];
            return (
              <li key={player.customerRef}
                className={change ? "n64-board-row n64-board-row--" + change : "n64-board-row"}>
                <button type="button" className="n64-board-player-button" onClick={openHQ}
                  title="Open your own secure points dashboard — this public entry does not grant access to another customer's account">
                  <strong>{String(i + 1).padStart(2, "0")}</strong>
                  {i<3 && <span className="n64-board-medal" role="img"
                    aria-label={["Gold medal","Silver medal","Bronze medal"][i]}>
                    {["🥇","🥈","🥉"][i]}
                  </span>}
                  {" "}{player.anonymous?"ARCADE PLAYER "+String(i+1):player.displayName||player.customerRef}
                  {player.town!=="Town unavailable" && <span className="n64-board-town"> · {player.town}</span>}
                </button>
                <span className="n64-board-score">
                  {change && <em className="n64-rank-change" aria-label={
                    change === "new" ? "New player" :
                    change === "up" ? "Rank up" :
                    change === "down" ? "Rank down" : "Score increased"
                  }>{change === "new" ? "NEW" : change === "up" ? "↑" : change === "down" ? "↓" : "+"}</em>}
                  <strong>{player.points.toLocaleString("en-GB")} XP</strong>
                </span>
              </li>
            );
          })}
        </ol>
        {players.length>publicShownCount && <div className="n64-board-join-cta">
          <button type="button" onClick={()=>setPublicShownCount(n=>n+25)}>
            SHOW MORE PUBLIC SCORES ↓
          </button>
        </div>}
        {connection === "reconnecting" && (
          <p className="n64-board-error" role="status">
            The leaderboard server is temporarily unavailable. Your device XP is unaffected; retrying automatically.
          </p>
        )}
        <div className="n64-points-help-trigger">
          <button type="button" ref={pointsGuideTriggerRef}
            onClick={()=>setShowPointsGuide(true)}
            aria-haspopup="dialog" aria-expanded={showPointsGuide}
            aria-controls="n64-points-guide-dialog">
            <span aria-hidden="true">★</span> HOW DO I EARN &amp; LOSE XP? <span aria-hidden="true">?</span>
          </button>
        </div>
        {showPointsGuide && createPortal(
          <div className="n64-points-guide-backdrop"
            onClick={event=>{
              if(event.target===event.currentTarget)setShowPointsGuide(false);
            }}>
            <section id="n64-points-guide-dialog" className="n64-points-guide"
              role="dialog" aria-modal="true" tabIndex={-1}
              aria-labelledby="n64-points-guide-title"
              aria-describedby="n64-points-guide-intro"
              ref={pointsGuideDialogRef}>
              <header className="n64-points-guide-header">
                <div>
                  <span className="n64-points-guide-kicker">★ NI BIN GUY LOYALTY XP ★</span>
                  <h2 id="n64-points-guide-title">How the Leaderboard Works</h2>
                </div>
                <button type="button" className="n64-points-guide-close"
                  aria-label="Close points guide" onClick={()=>setShowPointsGuide(false)}>✕</button>
              </header>
              <div className="n64-points-guide-body">
                <p id="n64-points-guide-intro" className="n64-points-guide-intro">
                  Earn XP for clean bins and website activities. Keep up your cleaning streak to climb the leaderboard!
                </p>
                <div className="n64-points-guide-rule n64-points-guide-rule--earn">
                  <h3>★ Earn XP for paid cleans</h3>
                  <p><strong>+20 XP per bin</strong> on the first completed, paid clean of a job.</p>
                  <p>Each consecutive clean on that job earns <strong>1 extra XP per bin</strong>.</p>
                  <div className="n64-points-guide-example" aria-label="Example of growing cleaning rewards">
                    <span>1st clean <strong>20 XP</strong></span>
                    <span>2nd <strong>21 XP</strong></span>
                    <span>3rd <strong>22 XP</strong></span>
                    <span>4th <strong>23 XP</strong></span>
                  </div>
                  <p>Multiple paid bins earn points for each bin. A clean that has not been verified as paid does not earn cleaning XP yet.</p>
                </div>
                <div className="n64-points-guide-rule n64-points-guide-rule--streak">
                  <h3>★ Keep your cleaning streak</h3>
                  <p>Consecutive cleans build a streak. <strong>A recorded skipped clean resets that job's streak</strong>, so its next paid clean starts at 20 XP per bin again.</p>
                  <p>The <strong>all-jobs-combined record streak</strong> also starts again if any job is skipped. Previously earned XP is not removed just because of a skip.</p>
                </div>
                <div className="n64-points-guide-rule n64-points-guide-rule--bonus">
                  <h3>★ Bonus website XP</h3>
                  <ul>
                    <li><strong>+150 XP</strong> for each bin in a successful 4-weekly website booking.</li>
                    <li><strong>+60 XP</strong> for each bin in a successful one-off website booking.</li>
                    <li><strong>+50 XP</strong> for completing a website level (once per level each month).</li>
                    <li><strong>+35 XP</strong> for checking your bin day, and <strong>+25 XP</strong> for checking your service area (once each).</li>
                    <li><strong>+25 XP</strong> each day for playing Free Bin Clean, visiting Customer HQ, or opening Contact Us (each activity once per day).</li>
                  </ul>
                </div>
                <div className="n64-points-guide-rule n64-points-guide-rule--lose">
                  <h3>★ Lose XP for overdue payments</h3>
                  <p>Each unpaid cleaning job has <strong>28 days</strong> before an overdue penalty starts.</p>
                  <div className="n64-points-guide-example" aria-label="Example overdue penalties per unpaid job">
                    <span>Days 1–28 <strong>0 XP</strong></span>
                    <span>Day 29 <strong>−1 XP</strong></span>
                    <span>Day 30 <strong>−2 XP total</strong></span>
                    <span>Day 31 <strong>−3 XP total</strong></span>
                  </div>
                  <p>After day 28, you lose <strong>1 XP per day for each overdue job</strong> — not an increasing number of points each day. Two jobs overdue for three penalty days cost 6 XP altogether.</p>
                  <p>Once the balance is paid, no further daily penalty is added for those jobs. Earlier penalties stay recorded, and your total XP cannot go below zero.</p>
                </div>
              </div>
              <footer className="n64-points-guide-actions">
                <button type="button" onClick={()=>setShowPointsGuide(false)}>GOT IT ✓</button>
              </footer>
            </section>
          </div>,
          document.body
        )}
        </div>
        <div className="n64-owner-ranking" hidden={rankingMode!=="owner"}>
          <p className="n64-owner-private-notice" role="status">
            <strong>OWNER TEST MODE — NOT THE PUBLIC WEBSITE.</strong> This is an
            exact-layout preview using imported first names, towns and cleaning XP.
            Participation is simulated for testing only. Customer consent records
            are unchanged and the real public leaderboard still respects them.
          </p>
          {ownerState==="loading" && <p role="status">Checking your owner session and loading verified scores…</p>}
          {ownerState==="owner-login-required" && <div className="n64-owner-login">
            <strong>OWNER CODE REQUIRED</strong>
            <p>Your owner session has expired or hasn't been verified in this
              browser. Use your existing NI Bin Guy owner email code to see the
              first-name leaderboard test. You'll return directly here after
              signing in. This does not change customer permissions.</p>
            <a href={OWNER_LOGIN_URL}>
              SIGN IN AS OWNER TO SEE FIRST NAMES →
            </a>
            <button type="button" onClick={showOwnerRankings}>
              I'VE SIGNED IN — LOAD ALL RANKINGS
            </button>
          </div>}
          {ownerState==="unavailable" && <div className="n64-owner-login" role="alert">
            <p>The private owner rankings couldn't be loaded. No customer data
              was changed. Please try again.</p>
            <button type="button" onClick={showOwnerRankings}>RETRY PRIVATE VIEW</button>
          </div>}
          {ownerState==="ready" && ownerInfo && <>
            <div className="n64-owner-summary">
              <div><strong>{simulatedOwnerRows.length.toLocaleString("en-GB")}</strong>
                <span>SIMULATED PLAYERS</span></div>
              <div><strong>{Number(ownerInfo.historicalCleaningXp||0).toLocaleString("en-GB")}</strong>
                <span>HISTORICAL CLEANING XP</span></div>
              <div><strong>{Number(ownerInfo.publicApprovedCount||0).toLocaleString("en-GB")}</strong>
                <span>ACTUAL PUBLIC PERMISSIONS</span></div>
            </div>
            <div className="n64-owner-mode-select" role="group" aria-label="Owner preview display">
              <button type="button" aria-pressed={ownerPresentation==="simulation"}
                className={ownerPresentation==="simulation"?"n64-owner-mode-active":""}
                onClick={()=>{setOwnerPresentation("simulation");setOwnerShowCount(20);}}>
                ★ TEST: SHOW ALL FIRST NAMES
              </button>
              <button type="button" aria-pressed={ownerPresentation==="review"}
                className={ownerPresentation==="review"?"n64-owner-mode-active":""}
                onClick={()=>{setOwnerPresentation("review");setOwnerShowCount(20);}}>
                VIEW REAL PERMISSION STATUS
              </button>
            </div>
            <p className="n64-owner-source">
              Owner-only preview · Squeegee backup {ownerInfo.sourceAsOf||"date unavailable"}.
              Only verified email-eligible customers count. No permission statuses
              have been altered. Accounts with recorded withdrawals remain excluded
              from the simulated display.
            </p>
            {ownerPresentation==="simulation" ? <>
              <p className="n64-owner-simulation-label">
                <strong>SIMULATED CONSENT — YOUR VIEW ONLY</strong> ·
                This is how the public leaderboard will look when customers
                have agreed to show first name, town and XP.
              </p>
              <ol className="n64-simulated-scoreboard"
                aria-label="Simulated public leaderboard first name town and points">
                {simulatedOwnerRows.slice(0,ownerShowCount).map((row,i)=>
                  <li key={row.rank} className="n64-board-row">
                    <button type="button" className="n64-board-player-button"
                      onClick={openHQ}
                      title="Open your own Customer HQ. A public rank cannot open someone else's account.">
                      <strong>{String(i+1).padStart(2,"0")}</strong>{" "}
                      {row.firstName||"Name needs checking"}
                      <span className="n64-board-town"> · {row.town}</span>
                    </button>
                    <span className="n64-board-score">
                      <strong>{row.points.toLocaleString("en-GB")} XP</strong>
                    </span>
                  </li>
                )}
              </ol>
              <div className="n64-owner-list-footer">
                Showing {Math.min(ownerShowCount,simulatedOwnerRows.length)} of
                {" "}{simulatedOwnerRows.length.toLocaleString("en-GB")} simulated players
                {simulatedOwnerRows.length>ownerShowCount &&
                  <button type="button" onClick={()=>setOwnerShowCount(n=>n+25)}>
                    SHOW 25 MORE ↓
                  </button>}
              </div>
            </> : <>
              <label className="n64-owner-search">
                <span>SEARCH VERIFIED CUSTOMERS BY FIRST NAME OR TOWN</span>
                <input type="search" value={ownerSearch}
                  onChange={e=>{setOwnerSearch(e.target.value);setOwnerShowCount(20);}}
                  placeholder="Search first name or town…" maxLength={70}/>
              </label>
              <ol aria-label="Private owner-only verified customer rankings">
                {filteredOwnerRows.slice(0,ownerShowCount).map(row=>
                  <li key={row.rank} className="n64-owner-score-row">
                    <div>
                      <strong>{String(row.rank).padStart(2,"0")} · {row.firstName||"Name needs checking"} · {row.town}</strong>
                      <small>{row.permission==="approved"?"PUBLIC PERMISSION RECORDED":
                        row.permission==="withdrawn"?"PUBLIC PERMISSION WITHDRAWN":
                        "PUBLIC PERMISSION NOT RECORDED"}</small>
                    </div>
                    <strong className="n64-owner-points">{row.points.toLocaleString("en-GB")} XP</strong>
                  </li>
                )}
              </ol>
              <div className="n64-owner-list-footer">
                {filteredOwnerRows.length.toLocaleString("en-GB")} matching verified customers
                {filteredOwnerRows.length>ownerShowCount &&
                  <button type="button" onClick={()=>setOwnerShowCount(n=>n+25)}>
                    SHOW 25 MORE ↓
                  </button>}
              </div>
            </>}
          </>}
        </div>
        </div>
        <div className="n64-board-tab-content n64-board-records-tab"
          hidden={activePanel!=="records"} aria-labelledby="n64-records-title">
          <h2 id="n64-records-title">★ Cleaning Records</h2>
          <p className="n64-records-intro">The top five streak holders for each bin, individual job and all jobs combined.</p>
          <div className="n64-leaderboard-years" role="group" aria-label="Choose records year">
            {["overall",...availableYears].map(period=>
              <button type="button" key={period}
                aria-pressed={selectedYear===String(period)}
                className={selectedYear===String(period)?"n64-year-selected":""}
                onClick={()=>selectYear(String(period))}>
                {period==="overall"?"OVERALL":period}
              </button>
            )}
          </div>
        {publicAchievements && <section
          className="n64-public-record-highlights"
          aria-label="Verified top five bin cleaning records with public name town and XP">
          <h3>★ TOP 5 BIN CLEANING RECORDS · {selectedYear==="overall"?"ALL-TIME":selectedYear}</h3>
          <p>Five highest qualifying records in each category, using the {publicAchievements.sourceAsOf} verified backup.
            {selectedYear==="overall"
              ?" Current streaks are active at the backup date."
              :" Only cleans completed in "+selectedYear+" count toward "+selectedYear+" records. Earlier-year cleans are excluded."}
            {" "}Each record lists the published first name, town and XP for that year.</p>
          <div className="n64-public-record-grid">
            {publicAchievements.colours.map(row=>
              <article key={row.colour}
                className={"n64-public-record n64-public-record--"+(row.colour==="Green & Brown"?"greenbrown":row.colour.toLowerCase())}>
                <h4>{row.colour.toUpperCase()} {row.colour==="Green & Brown"?"BINS":"BIN"} · TOP 5</h4>
                <div className="n64-record-pair">
                  <div><span className="n64-record-stat-label">
                    {selectedYear!=="overall"&&publicAchievements.periodEnd!==publicAchievements.sourceAsOf
                      ?"YEAR-END STREAKS":"CURRENT STREAKS"}
                  </span><TopFiveCleanRecords values={row.currentTop}
                    label={"Top five current "+row.colour+" bin streaks"}/></div>
                  <div><span className="n64-record-stat-label">HIGHEST REACHED</span>
                    <TopFiveCleanRecords values={row.highestTop}
                      label={"Top five historical "+row.colour+" bin streaks"}/></div>
                </div>
              </article>
            )}
          </div>
          <div className="n64-public-record-extras">
            <div>
              <h4>★ SINGLE JOB STREAKS · TOP 5</h4>
              <div className="n64-record-pair">
                <div><span className="n64-record-stat-label">CURRENT / YEAR-END</span>
                  <TopFiveCleanRecords values={publicAchievements.longestJobCurrentTop}
                    label="Top five current single job streaks"/></div>
                <div><span className="n64-record-stat-label">HIGHEST REACHED</span>
                  <TopFiveCleanRecords values={publicAchievements.longestJobHighestTop}
                    label="Top five historical single job streaks"/></div>
              </div>
            </div>
            <div>
              <h4>★ ALL JOBS COMBINED · TOP 5</h4>
              <div className="n64-record-pair">
                <div><span className="n64-record-stat-label">CURRENT / YEAR-END</span>
                  <TopFiveCleanRecords values={publicAchievements.longestAllJobsCurrentTop}
                    unit="clean-days" label="Top five current combined job streaks"/></div>
                <div><span className="n64-record-stat-label">HIGHEST REACHED</span>
                  <TopFiveCleanRecords values={publicAchievements.longestAllJobsHighestTop}
                    unit="clean-days" label="Top five historical combined job streaks"/></div>
              </div>
            </div>
          </div>
          <p className="n64-public-record-footnote">A single-job streak counts cleaning visits, not bins.
            Across-all-jobs counts distinct cleaning dates and ends when any job is skipped.
            Fewer than five entries appear where fewer qualify. Squeegee references and job details stay private.</p>
        </section>}
          {!publicAchievements && <p className="n64-records-wait" role="status">
            {connection==="reconnecting"?"Records are temporarily unavailable. Checking again…":
              connection==="live"?"No verified records available for this period. Try another year or a newer backup.":
              "Loading verified cleaning records…"}
          </p>}
        </div>
        <div className="n64-board-tab-content n64-board-hq-tab" hidden={activePanel!=="hq"}>
          {hqOpened && <React.Suspense fallback={<p role="status">Loading your secure Customer HQ…</p>}>
            <CustomerHQ embedded/>
          </React.Suspense>}
        </div>
      </div>
    </section>
  );
}
