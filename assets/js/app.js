"use strict";

const APP_VERSION = "7.13.0";

/* ---------- tiered storage: Claude window.storage -> localStorage -> memory ----------
   Same storage key as v5/v6 on purpose: this is what makes existing users' data load
   automatically under the current tracker with zero action from them. Never change this key. */
const KEY = "cfa_l2_dash_v1";
let _mem = null;
const store = {
  async read(){
    if (typeof window !== "undefined" && window.storage && window.storage.get){
      try{ const r = await window.storage.get(KEY); if(r && r.value) return JSON.parse(r.value); }catch(e){}
    }
    try{ const raw = localStorage.getItem(KEY); if(raw) return JSON.parse(raw); }catch(e){}
    return _mem;
  },
  async write(o){
    _mem = o;
    let ok = false;
    const s = JSON.stringify(o);
    try{ localStorage.setItem(KEY, s); ok = true; }catch(e){}
    if (typeof window !== "undefined" && window.storage && window.storage.set){
      try{ await window.storage.set(KEY, s); ok = true; }catch(e){}
    }
    return ok;
  }
};

/* ---------- one-time pre-migration safety net (v6 -> v7) ----------
   Before this browser's data is ever run through the v7 migration, the raw pre-v7
   JSON is stashed here once. Nothing else in v7 reads or writes this key — it exists
   purely so a v6 snapshot can be recovered by hand if anything ever looks wrong. */
const PRE_MIGRATION_KEY = "cfa_l2_dash_pre_v7_backup";
const IMPORT_BACKUP_KEY = "cfa_l2_dash_pre_import_backup";
function savePreMigrationBackup(raw){
  try{
    if(localStorage.getItem(PRE_MIGRATION_KEY)) return; /* keep the first one only */
    localStorage.setItem(PRE_MIGRATION_KEY, JSON.stringify({ ts: Date.now(), data: raw }));
  }catch(e){}
}

/* ---------- import safety ----------
   Import is intentionally stricter than the migration itself: migration may mutate its
   argument, so callers must validate and clone a file before it can replace live state. */
