// End-to-end browser test (Playwright): the full-snapshot copy button and the
// cross-device sync layer, driven against a fake Firebase Realtime Database.
// Not part of `npm test` (needs a browser) — run it with `npm run test:browser`.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TYPES = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png"};
const server = http.createServer((req,res)=>{
  const u = new URL(req.url, "http://x");
  let f = path.join(ROOT, u.pathname === "/" ? "/index.html" : u.pathname);
  if(!f.startsWith(ROOT) || !fs.existsSync(f)){ res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, {"Content-Type": TYPES[path.extname(f)] || "text/plain", "Cache-Control":"no-store, max-age=0"});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(4173, r));
const BASE = "http://127.0.0.1:4173/index.html";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let fails = 0;
const ok = (label, cond, extra) => { console.log((cond?"  ok  - ":"  FAIL- ")+label+(extra?(" :: "+extra):"")); if(!cond) fails++; };

// ---- a fake Firebase RTDB shared by both "devices" -------------------------
let cloud = null;
let putCount = 0;
async function attachFakeDb(page){
  await page.route("**/*firebasedatabase.app/**", async route => {
    const req = route.request();
    if(req.method() === "PUT"){
      cloud = JSON.parse(req.postData());
      putCount++;
      return route.fulfill({ status:200, contentType:"application/json", body: req.postData() });
    }
    return route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(cloud) });
  });
}
async function newPage(){
  const ctx = await browser.newContext({ permissions:["clipboard-read","clipboard-write"], serviceWorkers:"block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if(m.type()==="error" && !/fonts\.googleapis|gstatic|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) errs.push("console: "+m.text()); });
  page.on("requestfailed", r => { if(!/fonts\.g/.test(r.url())) errs.push("reqfail: "+r.url()+" "+(r.failure()||{}).errorText); });
  await attachFakeDb(page);
  page._errs = errs;
  return page;
}

// ===========================================================================
console.log("\nTest 1: page boots clean and the copy-all button is mounted");
const A = await newPage();
await A.goto(BASE);
await A.waitForFunction(() => window.__cfaAppReady === true);
ok("no page/console errors on boot", A._errs.length === 0, A._errs.join(" | "));
ok("copy-all button rendered", await A.locator(".copy-all-btn").count() === 1);
ok("sync section rendered, status off", (await A.locator("#syncStatus").textContent()).includes("غير مفعّلة"));

console.log("\nTest 2: a reading accepts multiple question sessions with notes");
await A.locator("#topic-eth .t-group-head").click();
const sessionCard = A.locator("#topic-eth .r-card").first();
await sessionCard.locator(".q-sessions > summary").click();
ok("session panel separates question accuracy from reading mastery", (await sessionCard.locator(".q-sessions-hint").textContent()).includes("لا تعني إتقان الـReading كاملًا"));
await sessionCard.locator(".q-session-form .qs-name").fill("CFAI تدريب");
await sessionCard.locator(".q-session-form .qs-scope").fill("جزء DDM");
await sessionCard.locator(".q-session-form .qs-total").fill("20");
await sessionCard.locator(".q-session-form .qs-correct").fill("14");
await sessionCard.locator(".q-session-form .qs-note").fill("أراجع أخطاء تطبيق المعايير");
await sessionCard.locator(".q-session-form button[type=submit]").click();
ok("one session is stored under the reading", await A.evaluate(() => S.topics[0].r[0].questionSessions.length === 1));
ok("session totals and accuracy are rendered", (await sessionCard.locator(".q-sessions-total").textContent()).includes("20 سؤال · 14 صحيحة · 6 خطأ · 70٪"));

await sessionCard.locator(".q-session-form .qs-date").fill("2026-09-13");
await sessionCard.locator(".q-session-form .qs-name").fill("Kaplan مراجعة");
await sessionCard.locator(".q-session-form .qs-scope").fill("أسئلة المفاهيم فقط");
await sessionCard.locator(".q-session-form .qs-total").fill("10");
await sessionCard.locator(".q-session-form .qs-correct").fill("8");
await sessionCard.locator(".q-session-form .qs-note").fill("تحسن في فهم المعايير");
await sessionCard.locator(".q-session-form button[type=submit]").click();
ok("multiple sessions accumulate", await A.evaluate(() => S.topics[0].r[0].questionSessions.length === 2));
ok("overall question summary includes the sessions", (await A.locator("#questionSessionsVal").textContent()) === "2" && (await A.locator("#questionAccuracyVal").textContent()) === "73");
const sessionCopy = await A.evaluate(() => readingSummaryText(S.topics[0], S.topics[0].r[0]));
ok("reading copy contains session scope, name, and note", sessionCopy.includes("أسئلة المفاهيم فقط") && sessionCopy.includes("Kaplan مراجعة") && sessionCopy.includes("تحسن في فهم المعايير"));
/* Keep the following snapshot assertions focused on the pre-existing counters. */
await A.evaluate(() => { S.topics[0].r[0].questionSessions = []; save(); renderAll(); });

console.log("\nTest 3: the full snapshot covers every part of the app's state");
await A.evaluate(() => {
  S.topics[0].r[0].status = "done";
  S.topics[0].r[0].mastery = "weak";
  S.topics[0].r[0].note = "MARKER_NOTE_ONE";
  S.topics[0].r[0].qMastery = "strong";
  S.topics[0].r[0].qSolved = 40; S.topics[0].r[0].qCorrect = 30;
  S.topics[3].r[1].qNote = "MARKER_QNOTE_TWO";
  S.topics[3].r[1].status = "doing";
  S.mocks = [{id:"m1", date:"2026-09-01", name:"MARKER_MOCK", score:71.5, note:"MARKER_MOCK_NOTE"}];
  renderAll();
});
const full = await A.evaluate(() => fullSummaryText());
const totalReadings = await A.evaluate(() => readingsTotals().total);
for(const m of ["MARKER_NOTE_ONE","MARKER_QNOTE_TWO","MARKER_MOCK","MARKER_MOCK_NOTE"])
  ok("snapshot contains "+m, full.includes(m));
ok("snapshot lists every reading ("+totalReadings+")", (full.match(/^\[\d+\/\d+\]/gm)||[]).length === totalReadings,
   String((full.match(/^\[\d+\/\d+\]/gm)||[]).length));
ok("snapshot lists all 10 topic headers", (full.match(/^══════ /gm)||[]).length === 10);
ok("snapshot names the weak reading", full.includes("فهم القراءة ضعيف"));
ok("snapshot has overall status counts", /حالة القراءات: مكتملة 1 — أذاكرها الآن 1/.test(full));
ok("snapshot has question totals", full.includes("إجمالي الأسئلة المحلولة: 40 — صحيحة: 30 (75٪)"));
ok("snapshot has mock average line", full.includes("عدد الاختبارات: 1"));
ok("snapshot ends with the ask", full.trim().endsWith("حسب ضعفي الفعلي."));

console.log("\nTest 4: the button actually writes that text to the clipboard");
await A.locator(".copy-all-btn").click();
await A.waitForTimeout(300);
const clip = await A.evaluate(() => navigator.clipboard.readText());
ok("clipboard holds the full snapshot", clip.includes("ملخص تقدّمي الكامل") && clip.includes("MARKER_NOTE_ONE"));
ok("button confirms success", (await A.locator(".copy-all-btn").textContent()).includes("تم النسخ"));

console.log("\nTest 5: enabling sync on device A uploads local data");
await A.locator("#syncUrl").fill("https://fake-default-rtdb.firebasedatabase.app");
await A.locator("#syncGenBtn").click();
const code = await A.locator("#syncCode").inputValue();
ok("generated code is 24 chars", code.length === 24, code);
await A.locator("#syncSaveBtn").click();
await A.waitForFunction(() => document.querySelector("#syncStatus").dataset.kind === "ok", null, {timeout:8000});
ok("device A reports synced", true);
ok("cloud received the upload", !!cloud && !!cloud.data);
ok("cloud carries device A's note", JSON.stringify(cloud.data).includes("MARKER_NOTE_ONE"));

console.log("\nTest 6: a second device pairs from the link and pulls the data");
const link = await A.evaluate(() => syncPairLink());
ok("pair link carries the sync payload", link.includes("#sync="));
const B = await newPage();
await B.goto(link.replace("http://127.0.0.1:4173/index.html", BASE));
await B.waitForFunction(() => window.__cfaAppReady === true);
await B.waitForFunction(() => document.querySelector("#syncStatus").dataset.kind === "ok", null, {timeout:8000});
ok("device B boots without errors", B._errs.length === 0, B._errs.join(" | "));
ok("device B adopted A's note", (await B.evaluate(() => S.topics[0].r[0].note)) === "MARKER_NOTE_ONE");
ok("device B shows A's mock", (await B.evaluate(() => S.mocks.length)) === 1);
ok("device B stripped the secret from the URL bar", !B.url().includes("#sync="));
ok("device B re-rendered the adopted state", (await B.locator("#readingsDoneVal").textContent()) === "1");

console.log("\nTest 7: an edit on B flows back to A");
const waitCloud = async (marker, ms=12000) => {
  const t0 = Date.now();
  while(Date.now() - t0 < ms){
    if(cloud && JSON.stringify(cloud.data).includes(marker)) return true;
    await new Promise(r=>setTimeout(r,250));
  }
  return false;
};
await B.evaluate(() => { S.topics[1].r[0].note = "MARKER_FROM_B"; save(); });
ok("B auto-uploaded its edit", await waitCloud("MARKER_FROM_B"));
await A.evaluate(() => window.cfaSync.run());
await A.waitForTimeout(700);
ok("device A pulled B's edit", (await A.evaluate(() => S.topics[1].r[0].note)) === "MARKER_FROM_B");

console.log("\nTest 8: simultaneous edits raise a conflict instead of silently losing one");
// device A edits while effectively offline (its auto-push is suppressed), B edits and uploads
await A.evaluate(() => { window.cfaSync.onLocalChange = () => {}; });
await A.evaluate(() => { S.topics[2].r[0].note = "MARKER_A_SIDE"; save(); });
await B.evaluate(() => { S.topics[2].r[0].note = "MARKER_B_SIDE"; save(); });
ok("B's version reached the cloud", await waitCloud("MARKER_B_SIDE"));
await A.evaluate(() => window.cfaSync.run({loud:true}));
await A.waitForTimeout(900);
ok("device A flags a conflict", (await A.locator("#syncStatus").getAttribute("data-kind")) === "conflict");
ok("conflict chooser is visible", await A.locator("#syncConflict").isVisible());
ok("A's own edit is untouched while unresolved", (await A.evaluate(() => S.topics[2].r[0].note)) === "MARKER_A_SIDE");

console.log("\nTest 9: choosing the cloud copy adopts it and backs up the local one");
await A.locator("#syncKeepRemote").click();
await A.waitForTimeout(900);
ok("A now holds B's version", (await A.evaluate(() => S.topics[2].r[0].note)) === "MARKER_B_SIDE");
ok("pre-sync backup kept A's version",
   (await A.evaluate(() => localStorage.getItem("cfa_l2_pre_sync_backup") || "")).includes("MARKER_A_SIDE"));
ok("conflict box closed", !(await A.locator("#syncConflict").isVisible()));

console.log("\nTest 10: turning sync off stops the network and keeps local data");
await A.evaluate(() => { window.cfaSync.onLocalChange = syncOnLocalChange; });
const before = putCount;
await A.locator("#syncOffBtn").click();
await A.locator("#syncOffBtn").click();  // armConfirm needs the second press
await A.evaluate(() => { S.topics[4].r[0].note = "MARKER_AFTER_OFF"; save(); });
await A.waitForTimeout(5200);
ok("no upload after disabling", putCount === before, "puts: "+(putCount-before));
ok("local edit still saved", (await A.evaluate(() => S.topics[4].r[0].note)) === "MARKER_AFTER_OFF");
ok("status reads off", (await A.locator("#syncStatus").getAttribute("data-kind")) === "off");

console.log("\nTest 11: a bad database URL fails loudly and changes nothing");
const C = await newPage();
await C.route("**/broken-default-rtdb.firebasedatabase.app/**", r => r.fulfill({status:401, body:"denied"}));
await C.goto(BASE);
await C.waitForFunction(() => window.__cfaAppReady === true);
await C.evaluate(() => { S.topics[0].r[0].note = "MARKER_C_LOCAL"; save(); });
await C.locator("#syncUrl").fill("https://broken-default-rtdb.firebasedatabase.app");
await C.locator("#syncCode").fill("abcdefghijklmnop1234");
await C.locator("#syncSaveBtn").click();
await C.waitForTimeout(1200);
ok("status shows an error", (await C.locator("#syncStatus").getAttribute("data-kind")) === "error");
ok("local data untouched after a failed sync", (await C.evaluate(() => S.topics[0].r[0].note)) === "MARKER_C_LOCAL");
ok("the 401 is explained as unpublished rules",
   (await C.locator("#syncError").textContent()).includes("Rules"));
ok("short codes are rejected before any request", await C.evaluate(async () => {
  document.querySelector("#syncCode").value = "tooshort";
  document.querySelector("#syncSaveBtn").click();
  await new Promise(r=>setTimeout(r,150));
  return !syncCodeValid("tooshort");
}));

console.log("\nTest 12: an edit typed while an upload is in flight is not swallowed");
const F = await newPage();
let held = null;                       // holds the first PUT open until we release it
await F.route("**/*firebasedatabase.app/**", async route => {
  const req = route.request();
  if(req.method() === "PUT"){
    cloud = JSON.parse(req.postData()); putCount++;
    if(!held){ held = true; await new Promise(r=>setTimeout(r, 2500)); }
    return route.fulfill({ status:200, contentType:"application/json", body: req.postData() });
  }
  return route.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(cloud) });
});
cloud = null;
await F.goto(BASE);
await F.waitForFunction(() => window.__cfaAppReady === true);
await F.evaluate(() => { S.topics[0].r[0].note = "EDIT_BEFORE_PUT"; save(); });
await F.locator("#syncUrl").fill("https://fake-default-rtdb.firebasedatabase.app");
await F.locator("#syncGenBtn").click();
const putsBeforeHold = putCount;       // earlier tests already uploaded; count from here
F.locator("#syncSaveBtn").click();     // deliberately not awaited: the PUT is held open
// Wait for the upload to actually be in flight before typing. A fixed delay here is a
// race: the click's own overhead can push the PUT past it, and the edit then rides
// along in the very payload the test means to have missed it.
const arrived = await (async () => {
  const t0 = Date.now();
  while(Date.now() - t0 < 15000){ if(putCount > putsBeforeHold && cloud) return true; await new Promise(r=>setTimeout(r,50)); }
  return false;
})();
ok("the upload really is in flight before we type", arrived);
ok("the held upload does not already contain the later edit",
   !JSON.stringify(cloud.data).includes("EDIT_DURING_PUT"));
