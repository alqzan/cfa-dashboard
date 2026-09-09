"use strict";

const APP_VERSION = "7.10.0";

/* ---------- tiered storage: Claude window.storage -> localStorage -> memory ----------
   Same storage key as v5/v6 on purpose: this is what makes existing users' data load
   automatically under v7 with zero action from them. Never change this key. */
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
  if(versions.some(v=>!Number.isInteger(v) || v<1 || v>7)){
    return {ok:false, message:"نسخة البيانات غير مدعومة. استخدم ملف v6 أو v7."};
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
   weights are official ranges; kept from v6 unchanged — do not edit reading data here
   without the user's explicit request, existing installs already have their own copies
   of this in storage and only ever get additive migrations. */
const DEFAULT = {
  examDate:"2026-11-19", target:2.0, buffer:21, dailyLog:{}, reviews:{}, activeTimer:null,
  practice:{}, mocks:[], sessions:[], qGoal:2000, lastExport:null, celebrated:{}, planCfg:null, restDays:{},
  topics:[
   {id:"eth",ar:"الأخلاقيات والمعايير المهنية",en:"Ethics & Professional Standards",abbr:"ETH",wMin:10,wMax:15,r:[
     ["مراجعة مدونة الأخلاقيات والمعايير","Code & Standards Review",8],
     ["إرشادات المعايير I–VII (تطبيق معمّق)","Guidance for Standards I–VII",16],
     ["تطبيق المدونة والمعايير — دراسات حالة","Application of the Code: Level II",12]]},
   {id:"fsa",ar:"تحليل القوائم المالية",en:"Financial Statement Analysis",abbr:"FSA",wMin:10,wMax:15,r:[
     ["الاستثمارات بين الشركات","Intercorporate Investments",9],
     ["تعويضات الموظفين: ما بعد التوظيف والأسهم","Employee Compensation",8],
     ["العمليات متعددة الجنسيات","Multinational Operations",9],
     ["تحليل المؤسسات المالية","Analysis of Financial Institutions",8],
     ["تقييم جودة التقارير المالية","Evaluating Quality of Financial Reports",8],
     ["تكامل أساليب تحليل القوائم المالية","Integration of Financial Statement Analysis Techniques",6]]},
   {id:"eq",ar:"استثمارات الأسهم",en:"Equity Investments",abbr:"EI",wMin:10,wMax:15,r:[
     ["تقييم الأسهم: التطبيقات والعمليات","Valuation: Applications & Processes",5],
     ["نموذج خصم التوزيعات","Discounted Dividend Valuation",9],
     ["تقييم التدفقات النقدية الحرة","Free Cash Flow Valuation",11],
     ["التقييم بالمضاعفات السوقية","Market-Based Valuation (Multiples)",9],
     ["تقييم الدخل المتبقي","Residual Income Valuation",7],
     ["تقييم الشركات الخاصة","Private Company Valuation",7]]},
   {id:"fi",ar:"الدخل الثابت",en:"Fixed Income",abbr:"FI",wMin:10,wMax:15,r:[
     ["هيكل الأجل وديناميكيات أسعار الفائدة","Term Structure & Rate Dynamics",9],
     ["إطار التقييم الخالي من المراجحة","Arbitrage-Free Valuation",8],
     ["تقييم السندات ذات الخيارات المضمّنة","Bonds with Embedded Options",11],
     ["نماذج تحليل الائتمان","Credit Analysis Models",8],
     ["مقايضات التخلف الائتماني (CDS)","Credit Default Swaps",6]]},
   {id:"pm",ar:"إدارة المحافظ",en:"Portfolio Management",abbr:"PM",wMin:10,wMax:15,r:[
     ["الاقتصاد وأسواق الاستثمار","Economics & Investment Markets",6],
     ["تحليل الإدارة النشطة للمحافظ","Active Portfolio Management",7],
     ["صناديق المؤشرات المتداولة (ETF)","ETF Mechanics & Applications",5],
     ["استخدام النماذج متعددة العوامل","Using Multifactor Models",7],
     ["قياس وإدارة مخاطر السوق","Measuring & Managing Market Risk",7],
     ["الاختبار الخلفي والمحاكاة","Backtesting & Simulation",6]]},
   {id:"qm",ar:"الأساليب الكمية",en:"Quantitative Methods",abbr:"QM",wMin:5,wMax:10,r:[
     ["أساسيات الانحدار المتعدد","Basics of Multiple Regression",4],
     ["تقييم ملاءمة نموذج الانحدار","Evaluating Regression Fit",4],
     ["سوء توصيف النموذج","Model Misspecification",3],
     ["امتدادات الانحدار المتعدد","Extensions of Multiple Regression",4],
     ["تحليل السلاسل الزمنية","Time-Series Analysis",5],
     ["تعلّم الآلة","Machine Learning",3],
     ["مشاريع البيانات الضخمة","Big Data Projects",3]]},
   {id:"eco",ar:"الاقتصاد",en:"Economics",abbr:"ECO",wMin:5,wMax:10,r:[
     ["أسعار صرف العملات: قيمة التوازن","Currency Exchange Rates",8],
     ["النمو الاقتصادي","Economic Growth",6]]},
   {id:"ci",ar:"مُصدِرو الشركات",en:"Corporate Issuers",abbr:"CI",wMin:5,wMax:10,r:[
     ["تحليل التوزيعات وإعادة شراء الأسهم","Dividends & Share Repurchases",7],
     ["اعتبارات ESG في تحليل الاستثمار","ESG Considerations",4],
     ["تكلفة رأس المال: مواضيع متقدمة","Cost of Capital: Advanced",5],
     ["إعادة هيكلة الشركات","Corporate Restructuring",6]]},
   {id:"der",ar:"المشتقات",en:"Derivatives",abbr:"DER",wMin:5,wMax:10,r:[
     ["تسعير وتقييم الالتزامات الآجلة","Pricing Forward Commitments",12],
     ["تقييم المطالبات الاحتمالية (الخيارات)","Valuation of Contingent Claims",13]]},
   {id:"ai",ar:"الاستثمارات البديلة",en:"Alternative Investments",abbr:"AI",wMin:5,wMax:10,r:[
     ["السلع ومشتقات السلع","Commodities & Commodity Derivatives",6],
     ["أنواع الاستثمار العقاري","Types of Real Estate Investment",6],
     ["الاستثمار العقاري عبر الأوراق المتداولة","Publicly Traded Real Estate",5],
     ["استراتيجيات صناديق التحوّط","Hedge Fund Strategies",5]]}
  ]
};

/* ---------- v6 sub-object shapes (unused by the v7 UI, kept only so migrate() stays
   byte-for-byte compatible with v1..v6 installs and nothing in storage is ever dropped) ---------- */
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
    t.r = t.r.map((x,i)=>({id:t.id+"-"+i, ar:x[0], en:x[1], hrs:x[2], status:"todo", mastery:"none", qMastery:"none", note:"", qNote:"", spent:0}));
  });
  s.v = 1;
  return migrate(s);
}
function migrate(o){
  const previousVersion = o.v||1;
  o.v = 7;
  if(!o.restDays) o.restDays = {};
  if(!o.reviews) o.reviews = {};
  if(o.activeTimer === undefined) o.activeTimer = null;
  if(!o.practice) o.practice = {};
  if(!o.mocks) o.mocks = [];
  if(!o.sessions) o.sessions = [];
  if(!o.qGoal) o.qGoal = 2000;
  if(o.lastExport === undefined) o.lastExport = null;
  if(!o.celebrated) o.celebrated = {};
  if(o.planCfg === undefined) o.planCfg = null;
  if(o.activeTimer && o.activeTimer.accum == null){ o.activeTimer.accum = 0; o.activeTimer.pausedAt = null; }
  if(o.activeTimer && !o.activeTimer.dayKey) o.activeTimer.dayKey = dateKeyInRiyadh(new Date(o.activeTimer.start));
  o.topics.forEach(t=>{
    if(t.weight == null) t.weight = (t.wMin+t.wMax)/2;
    t.r.forEach(r=>{
      if(r.note == null) r.note = "";
      if(r.qNote == null) r.qNote = "";
      if(r.spent == null) r.spent = 0;
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
          hrs:6,
          status:"todo",
          mastery:"none",
          note:"",
          spent:0
        });
      }
    }
  }
  if(previousVersion<6){
    /* v5 -> v6 (CFA Personal Coach): purely additive — nothing below removes or renames
       any existing id, hours, note, review, mock, session, dailyLog or setting.
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
        if(r.readingPractice===undefined) r.readingPractice = []; /* Reading-level question-bank entries */
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
    /* legacy topic-level practice entries stay exactly as-is and keep counting in every total;
       they are additionally indexed as read-only "legacy" rows so new reading-level stats
       can report on them without double-counting or discarding history. */
    if(!o.practiceLegacyIndexed){
      const legacy=[];
      for(const day in o.practice){
        for(const topicId in o.practice[day]){
          const e=o.practice[day][topicId];
          legacy.push({day:day, topicId:topicId, a:e.a, c:e.c, legacy:true});
        }
      }
      o.practiceLegacyIndexed = legacy.length; /* marker only, source of truth stays o.practice */
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
  if(previousVersion<7){
    /* v6 -> v7 (Simple CFA Study Tracker): purely additive, same rule as every migration
       before it — nothing below removes or renames any existing field. v7 only reads the
       old v6 reading-level question log (readingPractice[]) once to seed two new, simple
       cumulative counters (qSolved/qCorrect) that the v7 UI edits directly. The original
       readingPractice[] entries are left exactly as they were: still in storage, still
       intact, just no longer shown by the simplified UI. */
    o.schemaVersion = 7;
    o.topics.forEach(t=>{
      t.r.forEach(r=>{
        if(r.qGoal===undefined) r.qGoal = null; /* optional per-reading question-count goal */
        if(r.qSolved===undefined || r.qCorrect===undefined){
          let a=0,c=0;
          (r.readingPractice||[]).forEach(p=>{ a+=p.total||0; c+=p.correct||0; });
          if(r.qSolved===undefined) r.qSolved = a;
          if(r.qCorrect===undefined) r.qCorrect = c;
        }
      });
    });
  }
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
function armConfirm(btn, fn){
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
  btn.textContent="تأكيد الاستبدال؟"; btn.classList.add("armed");
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
  $("#progressPctVal").textContent = Math.round(R.pct);
  $("#progressBar").style.width = R.pct+"%";
  $("#readingsDoneVal").textContent = R.doneCount;
  $("#readingsTotalVal").textContent = R.total;
}

/* ---------- finalize any timer left dangling from before the manual timer was removed ----------
   v7.2 and earlier had a start/stop study timer that wrote to dailyLog/sessions/r.spent.
   That UI is gone, so on load we just settle whatever was mid-flight into those same
   fields (never shown anymore, but nothing already recorded there is discarded) and clear it. */
function finalizeDanglingTimer(){
  const a=S.activeTimer; if(!a) return;
  const base=a.accum||0;
  const secs=Math.min(a.pausedAt ? base : base+Math.floor((Date.now()-a.start)/1000), 4*3600);
  if(secs>=30){
    const hrs=secs/3600;
    const dk=a.dayKey||todayKey();
    S.dailyLog[dk]=(S.dailyLog[dk]||0)+hrs;
    const f=a.readingId?findReading(a.readingId):null;
    if(f) f.r.spent=(f.r.spent||0)+hrs;
    S.sessions.push({d:dk, m:Math.round(secs/60), id:a.readingId||null, h:null});
  }
  S.activeTimer=null;
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
function hoursText(n){
  const v=fmt(n);
  if(v==="1") return "ساعة واحدة";
  if(v==="2") return "ساعتان";
  return v+((n>=3 && n<=10) ? " ساعات" : " ساعة");
}
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
  const L=[];
  L.push((prefix||"")+"القراءة"+(r.readingNo==null?"":" رقم "+r.readingNo)+": "+title);
  if(r.ar && r.en) L.push("الاسم بالعربي: "+r.ar);
  L.push("الحالة: "+(STAT[r.status]||r.status));
  if(r.hrs) L.push("الوقت التقديري: "+hoursText(r.hrs));
  L.push("");
  L.push("تقييم فهمي للقراءة: "+rateText(r.mastery));
  L.push("ملاحظات القراءة:");
  L.push(noteText(r.note));
  L.push("");
  L.push("تقييم حلّي للأسئلة: "+rateText(r.qMastery));
  L.push("ملاحظات الأسئلة:");
  L.push(noteText(r.qNote));
  if(r.qSolved){
    const acc=Math.round((r.qCorrect||0)/r.qSolved*100);
    L.push("");
    L.push("الأسئلة المحلولة: "+r.qSolved+" — صحيحة: "+(r.qCorrect||0)+" ("+acc+"٪)"+(r.qGoal?" — الهدف: "+r.qGoal:""));
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
    "نسخ حالة هذه القراءة كاملة (ملاحظاتي وتقييماتي) للصقها في ChatGPT",
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
  let solved=0, correct=0;
  allReadingsFlat().forEach(({r})=>{ solved+=r.qSolved||0; correct+=r.qCorrect||0; });
  return {solved, correct, pct: solved ? Math.round(correct/solved*100) : null};
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
  if(q.solved) L.push("إجمالي الأسئلة المحلولة: "+q.solved+" — صحيحة: "+q.correct+" ("+q.pct+"٪)");
  else L.push("إجمالي الأسئلة المحلولة: لم أسجّل أي أسئلة بعد");
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
    "نسخ كل تقدّمي كاملاً (كل الأقسام والقراءات والملاحظات والتقييمات والاختبارات) للصقه في ChatGPT",
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
  const hay=norm((r.en||"")+" "+(r.ar||"")+" "+(t.en||"")+" "+(t.ar||""));
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
        id:t.id+"-new-"+Date.now(), ar:"", en:"قراءة جديدة", hrs:null, status:"todo", mastery:"none", qMastery:"none",
        note:"", qNote:"", spent:0, topicId:t.id, readingNo:null, excludedFraction:0, excludedNote:"",
        stages:defaultStages(), sourceMap:defaultSourceMap(), pages:{mark:"",schweser:"",cfai:"",secretSauce:""},
        brief:defaultBrief(), readingPractice:[], closeout:{status:"open",closedAt:null},
        qGoal:null, qSolved:0, qCorrect:0
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
  finalizeDanglingTimer();
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