function isRecord(value){
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateImportData(o){
  if(!isRecord(o)) return {ok:false, message:"ملف JSON غير صالح: يجب أن يحتوي على كائن بيانات."};

  const versions=[o.v,o.schemaVersion].filter(v=>v!==undefined && v!==null);
  if(versions.some(v=>!Number.isInteger(v) || v<1 || v>10)){
    return {ok:false, message:"نسخة البيانات غير مدعومة. استخدم ملفاً من v1 إلى v10."};
  }
  if(!Array.isArray(o.topics) || o.topics.length!==DEFAULT.topics.length){
    return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: بنية القراءات غير مكتملة."};
  }

  let readingCount=0;
  for(const topic of o.topics){
    if(!isRecord(topic) || typeof topic.id!=="string" || !Array.isArray(topic.r)){
      return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: بيانات أحد الأقسام تالفة."};
    }
    for(const reading of topic.r){
      if(!isRecord(reading) || typeof reading.id!=="string" || !reading.id.trim()){
        return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: بيانات إحدى القراءات تالفة."};
      }
      if(["ar","en","note"].some(key=>reading[key]!==undefined && reading[key]!==null && typeof reading[key]!=="string")){
        return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: نص إحدى القراءات غير صالح."};
      }
      const numericFields=["hrs","spent","weight","qGoal","qSolved","qCorrect","excludedFraction"];
      if(numericFields.some(key=>reading[key]!==undefined && reading[key]!==null &&
        (typeof reading[key]!=="number" || !Number.isFinite(reading[key])))){
        return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: قيمة رقمية غير صالحة."};
      }
      if(reading.questionSessions!==undefined){
        if(!Array.isArray(reading.questionSessions)){
          return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: سجل جلسات الأسئلة غير صالح."};
        }
        for(const session of reading.questionSessions){
          if(!isRecord(session) || typeof session.id!=="string" || !session.id.trim() ||
             typeof session.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(session.date)){
            return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: تاريخ أو هوية جلسة الأسئلة غير صالح."};
          }
          if(["name","scope","note"].some(key=>session[key]!==undefined && session[key]!==null && typeof session[key]!=="string")){
            return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: تفاصيل جلسة الأسئلة غير صالحة."};
          }
          if(!Number.isInteger(session.total) || session.total<1 ||
             !Number.isInteger(session.correct) || session.correct<0 || session.correct>session.total){
            return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: عدد أسئلة أو إجابات جلسة الأسئلة غير صالح."};
          }
        }
      }
      readingCount++;
    }
  }
  if(readingCount<45){
    return {ok:false, message:"ملف النسخة الاحتياطية غير مكتمل: يلزم وجود الوحدات الدراسية الـ45."};
  }

  const objectFields=["dailyLog","reviews","practice","restDays","celebrated"];
  if(objectFields.some(key=>o[key]!==undefined && !isRecord(o[key]))){
    return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: سجل البيانات غير صالح."};
  }
  const arrayFields=["mocks","sessions","errors","weaknesses","syncConflicts"];
  if(arrayFields.some(key=>o[key]!==undefined && !Array.isArray(o[key]))){
    return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: سجل الاختبارات أو الجلسات غير صالح."};
  }
  if(o.activeTimer!==undefined && o.activeTimer!==null && !isRecord(o.activeTimer)){
    return {ok:false, message:"ملف النسخة الاحتياطية غير متوافق: بيانات المؤقت غير صالحة."};
  }
  return {ok:true, message:""};
}

async function saveImportBackup(current){
  let payload;
  try{
    payload=JSON.stringify({ts:Date.now(), appVersion:APP_VERSION, data:JSON.parse(JSON.stringify(current))});
  }catch(e){ return false; }
  let ok=false;
  try{ localStorage.setItem(IMPORT_BACKUP_KEY,payload); ok=true; }catch(e){}
  if(typeof window!=="undefined" && window.storage && window.storage.set){
    try{ await window.storage.set(IMPORT_BACKUP_KEY,payload); ok=true; }catch(e){}
  }
  return ok;
}

/* ---------- default curriculum (2026, 45 modules) ----------
   weights are official ranges; reading names and IDs stay stable so existing installs
   can migrate without losing the user's reading-level notes. */
const DEFAULT = {
  examDate:"2026-11-19", reviews:{}, mocks:[], lastExport:null, celebrated:{}, planCfg:null, restDays:{},
  topics:[
   {id:"eth",ar:"الأخلاقيات والمعايير المهنية",en:"Ethics & Professional Standards",abbr:"ETH",wMin:10,wMax:15,r:[
     ["مراجعة مدونة الأخلاقيات والمعايير","Code & Standards Review"],
     ["إرشادات المعايير I–VII (تطبيق معمّق)","Guidance for Standards I–VII"],
     ["تطبيق المدونة والمعايير — دراسات حالة","Application of the Code: Level II"]]},
   {id:"fsa",ar:"تحليل القوائم المالية",en:"Financial Statement Analysis",abbr:"FSA",wMin:10,wMax:15,r:[
     ["الاستثمارات بين الشركات","Intercorporate Investments"],
     ["تعويضات الموظفين: ما بعد التوظيف والأسهم","Employee Compensation"],
     ["العمليات متعددة الجنسيات","Multinational Operations"],
     ["تحليل المؤسسات المالية","Analysis of Financial Institutions"],
     ["تقييم جودة التقارير المالية","Evaluating Quality of Financial Reports"],
     ["تكامل أساليب تحليل القوائم المالية","Integration of Financial Statement Analysis Techniques"]]},
   {id:"eq",ar:"استثمارات الأسهم",en:"Equity Investments",abbr:"EI",wMin:10,wMax:15,r:[
     ["تقييم الأسهم: التطبيقات والعمليات","Valuation: Applications & Processes"],
     ["نموذج خصم التوزيعات","Discounted Dividend Valuation"],
     ["تقييم التدفقات النقدية الحرة","Free Cash Flow Valuation"],
     ["التقييم بالمضاعفات السوقية","Market-Based Valuation (Multiples)"],
     ["تقييم الدخل المتبقي","Residual Income Valuation"],
     ["تقييم الشركات الخاصة","Private Company Valuation"]]},
   {id:"fi",ar:"الدخل الثابت",en:"Fixed Income",abbr:"FI",wMin:10,wMax:15,r:[
     ["هيكل الأجل وديناميكيات أسعار الفائدة","Term Structure & Rate Dynamics"],
     ["إطار التقييم الخالي من المراجحة","Arbitrage-Free Valuation"],
     ["تقييم السندات ذات الخيارات المضمّنة","Bonds with Embedded Options"],
     ["نماذج تحليل الائتمان","Credit Analysis Models"],
     ["مقايضات التخلف الائتماني (CDS)","Credit Default Swaps"]]},
   {id:"pm",ar:"إدارة المحافظ",en:"Portfolio Management",abbr:"PM",wMin:10,wMax:15,r:[
     ["الاقتصاد وأسواق الاستثمار","Economics & Investment Markets"],
     ["تحليل الإدارة النشطة للمحافظ","Active Portfolio Management"],
     ["صناديق المؤشرات المتداولة (ETF)","ETF Mechanics & Applications"],
     ["استخدام النماذج متعددة العوامل","Using Multifactor Models"],
     ["قياس وإدارة مخاطر السوق","Measuring & Managing Market Risk"],
     ["الاختبار الخلفي والمحاكاة","Backtesting & Simulation"]]},
   {id:"qm",ar:"الأساليب الكمية",en:"Quantitative Methods",abbr:"QM",wMin:5,wMax:10,r:[
     ["أساسيات الانحدار المتعدد","Basics of Multiple Regression"],
     ["تقييم ملاءمة نموذج الانحدار","Evaluating Regression Fit"],
     ["سوء توصيف النموذج","Model Misspecification"],
     ["امتدادات الانحدار المتعدد","Extensions of Multiple Regression"],
     ["تحليل السلاسل الزمنية","Time-Series Analysis"],
     ["تعلّم الآلة","Machine Learning"],
     ["مشاريع البيانات الضخمة","Big Data Projects"]]},
   {id:"eco",ar:"الاقتصاد",en:"Economics",abbr:"ECO",wMin:5,wMax:10,r:[
     ["أسعار صرف العملات: قيمة التوازن","Currency Exchange Rates"],
     ["النمو الاقتصادي","Economic Growth"]]},
   {id:"ci",ar:"مُصدِرو الشركات",en:"Corporate Issuers",abbr:"CI",wMin:5,wMax:10,r:[
     ["تحليل التوزيعات وإعادة شراء الأسهم","Dividends & Share Repurchases"],
     ["اعتبارات ESG في تحليل الاستثمار","ESG Considerations"],
     ["تكلفة رأس المال: مواضيع متقدمة","Cost of Capital: Advanced"],
     ["إعادة هيكلة الشركات","Corporate Restructuring"]]},
   {id:"der",ar:"المشتقات",en:"Derivatives",abbr:"DER",wMin:5,wMax:10,r:[
     ["تسعير وتقييم الالتزامات الآجلة","Pricing Forward Commitments"],
     ["تقييم المطالبات الاحتمالية (الخيارات)","Valuation of Contingent Claims"]]},
   {id:"ai",ar:"الاستثمارات البديلة",en:"Alternative Investments",abbr:"AI",wMin:5,wMax:10,r:[
     ["السلع ومشتقات السلع","Commodities & Commodity Derivatives"],
     ["أنواع الاستثمار العقاري","Types of Real Estate Investment"],
     ["الاستثمار العقاري عبر الأوراق المتداولة","Publicly Traded Real Estate"],
     ["استراتيجيات صناديق التحوّط","Hedge Fund Strategies"]]}
  ]
};

/* ---------- v6 sub-object shapes (unused by the v7 UI, kept so useful reading metadata
   survives older installs; the retired trackers are removed by the v10 cleanup) ---------- */
function defaultSourceMap(){
  return {
    prepnuggets:"none", markVideo:"none", markNotes:"none", markFormula:"na",
    schweser:{examFocus:false, profNotes:false, keyConcepts:false, moduleQuiz:false},
    cfai:{curriculum:false, examples:false, practice:false, blueBox:false},
    secretSauce:false
  };
}
function defaultStages(){
  return {
    sourceWatched:false, markNotes:false, examFocus:false, formulas:false,
    preQuestionBrief:false, cfaiQuestions:false, errorReview:false,
    closeoutQuiz:false, examReady:false
  };
}
function defaultBrief(){
  return {
    primarySource:"", confidence:null, difficultParts:"", previousResult:"",
    markIdeas:"", schweserTips:"", profNotes:"", formulas:"", understand:"",
    memorize:"", confusions:"", cfaiTraps:"", prepnuggetsGaps:"", checklist:"", chatReply:""
  };
}

/* ---------- build / load / migrate state ---------- */
function fresh(){
  const s = JSON.parse(JSON.stringify(DEFAULT));
  s.topics.forEach(t=>{
    t.weight = (t.wMin+t.wMax)/2;
    t.r = t.r.map((x,i)=>({id:t.id+"-"+i, ar:x[0], en:x[1], status:"todo", mastery:"none", qMastery:"none", note:"", qNote:"", questionSessions:[]}));
  });
  s.v = 1;
  return migrate(s);
}
function migrate(o){
  const previousVersion = o.v||1;
  o.v = 10;
  if(!o.restDays) o.restDays = {};
  if(!o.reviews) o.reviews = {};
  if(!o.mocks) o.mocks = [];
  if(o.lastExport === undefined) o.lastExport = null;
  if(!o.celebrated) o.celebrated = {};
  if(o.planCfg === undefined) o.planCfg = null;
  o.topics.forEach(t=>{
    if(t.weight == null) t.weight = (t.wMin+t.wMax)/2;
    t.r.forEach(r=>{
      if(r.note == null) r.note = "";
      if(r.qNote == null) r.qNote = "";
      if(r.questionSessions === undefined) r.questionSessions = [];
      if(Array.isArray(r.questionSessions)) r.questionSessions.forEach(s=>{
        if(s && typeof s === "object" && !Array.isArray(s) && s.scope === undefined) s.scope = "";
      });
      if(r.mastery == null) r.mastery = "none"; /* self-rated understanding of the reading */
      if(r.qMastery == null) r.qMastery = "none"; /* self-rated question-solving performance */
    });
  });
  if(previousVersion<3){
    const eco=o.topics.find(t=>t.id==="eco");
    if(eco){
      const removed=eco.r.filter(r=>r.en==="Economics of Regulation" || r.ar==="اقتصاديات التنظيم");
      eco.r=eco.r.filter(r=>r.en!=="Economics of Regulation" && r.ar!=="اقتصاديات التنظيم");
      removed.forEach(r=>{ delete o.reviews[r.id]; });
    }
    if(o.examDate==="2026-11-18") o.examDate="2026-11-19";
  }
  if(previousVersion<4){
    const fsa=o.topics.find(t=>t.id==="fsa");
    if(fsa){
      const quality=fsa.r.find(r=>r.en==="Quality of Financial Reports");
      if(quality) quality.en="Evaluating Quality of Financial Reports";
      const hasIntegration=fsa.r.some(r=>
        r.id==="fsa-5" ||
        (r.en||"").includes("Integration of Financial Statement Analysis") ||
        (r.ar||"").includes("تكامل أساليب تحليل القوائم المالية")
      );
      if(!hasIntegration){
        fsa.r.push({
          id:"fsa-5",
          ar:"تكامل أساليب تحليل القوائم المالية",
          en:"Integration of Financial Statement Analysis Techniques",
          status:"todo",
          mastery:"none",
          note:""
        });
      }
    }
  }
  if(previousVersion<6){
    /* v5 -> v6 (CFA Personal Coach): backfill the useful reading metadata.
       v10 below intentionally removes the retired trackers after this compatibility step.
       Curriculum framing: CFA Level II 2026 has 42 official readings; this dashboard
       tracks them as 45 study units (a few readings are split into two trackable units). */
    o.schemaVersion = 6;
    o.topics.forEach(t=>{
      t.r.forEach(r=>{
        if(r.topicId===undefined) r.topicId = t.id;
        if(r.readingNo===undefined) r.readingNo = null; /* user-assignable: official reading number per your 2026 curriculum guide */
        if(r.excludedFraction===undefined) r.excludedFraction = 0;
        if(r.excludedNote===undefined) r.excludedNote = "";
        if(r.stages===undefined) r.stages = defaultStages();
        if(r.sourceMap===undefined) r.sourceMap = defaultSourceMap();
        if(r.pages===undefined) r.pages = {mark:"",schweser:"",cfai:"",secretSauce:""};
        if(r.brief===undefined) r.brief = defaultBrief();
        else r.brief = Object.assign(defaultBrief(), r.brief); /* backfill any brief fields added after your first v6 run */
        if(r.closeout===undefined) r.closeout = {status:"open", closedAt:null}; /* open|ready|closed */
      });
    });
    /* CFA Institute 2026 syllabus change: Machine Learning LOS E (Neural Networks,
       Deep Learning Nets, Reinforcement Learning) was removed. The reading itself stays —
       only that slice is flagged out-of-syllabus and excluded from progress/readiness/plan. */
    const qm=o.topics.find(t=>t.id==="qm");
    if(qm){
      const ml=qm.r.find(r=>(r.en||"").trim().toLowerCase()==="machine learning" || r.ar==="تعلّم الآلة");
      if(ml && !ml.excludedFraction){
        ml.excludedFraction = 0.3;
        ml.excludedNote = "خارج منهج 2026: حذفت CFA Institute LOS E (Neural Networks, Deep Learning Nets, and Reinforcement Learning) من هذه القراءة. الجزء المتبقي فقط يدخل في التقدّم والجاهزية وخطة اليوم.";
      }
    }
    if(!o.errors) o.errors = [];                 /* دفتر الأخطاء (v6, kept, not shown in v7) */
    if(!o.weaknesses) o.weaknesses = [];          /* نقاط الضعف (v6, kept, not shown in v7) */
    if(!o.closeoutCfg) o.closeoutCfg = { minQuestions:20, minAccuracy:70, maxGuessRate:35 };
    if(!o.readinessCfg) o.readinessCfg = null;
    if(!o.deviceId) o.deviceId = "dev-"+Math.random().toString(36).slice(2)+Date.now().toString(36);
    if(!o.sync) o.sync = { provider:"local", uid:null, lastSyncAt:null, status:"local" };
    if(o.backupBeforeMigration===undefined) o.backupBeforeMigration = true;
    if(!o.syncConflicts) o.syncConflicts = [];
    if(o.lastLocalChangeAt===undefined) o.lastLocalChangeAt = Date.now();
  }
  /* v10 cleanup: the old hour tracker and cumulative question counters are retired.
     New questionSessions[] is the only source of question totals; the qualitative
     reading/question ratings and notes remain separate and are intentionally kept. */
  delete o.target;
  delete o.buffer;
  delete o.dailyLog;
  delete o.activeTimer;
  delete o.practice;
  delete o.sessions;
  delete o.qGoal;
  delete o.practiceLegacyIndexed;
  o.topics.forEach(t=>t.r.forEach(r=>{
    delete r.hrs;
    delete r.spent;
    delete r.readingPractice;
    delete r.qGoal;
    delete r.qSolved;
    delete r.qCorrect;
  }));
  o.schemaVersion = 10;
  return o;
}

let S = null;

let saveT = null;
let saveQueue = Promise.resolve();
function persistState(state, showSaved){
  if(!state) return Promise.resolve(false);
  let snapshot;
  try{ snapshot=JSON.parse(JSON.stringify(state)); }catch(e){ return Promise.resolve(false); }
  const write=saveQueue.catch(()=>false).then(()=>store.write(snapshot));
  saveQueue=write;
  return write.then(ok=>{ if(ok && showSaved) flashSaved(); return ok; }, ()=>false);
}
function save(){
  if(S) S.lastLocalChangeAt = Date.now();
  clearTimeout(saveT);
  saveT = setTimeout(()=>{ saveT=null; persistState(S,true); }, 300);
  if(window.cfaSync) window.cfaSync.onLocalChange();
}
function flushSave(){
  clearTimeout(saveT);
  saveT=null;
  return persistState(S,false);
}

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const ESCMAP = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
const esc = v => String(v==null?"":v).replace(/[&<>"']/g, c=>ESCMAP[c]);
function norm(v){
  return String(v==null?"":v).toLowerCase()
    .replace(/[ً-ْـٰ]/g,"")
    .replace(/[أإآٱ]/g,"ا")
    .replace(/ى/g,"ي").replace(/ة/g,"ه");
}
const fmt = n => (Math.round((n||0)*10)/10).toString();
const dayMs = 86400000;
const RIYADH_TZ = "Asia/Riyadh";
function dateKeyInRiyadh(d){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:RIYADH_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d||new Date());
  const get=t=>parts.find(p=>p.type===t).value;
  return get("year")+"-"+get("month")+"-"+get("day");
}
const todayKey = ()=>dateKeyInRiyadh(new Date());
function shiftDateKey(key,n){
  const [y,m,d]=key.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);
}
function daysBetweenKeys(a,b){
  const pa=a.split("-").map(Number), pb=b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0],pb[1]-1,pb[2])-Date.UTC(pa[0],pa[1]-1,pa[2]))/dayMs);
}
function keyOf(x){ return typeof x==="string" ? x.slice(0,10) : dateKeyInRiyadh(x instanceof Date?x:new Date()); }
function fmtDate(x){ const [y,m,d]=keyOf(x).split("-"); return d+"/"+m+"/"+y; }
const STAT = {todo:"لم أبدأ",doing:"أذاكرها",done:"مكتملة"};