await F.evaluate(() => { S.topics[0].r[1].note = "EDIT_DURING_PUT"; save(); });
const landed = await (async () => {
  const t0 = Date.now();
  while(Date.now() - t0 < 20000){
    if(cloud && JSON.stringify(cloud.data).includes("EDIT_DURING_PUT")) return true;
    await new Promise(r=>setTimeout(r,250));
  }
  return false;
})();
ok("the edit made mid-upload still reaches the cloud", landed);
ok("the earlier edit is there too", JSON.stringify(cloud.data).includes("EDIT_BEFORE_PUT"));

console.log("\nTest 13: a cloud stamp from a clock running ahead does not bounce back");
const G = await newPage();
await G.goto(BASE);
await G.waitForFunction(() => window.__cfaAppReady === true);
cloud = { updatedAt: Date.now() + 3600000, device: "other", appVersion: "7.10.0",
          data: await G.evaluate(() => { S.topics[0].r[0].note = "FROM_FAST_CLOCK"; return JSON.parse(JSON.stringify(S)); }) };
await G.evaluate(() => { S.topics[0].r[0].note = ""; });   // local copy without that note
await G.locator("#syncUrl").fill("https://fake-default-rtdb.firebasedatabase.app");
await G.locator("#syncCode").fill("zzzzyyyyxxxxwwwwvvvv");
await G.locator("#syncSaveBtn").click();
await G.waitForFunction(() => document.querySelector("#syncStatus").dataset.kind === "ok", null, {timeout:8000});
ok("adopted the ahead-of-clock cloud copy", (await G.evaluate(() => S.topics[0].r[0].note)) === "FROM_FAST_CLOCK");
const putsAfterAdopt = putCount;
await G.evaluate(() => window.cfaSync.run());
await G.waitForTimeout(900);
ok("no pointless write-back afterwards", putCount === putsAfterAdopt, "extra puts: " + (putCount - putsAfterAdopt));

