"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const csrf=require("../netlify/functions/lib/leaderboardLoginCsrf");

const env={SQUEEGEE_PRODUCTION_OWNER_AUTH_SECRET:"a".repeat(64)};
const now=Date.parse("2026-11-28T15:18:00Z");
const sameOrigin=new Headers({"origin":"https://nibing.uy","sec-fetch-site":"same-origin"});
function allowed(token,headers,options={}){
 return csrf.isAllowed({cookie:token,formToken:token,headers,env,now,...options});
}
test("login form carries a short-lived secure host-only CSRF cookie",()=>{
 const token=csrf.issueToken(env,now);
 assert.equal(csrf.tokenValid(token,env,now),true);
 assert.equal(csrf.tokenValid(token,env,now+csrf.WINDOW_MS),false);
 assert.equal(csrf.tokenValid(token,env,now-1),false);
 assert.match(csrf.cookieHeader(token),/^__Host-nbg-prod-leaderboard-login-csrf=/);
 assert.match(csrf.cookieHeader(token),/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=1200$/);
 assert.equal(csrf.fromHeader("unrelated=1; "+csrf.cookieHeader(token).split(";")[0]),token);
 assert.equal(csrf.fromHeader("unrelated=1"),"");
 assert.equal(allowed(token,sameOrigin),true);
});
test("Samsung null/omitted Origin is allowed only with matching signed form token",()=>{
 const token=csrf.issueToken(env,now);
 assert.equal(allowed(token,new Headers({"origin":"null","sec-fetch-site":"same-origin"})),true);
 assert.equal(allowed(token,new Headers({"sec-fetch-site":"same-origin"})),true);
 assert.equal(allowed(token,new Headers()),true);
 assert.equal(csrf.isAllowed({cookie:token,formToken:"",env,headers:new Headers(),now}),false);
 assert.equal(csrf.isAllowed({cookie:token,formToken:csrf.issueToken(env,now),env,headers:new Headers(),now}),false);
 assert.equal(csrf.isAllowed({cookie:"",formToken:token,env,headers:new Headers(),now}),false);
 const tampered=token.slice(0,-1)+(token.endsWith("0")?"1":"0");
 assert.equal(csrf.isAllowed({cookie:tampered,formToken:tampered,env,headers:new Headers(),now}),false);
 assert.equal(allowed(token,new Headers(),{now:now+csrf.WINDOW_MS}),false);
});
test("cross-site requests and foreign referrers are rejected even with valid token",()=>{
 const token=csrf.issueToken(env,now);
 for(const headers of [
  {"origin":"https://malicious.example"},
  {"origin":"null","sec-fetch-site":"cross-site"},
  {"origin":"https://nibing.uy","sec-fetch-site":"cross-site"},
  {"referer":"https://other.example/form"},
  {"origin":"https://nibing.uy","referer":"https://malicious.example/foo"},
  {"referer":"not a URL"},
 ])assert.equal(allowed(token,new Headers(headers)),false);
 assert.equal(allowed(token,new Headers({"referer":"https://nibing.uy/leaderboard-admin/login"})),true);
});
test("live login requires signed form token for both OTP request and verification",()=>{
 const login=fs.readFileSync(path.join(__dirname,"../netlify/functions/leaderboardAdminLogin.mjs"),"utf8");
 assert.match(login,/import loginCsrf from "\.\/lib\/leaderboardLoginCsrf\.js"/);
 assert.match(login,/name="csrf" value="'\+csrf\+'"/);
 assert.match(login,/loginCsrf\.issueToken\(process\.env\)/);
 assert.match(login,/loginCsrf\.cookieHeader\(token\)/);
 assert.match(login,/loginCsrf\.isAllowed\(/);
 assert.match(login,/page\(codeForm\(target,outcome\.challengeId,csrf\)\)/);
 assert.match(login,/codeForm\(target,id,csrf\)/);
 assert.doesNotMatch(login,/request\.headers\.get\("origin"\)!==ORIGIN/);
});
