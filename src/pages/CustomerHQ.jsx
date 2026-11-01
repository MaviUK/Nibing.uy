import React, {useEffect,useMemo,useState} from "react";
import "../customer-hq.css";

const API="/api/customer-hq";
function formatDate(value){
  const d=new Date(String(value||"")+"T12:00:00Z");
  return Number.isNaN(d.getTime())?String(value||""):
    d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
}
function number(value){return Number(value||0).toLocaleString("en-GB");}
async function action(body){
  const response=await fetch(API,{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({error:"service_unavailable"}));
  return {response,data};
}
function GamePanel({label,children,variant=""}){
  return <section className={"hq-panel "+variant}>
    {label&&<h2 className="hq-panel-label">{label}</h2>}
    {children}
  </section>;
}
function Score({label,value,sub,highlight=false}){
  return <div className={"hq-stat"+(highlight?" hq-stat-yellow":"")}>
    <span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}
  </div>;
}
export default function CustomerHQ({embedded=false}){
  const [loading,setLoading]=useState(true);
  const [ready,setReady]=useState(false);
  const [account,setAccount]=useState(null);
  const [permission,setPermission]=useState(null);
  const [email,setEmail]=useState("");
  const [code,setCode]=useState("");
  const [challenge,setChallenge]=useState(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [showCount,setShowCount]=useState(12);
  const [agree,setAgree]=useState(false);
  const [preferredFirstName,setPreferredFirstName]=useState("");
  const [tab,setTab]=useState("history");
  const signedIn=Boolean(account);

  async function refresh(){
    const response=await fetch(API,{cache:"no-store",credentials:"same-origin"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error("Couldn't retrieve Customer HQ right now.");
    setReady(data.ready===true);
    if(data.authenticated&&data.account){
      setAccount(data.account);
      setPermission(data.leaderboard||null);
      setPreferredFirstName(data.leaderboard?.displayedFirstName||
        data.account.firstName||"");
      setChallenge(null);setCode("");
    }else{
      setAccount(null);setPermission(null);
    }
  }
  useEffect(()=>{
    let active=true;
    async function start(){
      try{await refresh();}
      catch{if(active)setError("Customer HQ is temporarily unavailable. Please try again.");}
      finally{if(active)setLoading(false);}
    }
    void start();
    return()=>{active=false;};
  },[]);
  const recent=useMemo(()=>Array.isArray(account?.history)?
    account.history.slice(0,showCount):[],[account,showCount]);
  async function sendCode(event){
    event.preventDefault();setBusy(true);setMessage("");setError("");
    try{
      const {response,data}=await action({action:"request-code",email});
      if(!response.ok)throw new Error(response.status===503?
        "Sign-in isn't available yet. Please try later.":
        "Please enter a valid email address.");
      setChallenge(data.challengeId);setCode("");
      setMessage("If your email matches a current NI Bin Guy account, a sign-in code has been sent. Check your inbox and junk folder.");
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  async function verify(event){
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try{
      const {response}=await action({action:"verify-code",challengeId:challenge,code});
      if(!response.ok)throw new Error(response.status===401?
        "That code couldn't be verified. Check it or request a new code.":
        "We couldn't complete sign-in. Please try again.");
      await refresh();
      setMessage("You're securely signed in.");
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  async function logout(){
    setBusy(true);setError("");
    try{await action({action:"logout"});setChallenge(null);setCode("");
      setAccount(null);setPermission(null);setMessage("Signed out successfully.");
    }catch{setError("Could not sign out. Please close this tab.");}
    finally{setBusy(false);}
  }
  async function updatePermission(actionName){
    setBusy(true);setMessage("");setError("");
    try{
      const {response,data}=await action({
        action:actionName,agree:actionName==="leaderboard-opt-in"?agree:false,
        firstName:preferredFirstName,
      });
      if(!response.ok)throw new Error(data.error==="first_name_needs_verification"?
        "Please enter your correct first name.":
        "We couldn't save your choice. Please try again.");
      await refresh();setAgree(false);
      // Refresh the public board in the same home-page section instantly.
      window.dispatchEvent(new Event("n64:leaderboard-updated"));
      setMessage(actionName==="leaderboard-opt-in"?
        "Your permission has been recorded. Your first name and town can now appear on the leaderboard.":
        "Your public leaderboard entry has been removed. Your points are safe.");
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }

  const Container=embedded?"div":"main";
  return <Container className={"hq-page"+(embedded?" hq-embedded":"")}>
    <div className="hq-shell">
      {!embedded && <nav className="hq-topbar" aria-label="Customer HQ navigation">
        <a href="/" className="hq-back">← NI BIN GUY</a>
        <div className="hq-title-tag">N64 • CUSTOMER HQ</div>
        {signedIn&&<button className="hq-logout" disabled={busy}
          onClick={logout}>Sign out</button>}
      </nav>}
      {embedded && signedIn &&
        <div className="hq-embedded-session">
          <span>★ VERIFIED CUSTOMER</span>
          <button className="hq-logout" disabled={busy} onClick={logout}>SIGN OUT</button>
        </div>
      }
      <header className={"hq-hero"+(embedded?" hq-hero--embedded":"")}>
        {!embedded && <div className="hq-pixel-stars" aria-hidden="true">✦  ✦  ✦</div>}
        <div className="hq-level">LEVEL 07 / YOUR HOME BASE</div>
        {embedded ? <h2>MY CUSTOMER <span>HQ</span></h2> :
          <h1>CUSTOMER <span>HQ</span></h1>}
        <p>Your cleaning rewards, streaks and customer services — all in one place.</p>
      </header>
      {message&&<div className="hq-notice" role="status">{message}</div>}
      {error&&<div className="hq-error" role="alert">{error}</div>}

      {loading?<GamePanel><div className="hq-loading">LOADING CUSTOMER HQ…</div></GamePanel>:
      !ready?<GamePanel label="COMING ONLINE">
        <p>We're connecting your historical cleaning points to secure customer accounts. The Squeegee portal is still available below.</p>
        <a className="hq-button hq-primary" href="/squeegee-portal?ntl-drawer-state=hidden">OPEN SQUEEGEE PORTAL ↗</a>
      </GamePanel>:
      !signedIn?
        <div className="hq-login-grid">
          <GamePanel label={challenge?"STEP 02 • ENTER YOUR CODE":"STEP 01 • VERIFY YOUR ACCOUNT"}>
            <div className="hq-heading"><span className="hq-icon">✉</span>
              <h2>{challenge?"CHECK YOUR EMAIL":"SECURE CUSTOMER LOGIN"}</h2></div>
            <p className="hq-intro">Use the email address on your existing Squeegee account. You won't need to create a new cleaning account.</p>
            {challenge?
              <form onSubmit={verify} className="hq-form">
                <label htmlFor="hq-code">8-digit sign-in code</label>
                <input id="hq-code" type="text" autoComplete="one-time-code"
                  inputMode="numeric" pattern="[0-9]{8}" maxLength={8}
                  value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}
                  placeholder="00000000" required/>
                <button className="hq-button hq-primary" type="submit"
                  disabled={busy||code.length!==8}>{busy?"VERIFYING…":"UNLOCK MY POINTS →"}</button>
                <button className="hq-button hq-secondary" type="button"
                  onClick={()=>{setChallenge(null);setCode("");setMessage("");}}>
                  Use another email or request a new code
                </button>
              </form>:
              <form className="hq-form" onSubmit={sendCode}>
                <label htmlFor="hq-email">Email address</label>
                <input id="hq-email" type="email" autoComplete="email"
                  value={email} onChange={e=>setEmail(e.target.value)}
                  placeholder="you@example.com" required maxLength={250}/>
                <button className="hq-button hq-primary" type="submit"
                  disabled={busy}>{busy?"CHECKING ACCOUNT…":"EMAIL MY LOGIN CODE →"}</button>
              </form>
            }
            <p className="hq-small">For your security, we never open a private account just because someone tapped a name on the public leaderboard.</p>
          </GamePanel>
          <GamePanel label="ALREADY USE SQUEEGEE?">
            <h2 className="hq-panel-heading">YOUR EXISTING PORTAL IS STILL HERE</h2>
            <p>Need your Squeegee account or service information instead? Open the original Squeegee login.</p>
            <a className="hq-button hq-green" href="/squeegee-portal?ntl-drawer-state=hidden">
              OPEN SQUEEGEE PORTAL ↗
            </a>
            <p className="hq-small">Squeegee may ask you to sign in separately. We cannot share login sessions between the two systems.</p>
            <p className="hq-small">No email registered, or more than one customer on the same email? <a href="mailto:info@nibing.uy?subject=Customer%20HQ%20account%20help">Contact NI Bin Guy</a> for an account check.</p>
          </GamePanel>
        </div>:
        <>
          <section className="hq-welcome">
            <div><div className="hq-level">PLAYER PROFILE / VERIFIED CUSTOMER</div>
              <h2>WELCOME BACK{account.firstName?", "+account.firstName.toUpperCase():""}!</h2>
              <p>{account.town!=="Town unavailable"?account.town+" · ":""}
                 Account {account.customerReference}</p>
            </div>
            <span className="hq-profile-icon" aria-hidden="true">★</span>
          </section>
          <div className="hq-stats">
            <Score label="TOTAL REWARDS" value={number(account.points)+" XP"}
              highlight sub="Historical cleans + verified arcade XP"/>
            <Score label="CURRENT STREAK" value={number(account.currentStreak)}
              sub="Consecutive cleaning visits"/>
            <Score label="NEXT CLEAN BONUS" value={"+"+number(account.nextBonus)}
              sub="If your next scheduled clean is completed and paid"/>
            <Score label="PAID CLEANS" value={number(account.paidCleans)}
              sub="Historical verified jobs"/>
          </div>
          <GamePanel label="YOUR XP EXPLAINED">
            <div className="hq-balance-line"><span>Cleaning streak rewards</span>
              <strong>{number(account.cleaningPoints)} XP</strong></div>
            <div className="hq-balance-line"><span>Verified website rewards</span>
              <strong>+{number(account.websiteXp)} XP</strong></div>
            <div className="hq-balance-line hq-total"><span>Total XP</span>
              <strong>{number(account.points)} XP</strong></div>
            <p className="hq-small">Cleans start at 20 points, rising by 2 per consecutive visit. A recorded skipped appointment resets the bonus to 20; it never removes points already earned.</p>
            <p className="hq-small">Source: Squeegee backup of {formatDate(account.historyAsOf)}. New payments and cleans are not automatically added until the next verified import.</p>
          </GamePanel>
          <div className="hq-account-tabs" role="group" aria-label="Customer account sections">
            <button className={tab==="history"?"hq-selected":""}
              onClick={()=>setTab("history")}>CLEAN HISTORY</button>
            <button className={tab==="leaderboard"?"hq-selected":""}
              onClick={()=>setTab("leaderboard")}>LEADERBOARD PRIVACY</button>
          </div>
          {tab==="history"?
            <GamePanel label="MY CLEANING POINTS / DATE BY DATE">
              <div className="hq-history-head"><span>APPOINTMENT</span><span>POINTS</span></div>
              {recent.length?recent.map((entry,i)=>
                <div className="hq-history-row" key={entry.date+"-"+entry.event+"-"+i}>
                  <div>
                    <strong>{formatDate(entry.date)}</strong>
                    <small>{entry.event==="paid_completed_clean"?
                      "Completed and paid • streak "+entry.streak:
                      entry.event==="recorded_skip"?
                        "Recorded skipped visit • streak reset":
                        "Completed • payment not yet verified"}</small>
                  </div>
                  <strong className={entry.points?"hq-earned":"hq-zero"}>
                    {entry.points?"+"+number(entry.points):"0"} XP
                  </strong>
                </div>
              ):<p>No verified historic cleans on this account yet.</p>}
              {account.history.length>showCount&&
                <button className="hq-button hq-secondary" type="button"
                  onClick={()=>setShowCount(n=>n+20)}>
                  SHOW MORE HISTORY ↓
                </button>}
              <p className="hq-small">This is an historical record, not a live invoice or payment statement. For current balances use Squeegee.</p>
            </GamePanel>:
            <GamePanel label="CONTROL YOUR PUBLIC LEADERBOARD ENTRY">
              {permission?.ready?
                permission?.visible?
                  <><p><strong>You're included.</strong> Your first name, town and XP may appear on the public leaderboard.</p>
                    <button className="hq-button hq-secondary" type="button"
                      disabled={busy} onClick={()=>updatePermission("leaderboard-withdraw")}>
                      REMOVE ME FROM THE LEADERBOARD
                    </button><p className="hq-small">Removing your public entry will not reset your points or cleaning streak.</p>
                  </>:
                  <><p>You're currently <strong>not listed publicly</strong>. Your points will keep accumulating privately.</p>
                    <label className="hq-field-label" htmlFor="hq-firstname">First name to display</label>
                    <input className="hq-name-input" id="hq-firstname" maxLength={40}
                      value={preferredFirstName} onChange={e=>setPreferredFirstName(e.target.value)}/>
                    <label className="hq-consent-label">
                      <input type="checkbox" checked={agree}
                        onChange={e=>setAgree(e.target.checked)}/>
                      <span>I agree to NI Bin Guy displaying my first name, town and total XP on the public leaderboard. I understand that I can remove my entry whenever I wish, without losing my points.</span>
                    </label>
                    <button className="hq-button hq-primary" type="button"
                      disabled={busy||!agree||!preferredFirstName.trim()}
                      onClick={()=>updatePermission("leaderboard-opt-in")}>
                      JOIN THE LEADERBOARD →
                    </button></>:
                <p>The private permission register is being prepared. Your points remain available here, but nobody can display your name publicly without your agreement.</p>}
              <p className="hq-small">Your real Squeegee account number, surname and address are never published here.</p>
            </GamePanel>}
          <GamePanel label="REST OF YOUR ACCOUNT">
            <div className="hq-heading">
              <span className="hq-icon">♻</span>
              <h2>SQUEEGEE CUSTOMER PORTAL</h2>
            </div>
            <p>To see your existing services, account information, invoices or payment features offered by Squeegee, open its usual customer portal.</p>
            <a className="hq-button hq-green" href="/squeegee-portal?ntl-drawer-state=hidden">
              GO TO MY SQUEEGEE PORTAL ↗
            </a>
            <p className="hq-small">This is a separate login provided by Squeegee. No payments or Squeegee records are changed from this rewards dashboard.</p>
          </GamePanel>
        </>}
      {!embedded && <footer className="hq-footer"><a href="/">← BACK TO NI BIN GUY</a>
        <span>NI BIN GUY / CUSTOMER HQ · N64 PREVIEW</span></footer>}
    </div>
  </Container>;
}