function allReadingsFlat(){
  const out=[];
  S.topics.forEach(t=>t.r.forEach(r=>out.push({t:t,r:r})));
  return out;
}
function findReading(id){ for(const t of S.topics){ const r=t.r.find(x=>x.id===id); if(r) return {t:t,r:r}; } return null; }
function questionSessionIsUsable(s){
  return !!(s && typeof s==="object" && typeof s.id==="string" && s.id.trim() &&
    typeof s.date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    Number.isInteger(s.total) && s.total>0 && Number.isInteger(s.correct) &&
    s.correct>=0 && s.correct<=s.total);
}
function questionSessionAccuracy(s){ return s.total ? Math.round(s.correct/s.total*100) : 0; }
function questionSessionStats(r){
  const sessions=(Array.isArray(r.questionSessions)?r.questionSessions:[])
    .filter(questionSessionIsUsable)
    .slice()
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  let solved=0, correct=0;
  sessions.forEach(s=>{ solved+=s.total; correct+=s.correct; });
  return {
    sessions,
    sessionCount:sessions.length,
    solved,
    correct,
    wrong:Math.max(0,solved-correct),
    accuracy:solved ? Math.round(correct/solved*100) : null
  };
}

function readingsTotals(){
  let doneCount=0, total=0;
  allReadingsFlat().forEach(({r})=>{
    total++;
    if(r.status==="done") doneCount++;
  });
  return {doneCount, total, pct: total? doneCount/total*100 : 0};
}
function examDaysLeft(){ return Math.max(0, daysBetweenKeys(todayKey(), S.examDate)); }