console.log("\nTest 14: wrong-shaped URLs are named before any request is made");
const E = await newPage();
let reqs = 0;
const seen = [];
await E.route("**/*", r => {
  const u = r.request().url();
  if(!u.startsWith("http://127.0.0.1:4173/") && !/fonts\.(googleapis|gstatic)\.com/.test(u)){ reqs++; seen.push(u); }
  return r.continue();
});
await E.goto(BASE);
await E.waitForFunction(() => window.__cfaAppReady === true);
const cases = [
  ["https://console.firebase.google.com/project/x/database", "لوحة تحكم"],
  ["https://my-project.firebaseapp.com", "Realtime Database"],
  ["https://example.com/db", "firebaseio.com"]
];
for(const [url, needle] of cases){
  await E.locator("#syncUrl").fill(url);
  await E.locator("#syncCode").fill("abcdefghijklmnop1234");
  await E.locator("#syncSaveBtn").click();
  await E.waitForTimeout(200);
  ok("rejects " + url.slice(8, 38), (await E.locator("#syncError").textContent()).includes(needle));
}
ok("no network request was attempted for any of them", reqs === 0, seen.join(" | "));
ok("sync stayed off after every rejection", (await E.locator("#syncStatus").getAttribute("data-kind")) === "off");

console.log("\nTest 15: the pairing link is copied to the clipboard");
const D = await newPage();
await D.goto(BASE);
await D.waitForFunction(() => window.__cfaAppReady === true);
await D.locator("#syncUrl").fill("https://fake-default-rtdb.firebasedatabase.app");
await D.locator("#syncGenBtn").click();
await D.locator("#syncSaveBtn").click();
await D.waitForFunction(() => document.querySelector("#syncStatus").dataset.kind === "ok", null, {timeout:8000});
await D.locator("#syncLinkBtn").click();
await D.waitForTimeout(300);
ok("pairing link landed on the clipboard",
   (await D.evaluate(() => navigator.clipboard.readText())).includes("#sync="));
if(process.env.SHOT) await D.screenshot({path: process.env.SHOT, fullPage: true});

console.log("\n" + (fails ? fails + " FAILED" : "all checks passed"));
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