/* ---------- toast ---------- */
function flashSaved(){
  const p=$("#savedPill"); if(!p) return;
  if(p.dataset.busy==="1") return;
  p.textContent="✓ حُفظ"; p.style.color=""; p.style.borderColor="";
  p.classList.add("show");
  clearTimeout(flashSaved._t);
  flashSaved._t=setTimeout(()=>p.classList.remove("show"),1100);
}
function toast(msg, bad){
  const p=$("#savedPill"); if(!p) return;
  p.dataset.busy="1";
  p.textContent=msg;
  p.style.color = bad? "var(--bad)" : "var(--strong)";
  p.style.borderColor = bad? "rgba(216,106,75,.5)" : "rgba(84,180,136,.4)";
  p.classList.add("show");
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{ p.classList.remove("show"); p.dataset.busy=""; },1800);
}
function armConfirm(btn, fn, confirmText){
  if(btn.dataset.arm==="1"){
    btn.dataset.arm="";
    btn.textContent=btn.dataset.oldText||btn.textContent;
    delete btn.dataset.oldText;
    btn.classList.remove("armed");
    fn();
    return;
  }
  btn.dataset.arm="1";
  const old=btn.textContent;
  btn.dataset.oldText=old;
  btn.textContent=confirmText||"تأكيد الاستبدال؟"; btn.classList.add("armed");
  setTimeout(()=>{ if(btn.dataset.arm==="1"){
    btn.dataset.arm="";
    btn.textContent=old;
    delete btn.dataset.oldText;
    btn.classList.remove("armed");
  } }, 2600);
}

/* ---------- render: summary header ---------- */
function renderSummary(){
  $("#examDateIn").value = S.examDate;
  $("#examDaysVal").textContent = examDaysLeft();
  const R=readingsTotals();
  const q=questionTotals();
  $("#progressPctVal").textContent = Math.round(R.pct);
  $("#progressBar").style.width = R.pct+"%";
  $("#readingsDoneVal").textContent = R.doneCount;
  $("#readingsTotalVal").textContent = R.total;
  $("#questionSessionsVal").textContent = q.sessions;
  $("#questionAccuracyVal").textContent = q.pct===null ? "—" : q.pct;
  $("#questionAccuracyUnit").hidden = q.pct===null;
}

/* ---------- UI-only prefs: which topic accordions are open ----------
   Kept outside S on purpose: pure display state, not study data, so it never
   needs a migration and never touches import/export. */
const UI_PREFS_KEY = "cfa_l2_ui_prefs_v1";
let openTopics = new Set();
function loadUiPrefs(){
  try{
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if(raw){
      const p = JSON.parse(raw);
      if(Array.isArray(p.open)){ openTopics = new Set(p.open); return; }
    }
  }catch(e){}
  /* first run: open whichever topics already have a reading in progress */
  S.topics.forEach(t=>{ if(t.r.some(r=>r.status==="doing")) openTopics.add(t.id); });
}
function saveUiPrefs(){
  try{ localStorage.setItem(UI_PREFS_KEY, JSON.stringify({open:[...openTopics]})); }catch(e){}
}

/* ---------- render: readings list (the main section) ---------- */
let QUERY="";
const RATE_LABEL = {weak:"ضعيف", mid:"متوسط", strong:"قوي"};
function topicStats(t){
  let done=0, weak=0;
  t.r.forEach(r=>{
    if(r.status==="done") done++;
    if(r.mastery==="weak" || r.qMastery==="weak") weak++;
  });
  const total=t.r.length;
  return {done, total, weak, pct: total? Math.round(done/total*100) : 0};
}
function ratingGroup(label, getVal, setVal){
  const wrap=document.createElement("div"); wrap.className="r-field r-rate";
  const lab=document.createElement("span"); lab.textContent=label;
  wrap.appendChild(lab);
  const row=document.createElement("div"); row.className="rate-row";
  const btns={};
  ["weak","mid","strong"].forEach(k=>{
    const b=document.createElement("button"); b.type="button";
    b.className="rate-btn rate-"+k;
    b.textContent=RATE_LABEL[k];
    b.onclick=()=>{ setVal(getVal()===k ? "none" : k); update(); };
    btns[k]=b;
    row.appendChild(b);
  });
  function update(){
    const v=getVal();
    Object.keys(btns).forEach(k=>btns[k].classList.toggle("active", v===k));
  }
  update();
  wrap.appendChild(row);
  wrap._update=update;
  return wrap;
}
function questionSessionForm(r, existing){
  const form=document.createElement("form"); form.className="q-session-form";

  const dateField=document.createElement("label"); dateField.className="qs-field";
  dateField.appendChild(document.createTextNode("التاريخ"));
  const dateInput=document.createElement("input"); dateInput.type="date"; dateInput.className="qs-date";
  dateInput.required=true; dateInput.value=existing ? (existing.date||todayKey()) : todayKey();
  dateField.appendChild(dateInput);

  const nameField=document.createElement("label"); nameField.className="qs-field";
  nameField.appendChild(document.createTextNode("اسم الجلسة أو المصدر (اختياري)"));
  const nameInput=document.createElement("input"); nameInput.type="text"; nameInput.className="qs-name";
  nameInput.placeholder="مثال: CFAI بنك الأسئلة"; nameInput.value=existing ? (existing.name||"") : "";
  nameField.appendChild(nameInput);

  const scopeField=document.createElement("label"); scopeField.className="qs-field qs-field-scope";
  scopeField.appendChild(document.createTextNode("نطاق أو طريقة الأسئلة (اختياري)"));
  const scopeInput=document.createElement("input"); scopeInput.type="text"; scopeInput.className="qs-scope";
  scopeInput.placeholder="مثال: جزء DDM أو أسئلة المفاهيم فقط"; scopeInput.value=existing ? (existing.scope||"") : "";
  scopeField.appendChild(scopeInput);

  const totalField=document.createElement("label"); totalField.className="qs-field";
  totalField.appendChild(document.createTextNode("عدد الأسئلة"));
  const totalInput=document.createElement("input"); totalInput.type="number"; totalInput.className="qs-total";
  totalInput.min="1"; totalInput.step="1"; totalInput.required=true;
  totalInput.placeholder="مثال: 20"; totalInput.value=existing ? existing.total : "";
  totalField.appendChild(totalInput);

  const correctField=document.createElement("label"); correctField.className="qs-field";
  correctField.appendChild(document.createTextNode("الإجابات الصحيحة"));
  const correctInput=document.createElement("input"); correctInput.type="number"; correctInput.className="qs-correct";
  correctInput.min="0"; correctInput.step="1"; correctInput.required=true;
  correctInput.placeholder="مثال: 14"; correctInput.value=existing ? existing.correct : "";
  correctField.appendChild(correctInput);
  const refreshCorrectMax=()=>{ correctInput.max=totalInput.value||""; };
  totalInput.addEventListener("input",refreshCorrectMax);
  refreshCorrectMax();

  const noteFieldWrap=document.createElement("label"); noteFieldWrap.className="qs-field qs-field-note";
  noteFieldWrap.appendChild(document.createTextNode("ملاحظات الجلسة"));
  const noteInput=document.createElement("textarea"); noteInput.className="qs-note"; noteInput.rows=2;
  noteInput.placeholder="ما الأخطاء أو القواعد التي تحتاج مراجعة؟"; noteInput.value=existing ? (existing.note||"") : "";
  noteFieldWrap.appendChild(noteInput);

  const actions=document.createElement("div"); actions.className="q-session-form-actions";
  const submit=document.createElement("button"); submit.type="submit"; submit.className="grow";
  submit.textContent=existing ? "حفظ التعديل" : "إضافة الجلسة";
  actions.appendChild(submit);
  if(existing){
    const cancel=document.createElement("button"); cancel.type="button"; cancel.textContent="إلغاء";
    cancel.onclick=()=>renderReadings();
    actions.appendChild(cancel);
  }

  form.appendChild(dateField); form.appendChild(nameField); form.appendChild(totalField); form.appendChild(correctField);
  form.appendChild(scopeField);
  form.appendChild(noteFieldWrap); form.appendChild(actions);
  form.addEventListener("submit", e=>{
    e.preventDefault();
    const total=Number(totalInput.value), correct=Number(correctInput.value);
    if(!dateInput.value){ toast("اختر تاريخ الجلسة", true); return; }
    if(!Number.isInteger(total) || total<1){ toast("أدخل عدد أسئلة صحيحاً وأكبر من صفر", true); return; }
    if(!Number.isInteger(correct) || correct<0 || correct>total){
      toast("الإجابات الصحيحة يجب أن تكون بين صفر وإجمالي الأسئلة", true); return;
    }
    const values={date:dateInput.value, name:nameInput.value.trim(), scope:scopeInput.value.trim(), total:total, correct:correct, note:noteInput.value.trim()};
    if(existing){
      Object.assign(existing, values);
    }else{
      if(!Array.isArray(r.questionSessions)) r.questionSessions=[];
      r.questionSessions.unshift({
        id:"qs-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8),
        ...values
      });
    }
    save();
    renderReadings();
    renderSummary();
    toast(existing ? "تم تعديل جلسة الأسئلة" : "تم حفظ جلسة الأسئلة");
  });
  return form;
}
function questionSessionRow(r, session){
  const row=document.createElement("article"); row.className="q-session-row";
  const head=document.createElement("div"); head.className="q-session-row-head";
  const date=document.createElement("span"); date.className="qs-date-text mono"; date.textContent=fmtDate(session.date);
  const name=document.createElement("strong"); name.className="qs-name-text"; name.textContent=session.name||"جلسة أسئلة";
  head.appendChild(date); head.appendChild(name);
  const stats=document.createElement("div"); stats.className="q-session-stats mono";
  stats.textContent=session.total+" سؤال · "+session.correct+" صحيحة · "+(session.total-session.correct)+" خطأ · "+questionSessionAccuracy(session)+"٪";
  row.appendChild(head); row.appendChild(stats);
  if((session.scope||"").trim()){
    const scope=document.createElement("p"); scope.className="q-session-scope"; scope.textContent="النطاق/الطريقة: "+session.scope.trim();
    row.appendChild(scope);
  }
  if((session.note||"").trim()){
    const note=document.createElement("p"); note.className="q-session-note"; note.textContent=session.note.trim();
    row.appendChild(note);
  }
  const actions=document.createElement("div"); actions.className="q-session-actions";
  const edit=document.createElement("button"); edit.type="button"; edit.className="q-session-edit"; edit.textContent="تعديل";
  edit.onclick=()=>{ row.replaceChildren(questionSessionForm(r,session)); };
  const del=document.createElement("button"); del.type="button"; del.className="q-session-delete"; del.textContent="حذف";
  del.onclick=()=>armConfirm(del, ()=>{
    r.questionSessions=r.questionSessions.filter(s=>s.id!==session.id);
    save(); renderReadings(); renderSummary(); toast("تم حذف جلسة الأسئلة");
  }, "تأكيد الحذف؟");
  actions.appendChild(edit); actions.appendChild(del); row.appendChild(actions);
  return row;
}
function questionSessionsPanel(r){
  const stats=questionSessionStats(r);
  const panel=document.createElement("details"); panel.className="q-sessions"; panel.open=stats.sessionCount>0;
  const summary=document.createElement("summary");
  const title=document.createElement("span"); title.className="q-sessions-title"; title.textContent="جلسات الأسئلة";
  const count=document.createElement("span"); count.className="q-sessions-count"; count.textContent=stats.sessionCount+" جلسة";
  summary.appendChild(title); summary.appendChild(count); panel.appendChild(summary);
  const body=document.createElement("div"); body.className="q-sessions-body";
  const hint=document.createElement("p"); hint.className="q-sessions-hint";
  hint.textContent="تنبيه: دقة الجلسة تخص الجزء أو طريقة الأسئلة المكتوبة هنا فقط، ولا تعني إتقان الـReading كاملًا. تقييم فهم القراءة مستقل أعلاه.";
  body.appendChild(hint);
  const totalLine=document.createElement("div"); totalLine.className="q-sessions-total";
  totalLine.textContent=stats.solved ?
    "الإجمالي: "+stats.solved+" سؤال · "+stats.correct+" صحيحة · "+stats.wrong+" خطأ · "+stats.accuracy+"٪" :
    "لم تسجل أسئلة لهذه القراءة بعد";
  body.appendChild(totalLine);
  const addTitle=document.createElement("div"); addTitle.className="q-session-add-title"; addTitle.textContent="إضافة جلسة جديدة";
  body.appendChild(addTitle); body.appendChild(questionSessionForm(r));
  const list=document.createElement("div"); list.className="q-session-list";
  if(stats.sessionCount){
    stats.sessions.forEach(session=>list.appendChild(questionSessionRow(r,session)));
  }else{
    const empty=document.createElement("p"); empty.className="q-session-empty"; empty.textContent="سجّل أول جلسة هنا، وخلّ ملاحظاتك مرتبطة بالقراءة نفسها.";
    list.appendChild(empty);
  }
  body.appendChild(list); panel.appendChild(body);
  return panel;
}
function noteField(label, r, key){
  const wrap=document.createElement("label"); wrap.className="r-notewrap";
  const lab=document.createElement("span"); lab.textContent=label;
  wrap.appendChild(lab);
  const area=document.createElement("textarea"); area.className="r-note"; area.rows=2;
  area.placeholder="اكتب ملاحظتك هنا مباشرة…";
  area.value=r[key]||"";
  area.addEventListener("input",()=>{
    /* Update the live state on every keystroke. The persistence debounce is now
       safe because blur/pagehide/visibilitychange can flush this exact value. */
    r[key]=area.value;
    save();
  });
  area.addEventListener("blur",flushSave);
  wrap.appendChild(area);
  return wrap;
}
/* ---------- copy a reading's full state as text (for pasting into ChatGPT) ----------
   Reads only what's already in state; nothing here writes or changes study data. */
async function copyText(text){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(e){}
  /* fallback for non-secure contexts / older iOS Safari */
  try{
    const ta=document.createElement("textarea");
    ta.value=text;
    ta.setAttribute("readonly","");
    ta.style.position="fixed"; ta.style.top="0"; ta.style.insetInlineStart="-9999px"; ta.style.opacity="0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok=document.execCommand("copy");
    ta.remove();
    return ok;
  }catch(e){ return false; }
}
function rateText(v){ return RATE_LABEL[v] || "لم أقيّمها بعد"; }
function noteText(v){ const s=(v||"").trim(); return s || "(لا توجد ملاحظات)"; }
const COPY_DIVIDER = "────────────────";
function examContextLines(){
  const R=readingsTotals();
  return [
    "التاريخ: "+fmtDate(todayKey())+" — متبقٍ على الاختبار "+examDaysLeft()+" يوماً (اختبار "+fmtDate(S.examDate)+")",
    "تقدّمي العام: "+R.doneCount+"/"+R.total+" قراءة مكتملة ("+Math.round(R.pct)+"٪)"
  ];
}
function topicHeaderLines(t){
  const st=topicStats(t);
  return [
    "القسم: "+(t.en||t.ar)+" — "+(t.ar||"")+" ["+(t.abbr||t.id.toUpperCase())+"]",
    "تقدّم القسم: "+st.done+"/"+st.total+" ("+st.pct+"٪)"+(st.weak?(" — "+st.weak+" قراءة تحتاج مراجعة"):"")
  ];
}
/* one reading's own state; `prefix` numbers it when several are listed together */
function readingDetailLines(r, prefix){
  const title=(r.en||"").trim() || (r.ar||"").trim() || "قراءة بدون اسم";
  const q=questionSessionStats(r);
  const L=[];
  L.push((prefix||"")+"القراءة"+(r.readingNo==null?"":" رقم "+r.readingNo)+": "+title);
  if(r.ar && r.en) L.push("الاسم بالعربي: "+r.ar);
  L.push("الحالة: "+(STAT[r.status]||r.status));
  L.push("");
  L.push("تقييم فهمي للقراءة: "+rateText(r.mastery));
  L.push("ملاحظات القراءة:");
  L.push(noteText(r.note));
  L.push("");
  L.push("تقييم حلّي للأسئلة: "+rateText(r.qMastery));
  L.push("ملاحظات الأسئلة:");
  L.push(noteText(r.qNote));
  if(q.solved || q.sessionCount){
    L.push("");
    L.push("إجمالي أسئلة الجلسات: "+q.solved+" — صحيحة: "+q.correct+" — خطأ: "+q.wrong+" ("+q.accuracy+"٪)");
  }
  if(q.sessionCount){
    L.push("تنبيه: دقة كل جلسة تخص الجزء أو طريقة الأسئلة المسجّلة فيها فقط، ولا تعني إتقان القراءة كاملة.");
    L.push("عدد جلسات الأسئلة: "+q.sessionCount);
    L.push("سجل الجلسات:");
    q.sessions.forEach(s=>{
      const name=(s.name||"").trim() || "جلسة أسئلة";
      const scope=(s.scope||"").trim();
      L.push("• "+fmtDate(s.date)+" — "+name+(scope ? " — النطاق/الطريقة: "+scope : "")+" — "+s.total+" سؤال — "+s.correct+" صحيحة — "+(s.total-s.correct)+" خطأ ("+questionSessionAccuracy(s)+"٪)");
      if((s.note||"").trim()) L.push("  ملاحظات الجلسة: "+s.note.trim());
    });
  }
  if(r.excludedFraction && (r.excludedNote||"").trim()){
    L.push("");
    L.push("ملاحظة على المنهج: "+r.excludedNote.trim());
  }
  return L;
}
function readingSummaryText(t,r){
  const L=["ملخص قراءة — CFA Level II"]
    .concat(examContextLines(), [""], topicHeaderLines(t), [""], readingDetailLines(r), [""]);
  L.push("المطلوب منك: راجع حالتي في هذه القراءة أعلاه، ووضّح لي النقاط اللي أنا ضعيف فيها، واقترح لي خطة مذاكرة ومراجعة عملية لها.");
  return L.join("\n");
}
/* the whole topic: every reading in it, regardless of the search filter (hence "القسم كامل") */
function topicSummaryText(t){
  const L=["ملخص قسم كامل — CFA Level II"]
    .concat(examContextLines(), [""], topicHeaderLines(t));
  L.push("عدد القراءات في القسم: "+t.r.length);
  t.r.forEach((r,i)=>{
    L.push("");
    L.push(COPY_DIVIDER);
    L.push.apply(L, readingDetailLines(r, "["+(i+1)+"/"+t.r.length+"] "));
  });
  L.push("");
  L.push(COPY_DIVIDER);
  L.push("المطلوب منك: راجع حالتي في هذا القسم كاملاً، وحدّد لي أضعف القراءات والترتيب الأنسب لمراجعتها، واقترح لي خطة مذاكرة عملية للقسم كله.");
  return L.join("\n");
}
/* shared click behaviour: copy, then report the real result inline + in the toast pill */
function makeCopyBtn(cls, label, title, buildText, okToast){
  const btn=document.createElement("button");
  btn.type="button"; btn.className=cls;
  btn.textContent=label;
  btn.title=title;
  btn.onclick=async (e)=>{
    e.stopPropagation();
    if(btn.dataset.busy==="1") return;
    btn.dataset.busy="1";
    const ok=await copyText(buildText());
    btn.textContent = ok ? "✓ تم النسخ" : "تعذّر النسخ";
    btn.classList.toggle("copied", ok);
    toast(ok ? okToast : "تعذّر النسخ؛ جرّب مرة ثانية", !ok);
    setTimeout(()=>{ btn.textContent=label; btn.classList.remove("copied"); btn.dataset.busy=""; }, 1600);
  };
  return btn;
}
function copyButton(t,r){
  return makeCopyBtn(
    "r-copy-btn", "نسخ إلى ابو جبت",
    "نسخ حالة هذه القراءة كاملة (ملاحظاتي وتقييماتي ونطاق جلسات الأسئلة) للصقها في ChatGPT",
    ()=>readingSummaryText(t,r),
    "تم نسخ ملخص القراءة — الصقه في ابو جبت"
  );
}
/* ---------- copy EVERYTHING: one full snapshot of my progress ----------
   Same rule as the smaller copy buttons: reads live state only, writes nothing. */
function statusCounts(){
  const c={todo:0,doing:0,done:0};
  allReadingsFlat().forEach(({r})=>{ if(c[r.status]===undefined) c[r.status]=0; c[r.status]++; });
  return c;
}
function questionTotals(){
  let solved=0, correct=0, sessions=0;
  allReadingsFlat().forEach(({r})=>{
    const q=questionSessionStats(r);
    solved+=q.solved; correct+=q.correct; sessions+=q.sessionCount;
  });
  return {solved, correct, sessions, pct: solved ? Math.round(correct/solved*100) : null};
}
/* "weak" = I rated either the reading itself or my question-solving as weak */
function weakReadings(){
  return allReadingsFlat().filter(({r})=> r.mastery==="weak" || r.qMastery==="weak");
}
function overviewLines(){
  const R=readingsTotals(), c=statusCounts(), q=questionTotals(), weak=weakReadings();
  const L=[];
  L.push("عدد الأقسام: "+S.topics.length+" — إجمالي القراءات: "+R.total);
  L.push("حالة القراءات: مكتملة "+(c.done||0)+" — أذاكرها الآن "+(c.doing||0)+" — لم أبدأ "+(c.todo||0));
  L.push("قراءات قيّمتها ضعيفة (تحتاج مراجعة): "+weak.length);
  L.push("جلسات الأسئلة المسجّلة: "+q.sessions);
  if(q.solved) L.push("إجمالي أسئلة الجلسات: "+q.solved+" — صحيحة: "+q.correct+" ("+q.pct+"٪)");
  else L.push("إجمالي أسئلة الجلسات: لم أسجّل أي أسئلة بعد");
  return L;
}
function topicsTableLines(){
  return S.topics.map(t=>{
    const st=topicStats(t);
    return "• ["+(t.abbr||t.id.toUpperCase())+"] "+(t.en||t.ar)+" — "+st.done+"/"+st.total+" ("+st.pct+"٪)"+
      (st.weak ? (" — "+st.weak+" تحتاج مراجعة") : "");
  });
}
function weakListLines(){
  const weak=weakReadings();
  if(!weak.length) return ["(لا توجد قراءات قيّمتها ضعيفة حتى الآن)"];
  return weak.map(({t,r})=>{
    const title=(r.en||"").trim() || (r.ar||"").trim() || "قراءة بدون اسم";
    const why=[];
    if(r.mastery==="weak") why.push("فهم القراءة ضعيف");
    if(r.qMastery==="weak") why.push("حلّ الأسئلة ضعيف");
    return "• ["+(t.abbr||t.id.toUpperCase())+"] "+title+" — "+why.join(" + ");
  });
}
function mockLines(){
  const ms=(S.mocks||[]).slice().sort((a,b)=> a.date<b.date?1:-1);
  if(!ms.length) return ["(لا اختبارات تجريبية مسجّلة بعد)"];
  const avg=ms.reduce((s,m)=>s+(m.score||0),0)/ms.length;
  const best=ms.reduce((b,m)=> (m.score||0)>(b.score||0)?m:b, ms[0]);
  const L=["عدد الاختبارات: "+ms.length+" — المتوسط: "+fmt(avg)+"٪ — الأفضل: "+fmt(best.score)+"٪ ("+fmtDate(best.date)+")",""];
  ms.forEach(m=>{
    const note=(m.note||"").trim();
    L.push("• "+fmtDate(m.date)+" — "+((m.name||"").trim()||"اختبار تجريبي")+" — "+fmt(m.score)+"٪"+(note?(" — "+note):""));
  });
  return L;
}
/* every topic, every reading, every note and rating I have — nothing filtered out */
function fullSummaryText(){
  const L=["ملخص تقدّمي الكامل — CFA Level II"].concat(examContextLines(), [""]);
  L.push(COPY_DIVIDER);
  L.push("١) نظرة عامة");
  L.push(COPY_DIVIDER);
  L.push.apply(L, overviewLines());

  L.push("");
  L.push(COPY_DIVIDER);
  L.push("٢) تقدّمي في كل قسم");
  L.push(COPY_DIVIDER);
  L.push.apply(L, topicsTableLines());

  L.push("");
  L.push(COPY_DIVIDER);
  L.push("٣) القراءات التي قيّمتها ضعيفة");
  L.push(COPY_DIVIDER);
  L.push.apply(L, weakListLines());

  L.push("");
  L.push(COPY_DIVIDER);
  L.push("٤) الاختبارات التجريبية");
  L.push(COPY_DIVIDER);
  L.push.apply(L, mockLines());

  L.push("");
  L.push(COPY_DIVIDER);
  L.push("٥) تفاصيل كل قراءة (ملاحظاتي وتقييماتي كاملة)");
  L.push(COPY_DIVIDER);
  S.topics.forEach(t=>{
    L.push("");
    L.push("══════ "+(t.abbr||t.id.toUpperCase())+" ══════");
    L.push.apply(L, topicHeaderLines(t));
    t.r.forEach((r,i)=>{
      L.push("");
      L.push(COPY_DIVIDER);
      L.push.apply(L, readingDetailLines(r, "["+(i+1)+"/"+t.r.length+"] "));
    });
  });

  L.push("");
  L.push(COPY_DIVIDER);
  L.push("المطلوب منك: هذا كل تقدّمي في CFA Level II. راجعه كاملاً، وحدّد لي أضعف نقاطي "+
    "وأولويات المراجعة بالترتيب، ثم اقترح لي خطة مذاكرة عملية للأيام المتبقية حتى الاختبار "+
    "موزّعة على الأقسام حسب أوزانها وحسب ضعفي الفعلي.");
  return L.join("\n");
}
function copyAllButton(){
  return makeCopyBtn(
    "copy-all-btn", "نسخ كل تقدّمي إلى ابو جبت",
    "نسخ كل تقدّمي كاملاً (كل الأقسام والقراءات والملاحظات والتقييمات ونطاق جلسات الأسئلة والاختبارات) للصقه في ChatGPT",
    fullSummaryText,
    "تم نسخ كل تقدّمي — الصقه في ابو جبت"
  );
}
function copyTopicButton(t){
  return makeCopyBtn(
    "t-copy-btn", "نسخ القسم كامل إلى ابو جبت",
    "نسخ حالة قراءات هذا القسم كلها (ملاحظاتي وتقييماتي) للصقها في ChatGPT",
    ()=>topicSummaryText(t),
    "تم نسخ ملخص القسم كامل — الصقه في ابو جبت"
  );
}

function readingMatchesQuery(t,r){
  if(!QUERY) return true;
  const sessionHay=(Array.isArray(r.questionSessions)?r.questionSessions:[])
    .map(s=>(s.name||"")+" "+(s.scope||"")+" "+(s.note||"")).join(" ");
  const hay=norm((r.en||"")+" "+(r.ar||"")+" "+(t.en||"")+" "+(t.ar||"")+" "+sessionHay);
  return hay.indexOf(QUERY)!==-1;
}
function bindField(el, get, set){
  el.value = get();
  el.addEventListener("change", ()=>{ set(el.value); save(); });
}
function readingCard(t,r,onFlagChange){
  const card=document.createElement("div");
  card.className="r-card";
  card.dataset.status=r.status;
  function updateFlag(){
    card.classList.toggle("needs-review", r.mastery==="weak" || r.qMastery==="weak");
    if(onFlagChange) onFlagChange();
  }
  updateFlag();

  const head=document.createElement("div"); head.className="r-head";
  const noInput=document.createElement("input");
  noInput.type="number"; noInput.min="0"; noInput.step="1"; noInput.className="r-no"; noInput.placeholder="#";
  noInput.value = r.readingNo==null ? "" : r.readingNo;
  noInput.title="رقم القراءة";
  noInput.onchange=()=>{ const v=parseInt(noInput.value,10); r.readingNo = isNaN(v)?null:v; save(); };
  const nameInput=document.createElement("input");
  nameInput.type="text"; nameInput.className="r-name"; nameInput.placeholder="اسم القراءة";
  nameInput.value = r.en || r.ar || "";
  nameInput.onchange=()=>{ r.en = nameInput.value.trim(); save(); };
  const statusSel=document.createElement("select"); statusSel.className="r-status";
  Object.keys(STAT).forEach(k=>{ const o=document.createElement("option"); o.value=k; o.textContent=STAT[k]; statusSel.appendChild(o); });
  statusSel.value=r.status;
  statusSel.onchange=()=>{ r.status=statusSel.value; card.dataset.status=r.status; save(); renderSummary(); if(onFlagChange) onFlagChange(); };
  head.appendChild(noInput); head.appendChild(nameInput); head.appendChild(statusSel);
  card.appendChild(head);

  if(r.ar && r.en){
    const sub=document.createElement("div"); sub.className="r-sub"; sub.textContent=r.ar;
    card.appendChild(sub);
  }

  const pairs=document.createElement("div"); pairs.className="r-pairs";

  const readPair=document.createElement("div"); readPair.className="r-pair";
  readPair.appendChild(ratingGroup("تقييم فهمي للقراءة", ()=>r.mastery||"none", v=>{ r.mastery=v; save(); updateFlag(); }));
  readPair.appendChild(noteField("ملاحظات القراءة", r, "note"));
  pairs.appendChild(readPair);

  const qPair=document.createElement("div"); qPair.className="r-pair";
  qPair.appendChild(ratingGroup("تقييم حلّي للأسئلة", ()=>r.qMastery||"none", v=>{ r.qMastery=v; save(); updateFlag(); }));
  qPair.appendChild(noteField("ملاحظات الأسئلة", r, "qNote"));
  pairs.appendChild(qPair);

  card.appendChild(pairs);
  card.appendChild(questionSessionsPanel(r));

  const actions=document.createElement("div"); actions.className="r-actions";
  actions.appendChild(copyButton(t,r));
  card.appendChild(actions);

  return card;
}
function renderTopicsNav(){
  const nav=$("#topicsNav");
  if(!nav) return;
  nav.innerHTML="";
  S.topics.forEach(t=>{
    const st=topicStats(t);
    const chip=document.createElement("button");
    chip.type="button";
    chip.className="topic-chip"+(st.done===st.total?" done":"");
    chip.innerHTML=
      '<span class="tc-abbr">'+esc(t.abbr||t.id.toUpperCase())+'</span>'+
      '<span class="tc-frac mono">'+st.done+'/'+st.total+'</span>'+
      (st.weak?'<span class="tc-weak" title="'+st.weak+' تحتاج مراجعة">'+st.weak+'</span>':'');
    chip.title=t.en||t.ar;
    chip.onclick=()=>{
      openTopics.add(t.id); saveUiPrefs(); renderReadings();
      const target=document.getElementById("topic-"+t.id);
      if(target) target.scrollIntoView({behavior:"smooth", block:"start"});
    };
    nav.appendChild(chip);
  });
}
function renderReadings(){
  const host=$("#readingsHost");
  host.innerHTML="";
  const searching=!!QUERY;
  S.topics.forEach(t=>{
    const rows=t.r.filter(r=>readingMatchesQuery(t,r));
    if(searching && rows.length===0) return;
    const isOpen = searching || openTopics.has(t.id);

    const group=document.createElement("div"); group.className="t-group"+(isOpen?" open":""); group.id="topic-"+t.id;

    const head=document.createElement("button"); head.type="button"; head.className="t-group-head";
    head.setAttribute("aria-expanded", isOpen?"true":"false");
    const abbr=document.createElement("span"); abbr.className="tg-abbr"; abbr.textContent=t.abbr||t.id.toUpperCase();
    const name=document.createElement("span"); name.className="tg-name"; name.textContent=t.en||t.ar;
    const bar=document.createElement("span"); bar.className="tg-progress";
    const barI=document.createElement("i");
    bar.appendChild(barI);
    const frac=document.createElement("span"); frac.className="tg-frac mono";
    const weakBadge=document.createElement("span"); weakBadge.className="tg-weak-badge";
    const chevron=document.createElement("span"); chevron.className="tg-chevron"; chevron.textContent="▾";
    head.appendChild(abbr); head.appendChild(name); head.appendChild(bar); head.appendChild(frac); head.appendChild(weakBadge); head.appendChild(chevron);
    function refreshHeader(){
      const st=topicStats(t);
      barI.style.width=st.pct+"%";
      frac.textContent=st.done+"/"+st.total;
      weakBadge.textContent=st.weak?st.weak:"";
      weakBadge.style.display=st.weak?"":"none";
      renderTopicsNav();
    }
    refreshHeader();
    head.onclick=()=>{
      if(openTopics.has(t.id)) openTopics.delete(t.id); else openTopics.add(t.id);
      saveUiPrefs(); renderReadings();
    };
    group.appendChild(head);

    const bodyWrap=document.createElement("div"); bodyWrap.className="t-group-body-wrap";
    const body=document.createElement("div"); body.className="t-group-body";
    const tActions=document.createElement("div"); tActions.className="t-actions";
    tActions.appendChild(copyTopicButton(t));
    body.appendChild(tActions);
    rows.forEach(r=>body.appendChild(readingCard(t,r,refreshHeader)));
    const addBtn=document.createElement("button"); addBtn.type="button"; addBtn.className="add-reading-btn";
    addBtn.textContent="+ إضافة قراءة جديدة";
    addBtn.onclick=()=>{
      t.r.push({
        id:t.id+"-new-"+Date.now(), ar:"", en:"قراءة جديدة", status:"todo", mastery:"none", qMastery:"none",
        note:"", qNote:"", topicId:t.id, readingNo:null, excludedFraction:0, excludedNote:"",
        stages:defaultStages(), sourceMap:defaultSourceMap(), pages:{mark:"",schweser:"",cfai:"",secretSauce:""},
        brief:defaultBrief(), closeout:{status:"open",closedAt:null}, questionSessions:[]
      });
      openTopics.add(t.id); saveUiPrefs();
      save(); renderReadings(); renderSummary();
    };
    body.appendChild(addBtn);
    bodyWrap.appendChild(body);
    group.appendChild(bodyWrap);
    host.appendChild(group);
  });
  renderTopicsNav();
}

/* ---------- render: mock exams ---------- */
function renderMocks(){
  const host=$("#mockList");
  const ms=S.mocks.slice().sort((a,b)=> a.date<b.date?1:-1);
  if(!ms.length){ host.innerHTML='<p class="empty">لا اختبارات مسجّلة بعد.</p>'; return; }
  host.innerHTML="";
  ms.forEach(m=>{
    const row=document.createElement("div"); row.className="mock-row";
    row.innerHTML=
      '<span class="mk-date">'+fmtDate(m.date)+'</span>'+
      '<span class="mk-name">'+esc(m.name||"اختبار تجريبي")+'</span>'+
      '<span class="mk-score">'+fmt(m.score)+'٪</span>'+
      (m.note?('<span class="mk-note">'+esc(m.note)+'</span>'):'<span></span>');
    const del=document.createElement("button"); del.type="button"; del.className="mk-del"; del.textContent="×"; del.title="حذف";
    del.onclick=()=>{ S.mocks=S.mocks.filter(x=>x.id!==m.id); save(); renderMocks(); };
    row.appendChild(del);
    host.appendChild(row);
  });
}

/* ---------- render everything ---------- */
function renderAll(){
  renderSummary();
  renderReadings();
  renderMocks();
}

/* ---------- wire up static controls ---------- */
const copyAllHost=$("#copyAllHost");
if(copyAllHost) copyAllHost.appendChild(copyAllButton());

$("#examDateIn").onchange=e=>{ if(e.target.value){ S.examDate=e.target.value; save(); renderSummary(); } };
$("#searchIn").oninput=e=>{ QUERY=norm(e.target.value.trim()); renderReadings(); };
$("#expandAllBtn").onclick=()=>{ S.topics.forEach(t=>openTopics.add(t.id)); saveUiPrefs(); renderReadings(); };
$("#collapseAllBtn").onclick=()=>{ openTopics.clear(); saveUiPrefs(); renderReadings(); };

$("#mockAddBtn").onclick=()=>{
  const d=$("#mkDate").value || todayKey();
  const n=$("#mkName").value.trim();
  const sc=parseFloat($("#mkScore").value);
  const note=$("#mkNote").value.trim();
  if(isNaN(sc) || sc<0 || sc>100){ toast("أدخل نتيجة بين 0 و100", true); return; }
  S.mocks.push({id:String(Date.now()), date:d, name:n, score:sc, note:note});
  $("#mkName").value=""; $("#mkScore").value=""; $("#mkNote").value="";
  save(); renderMocks();
};

$("#exportBtn").onclick=async ()=>{
  try{
    const name="cfa-l2-progress-"+todayKey()+".json";
    const text=JSON.stringify(S,null,2);
    const blob=new Blob([text],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    S.lastExport=Date.now(); save();
    toast("تم تنزيل النسخة الاحتياطية");
  }catch(err){
    toast("تعذّر التصدير", true);
  }
};
$("#importBtn").onclick=()=>armConfirm($("#importBtn"), ()=>$("#importFile").click());
$("#importFile").onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=async ()=>{
    let parsed;
    try{
      parsed=JSON.parse(rd.result);
    }catch(err){
      toast("تعذّر قراءة ملف JSON: الملف تالف ولم تتغير بياناتك", true);
      return;
    }
    const shape=validateImportData(parsed);
    if(!shape.ok){
      toast(shape.message+" لم تتغير بياناتك", true);
      return;
    }
    let candidate;
    try{
      candidate=migrate(JSON.parse(JSON.stringify(parsed)));
      const migratedShape=validateImportData(candidate);
      if(!migratedShape.ok) throw new Error(migratedShape.message);
      candidate.lastLocalChangeAt=Date.now();
    }catch(err){
      console.error("Import migration failed — keeping existing data untouched", err);
      toast("تعذّرت ترقية النسخة الاحتياطية؛ لم تتغير بياناتك", true);
      return;
    }
    const backupCreated=await saveImportBackup(S);
    if(!backupCreated){
      toast("تعذّر إنشاء النسخة الاحتياطية التلقائية؛ لم تتغير بياناتك", true);
      return;
    }
    clearTimeout(saveT);
    saveT=null;
    const persisted=await persistState(candidate,false);
    if(!persisted){
      toast("تعذّر حفظ البيانات المستوردة؛ لم تتغير بياناتك", true);
      return;
    }
    S=candidate;
    renderAll();
    if(window.cfaSync) window.cfaSync.onLocalChange();
    toast("تم استيراد النسخة الاحتياطية بنجاح");
  };
  rd.readAsText(f);
  e.target.value="";
};

/* ---------- boot ---------- */
(async function init(){
  let loaded=null;
  try{ loaded = await store.read(); }catch(e){}
  if(loaded){
    if((loaded.v||1)<7) savePreMigrationBackup(loaded);
    try{
      S = migrate(JSON.parse(JSON.stringify(loaded)));
    }catch(e){
      console.error("v7 migration failed — keeping existing data untouched", e);
      S = loaded;
      toast("تعذّرت ترقية البيانات تلقائياً — لم يتغيّر شيء في تقدّمك", true);
    }
  } else {
    S = fresh();
  }
  loadUiPrefs();
  renderAll();
  const persisted=await persistState(S,false);
  if(!persisted){
    toast("الحفظ الدائم غير متاح في هذا المتصفح", true);
  }
  /* sync.js is the next deferred script; it waits for this before touching the network */
  window.__cfaAppReady = true;
  document.dispatchEvent(new Event("cfa:ready"));
})();
document.addEventListener("visibilitychange",()=>{ if(document.hidden && S){ flushSave(); } });
window.addEventListener("blur",()=>{ if(S){ flushSave(); } });
window.addEventListener("pagehide",()=>{ if(S){ flushSave(); } });

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
