"use strict";

/* ---------- tiered storage: Claude window.storage -> localStorage -> memory ---------- */
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

/* ---------- weekly local snapshots (independent of the live save, kept for restore) ---------- */
const BACKUP_KEY = "cfa_l2_dash_v1_backups";
const BACKUP_INTERVAL_MS = 7*24*3600*1000;
const BACKUP_MAX = 8;
function loadBackups(){
  try{ const raw = localStorage.getItem(BACKUP_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  return [];
}
function saveBackups(list){
  try{ localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); }catch(e){}
}
function maybeAutoBackup(){
  const list = loadBackups();
  const last = list.length ? list[list.length-1].ts : 0;
  if(Date.now()-last < BACKUP_INTERVAL_MS) return;
  list.push({ ts: Date.now(), data: JSON.parse(JSON.stringify(S)) });
  while(list.length > BACKUP_MAX) list.shift();
  saveBackups(list);
}

/* ---------- default curriculum (2026, 45 modules) ----------
   weights are official ranges; mid-points sum to 100, used for weighting */
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

/* ---------- build / load / migrate state ---------- */
function fresh(){
  const s = JSON.parse(JSON.stringify(DEFAULT));
  s.v = 5;
  s.topics.forEach(t=>{
    t.weight = (t.wMin+t.wMax)/2;
    t.r = t.r.map((x,i)=>({id:t.id+"-"+i, ar:x[0], en:x[1], hrs:x[2], status:"todo", mastery:"none", note:"", spent:0}));
  });
  return s;
}
function migrate(o){
  const previousVersion = o.v||1;
  o.v = 5;
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
    t.r.forEach(r=>{ if(r.note == null) r.note = ""; if(r.spent == null) r.spent = 0; });
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
  return o;
}
let S = null;

let saveT = null;
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(async ()=>{ const ok = await store.write(S); if(ok) flashSaved(); syncPush(); }, 350);
}

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const ESCMAP = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
const esc = v => String(v==null?"":v).replace(/[&<>"']/g, c=>ESCMAP[c]);
function scrollTo_(el){ if(el && typeof el.scrollIntoView === "function") el.scrollIntoView({behavior:"smooth",block:"center"}); }
/* normalises Arabic (hamza/alef/ta-marbuta/tashkeel) so search matches how people actually type */
function norm(v){
  return String(v==null?"":v).toLowerCase()
    .replace(/[\u064B-\u0652\u0640\u0670]/g,"")
    .replace(/[\u0623\u0625\u0622\u0671]/g,"\u0627")
    .replace(/\u0649/g,"\u064A").replace(/\u0629/g,"\u0647");
}
function hourInRiyadh(d){
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:RIYADH_TZ,hour:"2-digit",hourCycle:"h23"}).formatToParts(d||new Date());
  const h=Number((p.find(x=>x.type==="hour")||{}).value);
  return isNaN(h)?null:(h%24);
}
const fmt = n => (Math.round(n*10)/10).toString();
const dayMs = 86400000;
const RIYADH_TZ = "Asia/Riyadh";
const pad2 = n=>String(n).padStart(2,"0");
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
function fmtDM(x){ const [,m,d]=keyOf(x).split("-"); return d+"/"+m; }
function addDays(n){ return shiftDateKey(todayKey(),n); }
const MAST = {none:"—",weak:"ضعيف",mid:"متوسط",strong:"قوي"};
const STAT = {todo:"لم أبدأ",doing:"أذاكرها",done:"أنهيتها"};
const MCOL = {none:"var(--todo)",weak:"var(--weak)",mid:"var(--mid)",strong:"var(--strong)"};
const MSCORE = {none:0,weak:1,mid:2,strong:3};

/* progress: completed readings are full; active readings use actual timer hours */
function readingProgress(r){
  if(r.status==="done") return 1;
  if(r.status!=="doing" || !(r.hrs>0)) return 0;
  return Math.max(0,Math.min(.99,(r.spent||0)/r.hrs));
}
function topicHours(t){
  let total=0, done=0;
  t.r.forEach(r=>{ total+=r.hrs; done+=r.hrs*readingProgress(r); });
  return {total:total, done:done, frac: total? done/total : 0};
}
function topicMastery(t){ /* hours-weighted mastery 0..3, only over touched material */
  let w=0, s=0;
  t.r.forEach(r=>{ if(r.mastery!=="none"){ w+=r.hrs; s+=MSCORE[r.mastery]*r.hrs; } });
  return w? s/w : 0;
}
function totals(){
  let total=0, done=0, wpct=0;
  S.topics.forEach(t=>{ const h=topicHours(t); total+=h.total; done+=h.done; wpct += (t.weight/100)*h.frac; });
  return {total:total, done:done, left: total-done, pct: wpct*100};
}
function studyDaysLeft(){
  return Math.max(1, daysBetweenKeys(todayKey(), contentDeadline()));
}
function examDaysLeft(){
  return Math.max(0, daysBetweenKeys(todayKey(), S.examDate));
}
function contentDeadline(){
  return shiftDateKey(S.examDate,-S.buffer);
}
function avg7(){
  let s=0;
  for(let i=0;i<7;i++){ const k=shiftDateKey(todayKey(),-i); s+=S.dailyLog[k]||0; }
  return s/7;
}
function isRest(k){ return !!(S.restDays && S.restDays[k]); }
function currentStreak(){
  let k=todayKey(), st=0;
  if((S.dailyLog[k]||0)<S.target && !isRest(k)) k=shiftDateKey(k,-1);
  for(let i=0;i<400;i++){
    if((S.dailyLog[k]||0)>=S.target) st++;
    else if(isRest(k)){ /* planned rest: doesn't count, doesn't break */ }
    else break;
    k=shiftDateKey(k,-1);
  }
  return st;
}
function findReading(id){ for(const t of S.topics){ const r=t.r.find(x=>x.id===id); if(r) return {t:t,r:r}; } return null; }
function topicAcc(id){
  let a=0,c=0;
  for(const d in S.practice){ const e=S.practice[d][id]; if(e){ a+=e.a; c+=e.c; } }
  return a? {a:a,c:c,acc:c/a*100} : null;
}
function qbStats(){
  let a=0,c=0,a7=0;
  for(const d in S.practice){ for(const id in S.practice[d]){ a+=S.practice[d][id].a; c+=S.practice[d][id].c; } }
  for(let i=0;i<7;i++){ const k=shiftDateKey(todayKey(),-i);
    const day=S.practice[k]; if(day){ for(const id in day) a7+=day[id].a; } }
  return {a:a, c:c, acc:a?c/a*100:0, perDay:a7/7};
}

/* ---------- toasts (sandbox-safe: no alert/confirm) ---------- */
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
  toast._t=setTimeout(()=>{ p.classList.remove("show"); p.dataset.busy=""; },2000);
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
  btn.textContent="متأكد؟"; btn.classList.add("armed");
  setTimeout(()=>{ if(btn.dataset.arm==="1"){
    btn.dataset.arm="";
    btn.textContent=old;
    delete btn.dataset.oldText;
    btn.classList.remove("armed");
  } }, 2600);
}

/* ---------- render: hero + metrics + phase ---------- */
function renderHero(){
  const T=totals(), sdl=studyDaysLeft();
  const pace = T.left/sdl;
  $("#examDays").textContent = examDaysLeft();
  $("#paceVal").textContent = fmt(pace);
  $("#targetEcho").textContent = fmt(S.target);
  $("#mDays").textContent = sdl;
  $("#mDone").innerHTML = fmt(T.done)+'<small> سا</small>';
  $("#mLeft").innerHTML = fmt(T.left)+'<small> سا</small>';
  $("#mPct").innerHTML = Math.round(T.pct)+'<small>%</small>';
  $("#ovBar").style.width = T.pct+"%";
  $("#ovTxt").textContent = fmt(T.done)+" / "+fmt(T.total)+" ساعة";

  const chip=$("#statusChip"), txt=$("#statusTxt");
  chip.className="status-chip";
  let cls,label;
  if(pace<=S.target){ cls="sc-good"; label="في المسار — معدلك يكفي"; }
  else if(pace<=S.target*1.18){ cls="sc-warn"; label="ضيّق — قلّل الفاقد أو زِد قليلاً"; }
  else { cls="sc-bad"; label="متأخر — تحتاج وتيرة أعلى"; }
  chip.classList.add(cls); txt.textContent=label;
  renderPhase();
}
function renderPhase(){
  const sdl=studyDaysLeft(), buf=S.buffer, dl=contentDeadline(), exam=S.examDate;
  const total=Math.max(1, sdl+buf);
  const cw=Math.max(6, Math.round(sdl/total*100));
  const rw=Math.max(0, 100-cw);
  $("#phase").innerHTML =
    '<div class="ph-track">'+
      '<div class="ph-seg ph-c" style="flex:0 0 '+cw+'%">'+(cw>22?('دراسة المحتوى · '+sdl+' يوم'):(sdl+'ي'))+'</div>'+
      (buf>0?('<div class="ph-seg ph-r" style="flex:0 0 '+rw+'%">'+(rw>22?('مراجعة + محاكيات · '+buf+' يوم'):(buf+'ي'))+'</div>'):'')+
    '</div>'+
    '<div class="ph-cap"><span>اليوم <b>'+fmtDate(todayKey())+'</b></span><span>آخر يوم للمحتوى <b>'+fmtDate(dl)+'</b></span><span>الاختبار <b>'+fmtDate(exam)+'</b></span></div>';
}

/* ---------- render: readiness gauge ---------- */
function readyValueOf(r){
  const mastery=({none:0.6,weak:0.5,mid:0.8,strong:1.0})[r.mastery] ?? 0.6;
  return readingProgress(r)*mastery;
}
const clamp01=n=>Math.max(0,Math.min(1,n));
function readinessBreakdown(){
  let contentRaw=0, qbankRaw=0;
  S.topics.forEach(t=>{
    let h=0,r=0;
    t.r.forEach(x=>{ h+=x.hrs; r+=x.hrs*readyValueOf(x); });
    contentRaw+=(t.weight/100)*(h?r/h:0);

    const q=topicAcc(t.id);
    if(q){
      const accuracy=clamp01((q.acc-50)/25);
      const expected=Math.max(1,S.qGoal*(t.weight/100));
      const volume=Math.sqrt(clamp01(q.a/expected));
      qbankRaw+=(t.weight/100)*accuracy*volume;
    }
  });
  const recentMocks=S.mocks.slice().sort((a,b)=>a.date<b.date?-1:1).slice(-3);
  let mockRaw=0;
  if(recentMocks.length){
    const avg=recentMocks.reduce((sum,m)=>sum+m.score,0)/recentMocks.length;
    const accuracy=clamp01((avg-50)/25);
    const confidence=.5+.5*Math.min(1,recentMocks.length/3);
    mockRaw=accuracy*confidence;
  }
  const content=contentRaw*50, qbank=qbankRaw*30, mocks=mockRaw*20;
  return {content:content,qbank:qbank,mocks:mocks,total:content+qbank+mocks};
}
function overallReadiness(){
  return readinessBreakdown().total;
}
function renderReadiness(){
  const rb=readinessBreakdown(), v=Math.round(rb.total);
  $("#readyVal").textContent=String(v);
  $("#readyBreakdown").innerHTML=
    '<span class="ready-part">المحتوى <b>'+fmt(rb.content)+'/50</b></span>'+
    '<span class="ready-part">الأسئلة <b>'+fmt(rb.qbank)+'/30</b></span>'+
    '<span class="ready-part">المحاكيات <b>'+fmt(rb.mocks)+'/20</b></span>';
  const arc=$("#gaugeArc"); arc.style.strokeDashoffset=(100-v);
  let label,color;
  if(v<50){ label="بعيد — ركّز على التغطية أولاً"; color="var(--bad)"; }
  else if(v<65){ label="يتشكّل — استمر بثبات"; color="var(--mid)"; }
  else if(v<72){ label="قريب من العتبة"; color="var(--gold)"; }
  else { label="جاهز — حافظ على المستوى"; color="var(--strong)"; }
  arc.style.stroke=color;
  const band=$("#readyBand"); band.textContent=label; band.style.color=color; band.style.borderColor=color;
  if(v>=70) celebrate("ready70","عبرت عتبة الجاهزية ٧٠ 🏁");
  const f=0.70, ang=(180-180*f)*Math.PI/180, cx=60,cy=62,rI=44,rO=52;
  const mk=$("#gaugeMark");
  mk.setAttribute("x1",(cx+rI*Math.cos(ang)).toFixed(1)); mk.setAttribute("y1",(cy-rI*Math.sin(ang)).toFixed(1));
  mk.setAttribute("x2",(cx+rO*Math.cos(ang)).toFixed(1)); mk.setAttribute("y2",(cy-rO*Math.sin(ang)).toFixed(1));
}

/* ---------- coach insights ---------- */
function insights(){
  const out=[]; const T=totals(); const sdl=studyDaysLeft(); const pace=T.left/sdl; const a7=avg7(); const dl=contentDeadline();
  if(T.left>0.1){
    if(a7>0.05){
      const days=Math.ceil(T.left/a7); const proj=shiftDateKey(todayKey(),days); const diff=daysBetweenKeys(dl,proj);
      if(diff>2) out.push({s:"bad",t:"بمعدلك آخر ٧ أيام ("+fmt(a7)+" سا/يوم) تنهي المحتوى في <b>"+fmtDate(proj)+"</b> — بعد موعدك ("+fmtDate(dl)+") بـ "+diff+" يوم. ارفع المعدل إلى "+fmt(pace)+" سا/يوم أو قلّص أيام المراجعة."});
      else if(diff<-3) out.push({s:"good",t:"سابق للجدول: إنهاء المحتوى متوقع حوالي <b>"+fmtDate(proj)+"</b>، قبل موعدك بـ "+(-diff)+" يوم. وجّه الفائض لبنك الأسئلة."});
      else out.push({s:"good",t:"على الجدول: إنهاء المحتوى متوقع <b>"+fmtDate(proj)+"</b> مع بدء المراجعة "+fmtDate(dl)+". حافظ على الإيقاع."});
    } else {
      out.push({s:"warn",t:"لا ساعات مسجّلة آخر ٧ أيام. المطلوب من اليوم: <b>"+fmt(pace)+" سا/يوم</b> لإنهاء المحتوى قبل "+fmtDate(dl)+"."});
    }
  } else {
    out.push({s:"good",t:"المحتوى مكتمل ١٠٠٪ — الوزن كله الآن على المحاكيات والمراجعات المجدولة وبنك الأسئلة."});
  }
  const dang=S.topics.map(t=>({t:t,h:topicHours(t),m:topicMastery(t)}))
    .filter(x=>x.t.weight>=10 && x.m<1.5 && x.h.frac<0.9)
    .sort((a,b)=>(b.t.weight*(1-b.h.frac))-(a.t.weight*(1-a.h.frac)))[0];
  if(dang) out.push({s:"bad",t:"أخطر فجوة حالياً: <b>"+esc(dang.t.en||dang.t.ar)+"</b> — وزنه "+dang.t.wMin+"–"+dang.t.wMax+"٪ وتغطيتك "+Math.round(dang.h.frac*100)+"٪"+(dang.m>0?" بإتقان ضعيف":"")+". اجعله أول جلسة."});
  const due=dueReviews().length;
  if(due>0) out.push({s:"warn",t:"عليك <b>"+due+"</b> مراجعة مستحقة (~"+(due*12)+" دقيقة). المراجعة المتباعدة أرخص درجات تكسبها."});
  else {
    const soon=addDays(3); let up=0;
    Object.keys(S.reviews).forEach(id=>{ const rv=S.reviews[id];
      if(rv.next>todayKey() && rv.next<=soon){ const f=findReading(id); if(f&&f.r.status==="done") up++; } });
    if(up>0) out.push({s:"warn",t:"قادم عليك <b>"+up+"</b> مراجعات خلال ٣ أيام — احسبها ضمن ميزانية جلساتك."});
  }
  let worst=null;
  S.topics.forEach(t=>{ const q=topicAcc(t.id); if(q && q.a>=30 && q.acc<65){ if(!worst || q.acc<worst.q.acc) worst={t:t,q:q}; } });
  if(worst) out.push({s:"warn",t:"دقتك في <b>"+esc(worst.t.abbr)+"</b> عند "+Math.round(worst.q.acc)+"٪ على "+worst.q.a+" سؤال — تحت حد الأمان (٦٥٪ تقريباً). راجع القراءة قبل مزيد من الأسئلة."});
  const qs=qbStats();
  if(qs.a>0 && S.qGoal>0){
    const projQ=Math.round(qs.a + qs.perDay*examDaysLeft());
    if(projQ < S.qGoal*0.85) out.push({s:"warn",t:"بمعدل أسئلتك الحالي ستبلغ ~<b>"+projQ.toLocaleString("en")+"</b> سؤالاً بيوم الاختبار من هدفك ("+S.qGoal.toLocaleString("en")+") — ارفع الجرعة اليومية تدريجياً."});
  }
  if(S.mocks.length){
    const ms=S.mocks.slice().sort((a,b)=> a.date<b.date?-1:1); const last=ms[ms.length-1];
    if(ms.length>=2){
      const d=last.score-ms[ms.length-2].score;
      out.push({s:last.score>=70?"good":(d>=0?"warn":"bad"),t:"آخر اختبار تجريبي: <b>"+fmt(last.score)+"٪</b> ("+(d>=0?"+":"")+fmt(d)+" عن السابق). "+(last.score>=70?"فوق خط الأمان — ثبّت الأداء.":"الهدف: تجاوز ٧٠٪ بثبات قبل الاختبار بأسبوعين.")});
    } else {
      out.push({s:last.score>=70?"good":"warn",t:"أول اختبار تجريبي: <b>"+fmt(last.score)+"٪</b>. اختبار واحد أسبوعياً في مرحلة المراجعة يرسم منحناك الحقيقي."});
    }
  }
  const hasData = Object.keys(S.dailyLog).length>2 || S.mocks.length>0 || Object.keys(S.practice).length>0;
  if(hasData){
    const dexp = S.lastExport? Math.floor((Date.now()-S.lastExport)/dayMs) : null;
    if((dexp===null || dexp>=7) && out.length<5)
      out.push({s:"warn",t:(dexp===null?"لم تأخذ نسخة احتياطية بعد":"آخر نسخة احتياطية قبل "+dexp+" يوم")+" — «تصدير» أو «نسخ للحافظة» يستغرق ثواني ويحمي شهور تتبّعك."});
  }
  const st=currentStreak();
  if(st>=7 && out.length<5) out.push({s:"good",t:"سلسلة <b>"+st+"</b> يوم متتالٍ على الهدف — هذا الثبات هو الفارق الحقيقي في المحاولة الثانية."});
  return out.slice(0,5);
}
function renderInsights(){
  const host=$("#insList");
  host.innerHTML = insights().map(x=>'<div class="ins-item i-'+x.s+'"><i></i><span>'+x.t+'</span></div>').join("");
}

/* ---------- render: heatmap ---------- */
function renderHeat(){
  const wrap=$("#heat"); wrap.innerHTML="";
  const sorted=[...S.topics].sort((a,b)=> b.weight-a.weight);
  sorted.forEach(t=>{
    const h=topicHours(t), m=topicMastery(t), q=topicAcc(t.id);
    const high = t.weight>=10;
    let edge, fill;
    if(m===0){ edge=MCOL.none; fill=MCOL.none; }
    else if(m<1.5){ edge=MCOL.weak; fill=MCOL.weak; }
    else if(m<2.5){ edge=MCOL.mid; fill=MCOL.mid; }
    else { edge=MCOL.strong; fill=MCOL.strong; }
    const danger = high && h.frac<0.9 && (m===0 || m<1.5);
    const el=document.createElement("div");
    el.className="tile"+(danger?" danger":"");
    el.title = (t.en||t.ar)+" — "+fmt(h.done)+"/"+fmt(h.total)+" سا · إتقان: "+(m===0?"—":(m<1.5?"ضعيف":(m<2.5?"متوسط":"قوي")))+(q?(" · دقة الأسئلة: "+Math.round(q.acc)+"٪ ("+q.a+" سؤال)"):"");
    el.innerHTML=
      '<div class="fill" style="height:'+(h.frac*100)+'%;background:'+fill+'"></div>'+
      '<div class="topedge" style="background:'+edge+'"></div>'+
      '<div><div class="abbr">'+esc(t.abbr)+'</div><div class="wt">'+t.wMin+'–'+t.wMax+'%</div></div>'+
      '<div class="pct mono" style="color:'+(h.frac>0?edge:'var(--faint)')+'">'+Math.round(h.frac*100)+'%</div>';
    el.onclick=()=>{
      if(FILTER!=="all"){
        FILTER="all";
        document.querySelectorAll("#tabs .tab").forEach(x=>x.classList.toggle("on",x.dataset.f==="all"));
        renderTopics();
      }
      const node=document.getElementById("topic-"+t.id);
      if(node){ node.classList.add("open"); scrollTo_(node); syncExpandLabel(); }
    };
    wrap.appendChild(el);
  });
}

/* ---------- render: daily dots + streak ---------- */
function renderDaily(){
  const dots=$("#dots"); dots.innerHTML="";
  for(let i=13;i>=0;i--){
    const k=shiftDateKey(todayKey(),-i);
    const v=S.dailyLog[k]||0;
    const div=document.createElement("div");
    div.className="day"+(v>=S.target?" hit":v>0?" part":"");
    div.style.height=Math.min(34, 6+v*7)+"px";
    div.title=fmtDate(k)+" · "+fmt(v)+" ساعة";
    dots.appendChild(div);
  }
  $("#streakVal").textContent=currentStreak();
  const tv=S.dailyLog[todayKey()];
  if(tv!=null) $("#todayHrs").value=Math.round(tv*10)/10;
}

/* ---------- render: topics accordion ---------- */
let FILTER="all", QUERY="";
function passes(r,t){
  if(QUERY){ const hay=norm((r.en||"")+" "+(r.ar||"")+" "+(t.en||"")+" "+(t.ar||"")+" "+(t.abbr||"")); if(hay.indexOf(QUERY)===-1) return false; }
  if(FILTER==="all") return true;
  if(FILTER==="todo") return r.status!=="done";
  if(FILTER==="weak"){
    return r.mastery==="weak" || (r.status==="done" && r.mastery!=="strong" && r.mastery!=="none")
        || (t.weight>=10 && r.status!=="done");
  }
  return true;
}
function renderTopics(){
  const host=$("#topics");
  const open=new Set([...host.querySelectorAll(".topic.open")].map(n=>n.id));
  host.innerHTML="";
  S.topics.forEach(t=>{
    const rows=t.r.filter(r=>passes(r,t));
    if((FILTER!=="all"||QUERY) && rows.length===0) return;
    const h=topicHours(t);
    const top=document.createElement("div");
    top.className="topic"+(open.has("topic-"+t.id)||FILTER!=="all"||QUERY?" open":"");
    top.id="topic-"+t.id;
    top.innerHTML=
      '<div class="t-head">'+
        '<span class="t-chevron">◀</span>'+
        '<span class="t-name">'+esc(t.en||t.ar)+'<span>'+esc(t.abbr)+'</span></span>'+
        '<span class="t-weight mono">'+t.wMin+'–'+t.wMax+'%</span>'+
        '<div class="t-meta">'+
          '<span class="t-hrs mono">'+fmt(h.done)+'/'+fmt(h.total)+' سا</span>'+
          '<span class="t-mini"><i style="width:'+(h.frac*100)+'%"></i></span>'+
          '<span class="t-pct mono">'+Math.round(h.frac*100)+'%</span>'+
        '</div>'+
      '</div><div class="t-body"></div>';
    const body=top.querySelector(".t-body");
    rows.forEach(r=>body.appendChild(rowWrap(t,r)));
    const add=document.createElement("div");
    add.className="add-row";
    add.innerHTML='<button>+ إضافة قراءة لهذا الموضوع</button>';
    add.querySelector("button").onclick=()=>{
      t.r.push({id:t.id+"-"+Date.now(),en:"New reading",ar:"",hrs:5,status:"todo",mastery:"none",note:"",spent:0});
      save(); renderTopics(); renderAll(); };
    body.appendChild(add);
    top.querySelector(".t-head").onclick=e=>{ if(e.target.closest("input,select,button"))return;
      top.classList.toggle("open"); syncExpandLabel(); };
    host.appendChild(top);
  });
  updateCounts();
  syncExpandLabel();
}
function rowWrap(t,r){
  const w=document.createElement("div"); w.className="rwrap";
  const nw=document.createElement("div"); nw.className="notewrap";
  const ta=document.createElement("textarea");
  ta.placeholder="ملاحظاتك على هذه القراءة — معادلات، أخطاء متكررة، صفحات ترجع لها…";
  ta.value=r.note||"";
  const row=rowEl(t,r,()=>{
    nw.classList.toggle("open");
    if(nw.classList.contains("open")) ta.focus();
  });
  ta.oninput=()=>{ r.note=ta.value; save();
    const nb=row.querySelector(".r-nbtn"); if(nb) nb.classList.toggle("has", !!(r.note&&r.note.trim())); };
  ta.onblur=ta.oninput;
  nw.appendChild(ta);
  w.appendChild(row); w.appendChild(nw);
  return w;
}
function rowEl(t,r,onNote){
  const row=document.createElement("div");
  row.className="row"+(r.mastery!=="none"?" m-"+r.mastery:"")+(r.status==="done"?" s-done":"");
  row.dataset.rid=r.id;
  const subParts=[];
  if(r.spent>0.05) subParts.push("فعلي "+fmt(r.spent)+" سا");
  if(r.status==="doing") subParts.push("تقدّم محسوب "+Math.round(readingProgress(r)*100)+"٪");
  row.innerHTML=
    '<div class="r-name" data-edit>'+esc(r.en||r.ar)+(subParts.length?'<span>'+subParts.join(" · ")+'</span>':'')+'</div>'+
    '<div class="r-hrs"><input type="number" min="0" max="40" step="0.5" value="'+r.hrs+'" title="الساعات المقدّرة"><em>سا</em></div>';
  /* status select */
  const st=document.createElement("select");
  st.className = r.status==="doing"?"st-doing":r.status==="done"?"st-done":"";
  ["todo","doing","done"].forEach(v=>{ const o=document.createElement("option");o.value=v;o.textContent=STAT[v];if(v===r.status)o.selected=true;st.appendChild(o);});
  st.onchange=()=>{ r.status=st.value;
    if(r.status==="done"){ if(r.mastery==="none") r.mastery="mid"; initReview(r.id);
      if(t.r.length>1 && t.r.every(x=>x.status==="done")) celebrate("topic-"+t.id,"موضوع "+t.abbr+" مكتمل 🎉"); }
    else { removeReview(r.id); if(r.status==="todo") r.mastery="none"; }
    save(); renderTopics(); renderAll(); };
  row.appendChild(st);
  /* mastery select */
  const ms=document.createElement("select");
  ms.className = r.mastery!=="none"?"ms-"+r.mastery:"";
  [["none","الإتقان: —"],["weak","ضعيف"],["mid","متوسط"],["strong","قوي"]].forEach(([v,lab])=>{
    const o=document.createElement("option");o.value=v;o.textContent=lab;if(v===r.mastery)o.selected=true;ms.appendChild(o);});
  ms.onchange=()=>{ r.mastery=ms.value; save(); renderTopics(); renderAll(); };
  row.appendChild(ms);
  /* estimated hours */
  const hin=row.querySelector(".r-hrs input");
  hin.onchange=()=>{ r.hrs=Math.min(40,Math.max(0,parseFloat(hin.value)||0)); save(); renderTopics(); renderAll(); };
  /* notes toggle */
  const nb=document.createElement("button");
  nb.className="r-nbtn"+((r.note&&r.note.trim())?" has":""); nb.textContent="✎"; nb.title="ملاحظات";
  nb.onclick=onNote;
  row.appendChild(nb);
  /* delete (two-tap confirm) */
  const del=document.createElement("button");
  del.className="r-del"; del.innerHTML="×"; del.title="حذف";
  del.onclick=()=>armConfirm(del,()=>{
    const idx=t.r.indexOf(r), snap=JSON.parse(JSON.stringify(r)), rv=S.reviews[r.id];
    t.r=t.r.filter(x=>x.id!==r.id); removeReview(r.id); save(); renderTopics(); renderAll();
    offerUndo("حُذفت: "+(r.en||r.ar), ()=>{ t.r.splice(Math.max(0,idx),0,snap); if(rv) S.reviews[snap.id]=rv; save(); renderTopics(); renderAll(); });
  });
  row.appendChild(del);
  /* inline rename */
  const nm=row.querySelector("[data-edit]");
  nm.onclick=()=>{ if(nm.querySelector("input"))return;
    const inp=document.createElement("input"); inp.value=(r.en||r.ar); inp.dir="ltr"; nm.innerHTML=""; nm.appendChild(inp); inp.focus();
    const commit=()=>{ const val=inp.value.trim(); if(val){ r.en=val; } save(); renderTopics(); };
    inp.onblur=commit; inp.onkeydown=e=>{ if(e.key==="Enter")inp.blur(); }; };
  return row;
}

/* ---------- counts + labels ---------- */
function updateCounts(){
  let all=0,weak=0,todo=0;
  S.topics.forEach(t=>t.r.forEach(r=>{ all++;
    if(r.status!=="done")todo++;
    if(r.mastery==="weak"||(r.status==="done"&&r.mastery!=="strong"&&r.mastery!=="none")||(t.weight>=10&&r.status!=="done"))weak++;
  }));
  $("#cAll").textContent=all; $("#cWeak").textContent=weak; $("#cTodo").textContent=todo;
}
function syncExpandLabel(){
  const opened=document.querySelectorAll(".topic.open").length;
  const total=document.querySelectorAll(".topic").length;
  $("#expandAll").textContent = opened>=total&&total>0 ? "طيّ الكل" : "توسيع الكل";
}

/* ---------- performance: weekly hours / question bank / mocks ---------- */
let perfTab="hrs";
function renderPerf(){
  document.querySelectorAll("#ptabs button").forEach(b=>b.classList.toggle("on",b.dataset.p===perfTab));
  const host=$("#perfBody");
  if(perfTab==="hrs") renderHours(host);
  else if(perfTab==="qb") renderQB(host);
  else renderMocks(host);
}
function weeklyData(n){
  const res=[];
  const tk=todayKey(), [y,m,d]=tk.split("-").map(Number);
  const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const start=shiftDateKey(tk,-weekday); /* week starts Sunday */
  for(let i=n-1;i>=0;i--){
    const ws=shiftDateKey(start,-i*7); let sum=0;
    for(let d=0;d<7;d++){ const k=shiftDateKey(ws,d); sum+=S.dailyLog[k]||0; }
    res.push({ws:ws, hrs:sum});
  }
  return res;
}
function renderHours(host){
  const wk=weeklyData(10);
  let totalLogged=0; for(const k in S.dailyLog) totalLogged+=S.dailyLog[k];
  const best=Math.max.apply(null, wk.map(w=>w.hrs).concat([0]));
  const tgt=S.target*7;
  const maxY=Math.max(best, tgt, 1);
  const W=600,H=170,pad=26,bw=(W-pad*2)/wk.length;
  let bars="",labels="";
  wk.forEach((w,i)=>{
    const bh=(w.hrs/maxY)*(H-52);
    const x=pad+i*bw+bw*0.18, y=H-30-bh;
    const col=w.hrs>=tgt?"var(--strong)":(w.hrs>0?"var(--gold)":"#2a3a4c");
    bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.64).toFixed(1)+'" height="'+Math.max(2,bh).toFixed(1)+'" rx="3" fill="'+col+'"/>';
    if(w.hrs>0) bars+='<text x="'+(x+bw*0.32).toFixed(1)+'" y="'+(y-5).toFixed(1)+'" text-anchor="middle" font-size="9.5" fill="#9DABBD" font-family="JetBrains Mono, monospace">'+fmt(w.hrs)+'</text>';
    labels+='<text x="'+(x+bw*0.32).toFixed(1)+'" y="'+(H-14)+'" text-anchor="middle" font-size="9" fill="#677A8E" font-family="JetBrains Mono, monospace">'+fmtDM(w.ws)+'</text>';
  });
  const ty=H-30-(tgt/maxY)*(H-52);
  const target='<line x1="'+pad+'" y1="'+ty.toFixed(1)+'" x2="'+(W-pad)+'" y2="'+ty.toFixed(1)+'" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity=".7"/>'+
    '<text x="'+(W-pad)+'" y="'+(ty-5).toFixed(1)+'" text-anchor="end" font-size="9.5" fill="var(--gold)" font-family="JetBrains Mono, monospace">'+fmt(tgt)+'</text>';

  /* consistency calendar — last 26 weeks */
  const tnow=todayKey(), [tyr,tmo,tdy]=tnow.split("-").map(Number);
  const todayWeekday=new Date(Date.UTC(tyr,tmo-1,tdy)).getUTCDay();
  const CW=26, cs=13, cz=10;
  const wk0=shiftDateKey(tnow,-todayWeekday-(CW-1)*7);
  const lvl=v=>{ if(v<=0) return "#1e2b3a"; if(v<S.target*0.5) return "rgba(199,162,88,.4)"; if(v<S.target) return "var(--gold)"; if(v<S.target*1.75) return "var(--strong)"; return "#8fe0b0"; };
  let cal="", months="", pm=-1;
  for(let w2=0; w2<CW; w2++){
    const colDate=shiftDateKey(wk0,w2*7);
    const cm=Number(colDate.slice(5,7));
    if(cm!==pm){ pm=cm;
      months+='<text x="'+(6+w2*cs)+'" y="9" font-size="8.5" fill="#677A8E" font-family="JetBrains Mono, monospace">'+pad2(pm)+'</text>'; }
    for(let d2=0; d2<7; d2++){
      const key=shiftDateKey(wk0,w2*7+d2);
      if(key>tnow) continue;
      const v=S.dailyLog[key]||0;
      cal+='<rect x="'+(6+w2*cs)+'" y="'+(14+d2*cs)+'" width="'+cz+'" height="'+cz+'" rx="2.5" fill="'+lvl(v)+'"><title>'+fmtDate(key)+' · '+fmt(v)+' سا</title></rect>';
    }
  }

  /* cumulative vs target — last 70 days */
  const D=70, W3=600, H3=150, p3=30;
  let cum=0; const act=[];
  for(let i=D-1;i>=0;i--){ const k3=shiftDateKey(tnow,-i); cum+=S.dailyLog[k3]||0; act.push(cum); }
  const idealEnd=S.target*D, maxC=Math.max(cum, idealEnd, 1);
  const x3=i=>p3+i*((W3-p3*2)/(D-1)), y3=v=>H3-24-(v/maxC)*(H3-44);
  let apts=""; act.forEach((v,i)=>{ apts+=(i?" ":"")+x3(i).toFixed(1)+","+y3(v).toFixed(1); });
  const gap=idealEnd-cum;
  const gapTxt = gap>1 ? ("أنت خلف خط الهدف بـ "+fmt(gap)+" سا") : (gap<-1 ? ("أنت متقدّم على خط الهدف بـ "+fmt(-gap)+" سا") : "أنت ملاصق لخط الهدف");
  const burn='<div class="chart-wrap" dir="ltr"><svg viewBox="0 0 '+W3+' '+H3+'">'+
    '<line x1="'+x3(0).toFixed(1)+'" y1="'+y3(S.target).toFixed(1)+'" x2="'+x3(D-1).toFixed(1)+'" y2="'+y3(idealEnd).toFixed(1)+'" stroke="#677A8E" stroke-width="1.5" stroke-dasharray="5 5"/>'+
    '<polyline points="'+apts+'" fill="none" stroke="var(--gold)" stroke-width="2.2"/>'+
    '<text x="'+(W3-p3)+'" y="'+Math.max(12,(y3(cum)-7)).toFixed(1)+'" text-anchor="end" font-size="10" fill="var(--gold)" font-family="JetBrains Mono, monospace">'+fmt(cum)+' سا</text>'+
    '</svg></div>';

  const s7=S.sessions.filter(x=>x.d>=addDays(-6)).length;
  host.innerHTML=
   '<div class="stats">'+
     '<div class="stat"><div class="v mono">'+fmt(avg7())+'<small> سا/يوم</small></div><div class="k">متوسط آخر ٧ أيام</div></div>'+
     '<div class="stat"><div class="v mono">'+fmt(best)+'<small> سا</small></div><div class="k">أفضل أسبوع</div></div>'+
     '<div class="stat"><div class="v mono">'+fmt(totalLogged)+'<small> سا</small></div><div class="k">إجمالي الساعات</div></div>'+
     '<div class="stat"><div class="v mono">'+s7+'</div><div class="k">جلسات مؤقّت هذا الأسبوع</div></div>'+
   '</div>'+
   '<div class="chart-wrap" dir="ltr"><svg viewBox="0 0 '+W+' '+H+'">'+target+bars+labels+'</svg></div>'+
   '<p class="cal-cap">الخط المتقطّع = هدفك الأسبوعي ('+fmt(tgt)+' سا). الأعمدة الخضراء أسابيع حققت الهدف.</p>'+
   '<div class="chart-wrap" dir="ltr"><svg viewBox="0 0 352 108" style="max-width:560px;margin:auto">'+months+cal+'</svg></div>'+
   '<p class="cal-cap">سجلّ الالتزام — آخر ٢٦ أسبوعاً: كل مربّع يوم، والأخضر يوم حقّقت فيه هدفك أو تجاوزته.</p>'+
   burn+
   bestHoursBlock()+
   '<p class="cal-cap">تراكمي آخر ٧٠ يوماً: الذهبي ساعاتك الفعلية، والمتقطّع مسار هدفك اليومي — '+gapTxt+'.</p>';
}
function renderQB(host){
  const st=qbStats();
  let opts=""; S.topics.forEach(t=>{ opts+='<option value="'+esc(t.id)+'">'+esc(t.abbr)+' — '+esc(t.en||t.ar)+'</option>'; });
  const tk=todayKey(); const today=S.practice[tk]||{};
  let chips="";
  for(const id in today){
    const f=S.topics.find(t=>t.id===id); if(!f) continue;
    chips+='<span class="chip"><b>'+esc(f.abbr)+'</b>'+today[id].c+'/'+today[id].a+'<button data-x="'+esc(id)+'" title="حذف إدخال اليوم">×</button></span>';
  }
  let rows="";
  const sorted=[...S.topics].sort((a,b)=>b.weight-a.weight);
  sorted.forEach(t=>{
    const q=topicAcc(t.id);
    let bar="", num="—";
    if(q){
      const col=q.acc>=75?"var(--strong)":(q.acc>=65?"var(--mid)":"var(--weak)");
      bar='<i style="width:'+Math.min(100,q.acc).toFixed(0)+'%;background:'+col+'"></i>';
      num='<span style="color:'+col+'">'+Math.round(q.acc)+'٪</span> · '+q.c+'/'+q.a;
    }
    rows+='<div class="qa-row"><span class="qa-abbr">'+esc(t.abbr)+'</span><span class="qa-bar">'+bar+'</span><span class="qa-num mono">'+num+'</span></div>';
  });
  host.innerHTML=
   '<div class="frm">'+
     '<select id="qbTopic">'+opts+'</select>'+
     '<input class="num" id="qbA" type="number" min="1" max="500" placeholder="محلولة">'+
     '<input class="num" id="qbC" type="number" min="0" max="500" placeholder="صحيحة">'+
     '<button id="qbAdd">سجّل</button>'+
   '</div>'+
   (chips?('<div class="chips">'+chips+'</div>'):'')+
   '<div class="stats">'+
     '<div class="stat"><div class="v mono">'+st.a.toLocaleString("en")+'</div><div class="k">إجمالي الأسئلة المحلولة</div></div>'+
     '<div class="stat"><div class="v mono">'+(st.a?Math.round(st.acc):"—")+'<small>٪</small></div><div class="k">الدقة الكلية</div></div>'+
     '<div class="stat"><div class="v mono">'+fmt(st.perDay)+'</div><div class="k">سؤال/يوم (آخر ٧ أيام)</div></div>'+
   '</div>'+
   '<div style="margin:2px 0 12px"><div style="height:8px;background:#22303f;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:'+Math.min(100,st.a/Math.max(1,S.qGoal)*100).toFixed(1)+'%;background:var(--gold)"></i></div>'+
   '<div class="mono" style="display:flex;justify-content:space-between;gap:10px;color:var(--faint);font-size:11px;margin-top:5px"><span>'+st.a.toLocaleString("en")+' / '+S.qGoal.toLocaleString("en")+' سؤال (هدفك)</span><span>'+(st.perDay>0.1?('توقّع يوم الاختبار: ~'+Math.round(st.a+st.perDay*examDaysLeft()).toLocaleString("en")):'')+'</span></div></div>'+
   '<div>'+rows+'</div>'+
   '<p class="empty" style="margin-top:10px">هدف الأسئلة قابل للتعديل من الإعدادات أسفل الصفحة — القاعدة الشائعة بين المرشّحين نحو 2,000 سؤال قبل الاختبار بدقة ثابتة فوق ٧٠٪ في المواضيع ذات الوزن العالي.</p>';
  $("#qbAdd").onclick=()=>{
    const tid=$("#qbTopic").value, a=parseInt($("#qbA").value,10), c=parseInt($("#qbC").value,10);
    if(!(a>0) || isNaN(c) || c<0 || c>a){ toast("تحقّق من الأرقام: الصحيح ≤ المحاول", true); return; }
    const nk=todayKey();
    if(!S.practice[nk]) S.practice[nk]={};
    if(!S.practice[nk][tid]) S.practice[nk][tid]={a:0,c:0};
    S.practice[nk][tid].a+=a; S.practice[nk][tid].c+=c;
    save(); renderPerf(); renderReadiness(); renderInsights(); renderHeat();
  };
  host.querySelectorAll(".chip button").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.x;
      if(S.practice[tk]){ delete S.practice[tk][id]; if(Object.keys(S.practice[tk]).length===0) delete S.practice[tk]; }
      save(); renderPerf(); renderReadiness(); renderInsights(); renderHeat();
    };
  });
}
function renderMocks(host){
  const ms=S.mocks.slice().sort((a,b)=> a.date<b.date?-1:(a.date>b.date?1:0));
  let mstats="";
  if(ms.length){
    const l3=ms.slice(-3); const avg3=l3.reduce((s,m)=>s+m.score,0)/l3.length;
    const bestM=Math.max.apply(null, ms.map(m=>m.score));
    mstats='<div class="stats" style="margin:12px 0 2px">'+
      '<div class="stat"><div class="v mono">'+ms.length+'</div><div class="k">اختبارات مسجّلة</div></div>'+
      '<div class="stat"><div class="v mono">'+fmt(avg3)+'<small>٪</small></div><div class="k">متوسط آخر '+l3.length+'</div></div>'+
      '<div class="stat"><div class="v mono">'+fmt(bestM)+'<small>٪</small></div><div class="k">أفضل نتيجة</div></div>'+
    '</div>';
  }
  let chart="";
  if(ms.length){
    const view=ms.slice(-12);
    const W=600,H=190,pad=34;
    const xs=i=> view.length>1 ? pad+i*((W-pad*2)/(view.length-1)) : W/2;
    const ys=v=> H-28-(v/100)*(H-52);
    let grid="";
    [50,60,70,80,90].forEach(g=>{
      const y=ys(g).toFixed(1);
      const main=(g===70);
      grid+='<line x1="'+pad+'" y1="'+y+'" x2="'+(W-pad)+'" y2="'+y+'" stroke="'+(main?"var(--gold)":"#243244")+'" stroke-width="1"'+(main?' stroke-dasharray="5 4"':'')+'/>'+
            '<text x="'+(pad-6)+'" y="'+(parseFloat(y)+3).toFixed(1)+'" text-anchor="end" font-size="9" fill="'+(main?"var(--gold)":"#677A8E")+'" font-family="JetBrains Mono, monospace">'+g+'</text>';
    });
    let line="",dots="",xl=""; const pts=[];
    view.forEach((m,i)=>{
      const x=xs(i), y=ys(m.score);
      pts.push(x.toFixed(1)+","+y.toFixed(1));
      const col=m.score>=70?"var(--strong)":(m.score>=60?"var(--mid)":"var(--weak)");
      dots+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4" fill="'+col+'"/>'+
            '<text x="'+x.toFixed(1)+'" y="'+(y-8).toFixed(1)+'" text-anchor="middle" font-size="9.5" fill="#ECE9E1" font-family="JetBrains Mono, monospace">'+fmt(m.score)+'</text>';
      xl+='<text x="'+x.toFixed(1)+'" y="'+(H-10)+'" text-anchor="middle" font-size="8.5" fill="#677A8E" font-family="JetBrains Mono, monospace">'+fmtDM(m.date)+'</text>';
    });
    if(view.length>1) line='<polyline points="'+pts.join(" ")+'" fill="none" stroke="var(--gold)" stroke-width="2" opacity=".85"/>';
    chart='<div class="chart-wrap" dir="ltr"><svg viewBox="0 0 '+W+' '+H+'">'+grid+line+dots+xl+'</svg></div>';
  }
  let list="";
  ms.slice().reverse().forEach(m=>{
    const col=m.score>=70?"var(--strong)":(m.score>=60?"var(--mid)":"var(--weak)");
    list+='<div class="mk-row"><span class="mk-date">'+fmtDate(m.date)+'</span><span class="mk-name">'+esc(m.name||"اختبار تجريبي")+'</span>'+
      (m.note?('<span class="mk-note">'+esc(m.note)+'</span>'):'')+
      '<span class="mk-score" style="color:'+col+';border-color:'+col+'">'+fmt(m.score)+'٪</span>'+
      '<button class="r-del" data-x="'+m.id+'" title="حذف">×</button></div>';
  });
  host.innerHTML=
    '<div class="frm">'+
      '<input type="date" id="mkDate" value="'+todayKey()+'">'+
      '<input id="mkName" type="text" placeholder="المصدر (CFAI, Kaplan…)" style="width:170px">'+
      '<input class="num" id="mkScore" type="number" min="0" max="100" step="0.5" placeholder="٪">'+
      '<input id="mkNote" type="text" placeholder="ملاحظة (اختياري)" style="flex:1;min-width:140px">'+
      '<button id="mkAdd">أضِف</button>'+
    '</div>'+
    mstats+
    (chart||'<p class="empty">سجّل أول اختبار تجريبي — الخط الذهبي عند ٧٠٪ مرجع أمان تقريبي، وتجاوزه بثبات هو مؤشر الجاهزية الحقيقي.</p>')+
    '<div style="margin-top:12px">'+list+'</div>';
  $("#mkAdd").onclick=()=>{
    const d=$("#mkDate").value, n=$("#mkName").value.trim(), sc=parseFloat($("#mkScore").value), note=$("#mkNote").value.trim();
    if(!d || isNaN(sc) || sc<0 || sc>100){ toast("أدخل تاريخاً ونتيجة بين 0 و100", true); return; }
    const firstOver = sc>=70 && !S.mocks.some(m=>m.score>=70);
    S.mocks.push({id:String(Date.now()), date:d, name:n, score:sc, note:note});
    if(firstOver) celebrate("first-mock-70","أول تجريبي فوق ٧٠٪ — استمر ✨");
    save(); renderPerf(); renderReadiness(); renderInsights();
  };
  host.querySelectorAll(".mk-row .r-del").forEach(b=>{
    b.onclick=()=>armConfirm(b,()=>{
      const snap=S.mocks.find(x=>x.id===b.dataset.x);
      S.mocks=S.mocks.filter(x=>x.id!==b.dataset.x); save(); renderPerf(); renderReadiness(); renderInsights();
      if(snap) offerUndo("حُذف اختبار تجريبي "+fmt(snap.score)+"٪", ()=>{ S.mocks.push(snap); save(); renderPerf(); renderReadiness(); renderInsights(); });
    });
  });
}

/* ---------- spaced review (7/21/45/90) ---------- */
const RIVL=[7,21,45,90];
function initReview(id){ if(!S.reviews[id]) S.reviews[id]={next:addDays(RIVL[0]),stage:0}; }
function removeReview(id){ delete S.reviews[id]; }
function reviewed(id){ const rv=S.reviews[id]; if(!rv)return; rv.stage=Math.min(rv.stage+1,RIVL.length-1); rv.next=addDays(RIVL[rv.stage]); save(); renderAll(); }
function dueReviews(){
  const tk=todayKey(), out=[];
  Object.keys(S.reviews).forEach(id=>{
    const rv=S.reviews[id];
    if(rv.next<=tk){
      const f=findReading(id);
      if(f&&f.r.status==="done") out.push(f); else if(!f) delete S.reviews[id];
    }
  });
  return out.sort((a,b)=>b.t.weight-a.t.weight);
}

/* ---------- today's plan ---------- */
function ensurePlanCfg(){
  const tk=todayKey();
  if(!S.planCfg || S.planCfg.date!==tk) S.planCfg={date:tk, excl:[], added:[]};
  return S.planCfg;
}
function priorityOf(r,t){
  const mf=({none:1.0,weak:1.4,mid:0.7,strong:0.3})[r.mastery] ?? 1.0;
  const sf=(r.status==="doing")?1.15:1.0;
  return t.weight*mf*sf;
}
function todaysPlan(){
  const cfg=ensurePlanCfg();
  const blocks=[]; let budget=S.target*60;
  const due=dueReviews().filter(d=>cfg.excl.indexOf(d.r.id)===-1);
  let rb=Math.min(budget*0.4, due.length*12);
  due.forEach(d=>{ if(rb<10)return; blocks.push({type:"review",t:d.t,r:d.r,min:12}); rb-=12; budget-=12; });
  cfg.added.forEach(a=>{
    const f=findReading(a.rid); if(!f || f.r.status==="done") return;
    blocks.push({type:"pick",t:f.t,r:f.r,min:a.min});
    budget=Math.max(0, budget-a.min);
  });
  const cand=[];
  S.topics.forEach(t=>t.r.forEach(r=>{ if(r.status!=="done" && cfg.excl.indexOf(r.id)===-1 && !cfg.added.some(a=>a.rid===r.id)) cand.push({t:t,r:r,p:priorityOf(r,t)}); }));
  cand.sort((a,b)=>b.p-a.p);
  const blockMin=c=>{ const remHrs=c.r.hrs*(1-readingProgress(c.r));
    return Math.round(Math.min(budget, Math.min(55, Math.max(25, remHrs*60)))); };
  const usedTopic={}; blocks.forEach(b=>{ if(b.type==="pick") usedTopic[b.t.id]=1; });
  let last=null, nStudy=0;
  for(const c of cand){ if(budget<20 || nStudy>=3) break;
    if(usedTopic[c.t.id]) continue;
    const m=blockMin(c); last={type:"study",t:c.t,r:c.r,min:m};
    blocks.push(last); usedTopic[c.t.id]=1; nStudy++; budget-=m; }
  for(const c of cand){ if(budget<25 || nStudy>=4) break;
    if(blocks.some(b=>b.r && b.r.id===c.r.id)) continue;
    const m=blockMin(c); last={type:"study",t:c.t,r:c.r,min:m};
    blocks.push(last); nStudy++; budget-=m; }
  if(budget>5 && last) last.min+=Math.round(budget);
  return blocks;
}
function renderToday(){
  const cfg=ensurePlanCfg();
  $("#planBudget").textContent="~"+fmt(S.target)+"سا";
  const blocks=todaysPlan(), host=$("#planList"); host.innerHTML="";
  if(blocks.length===0){
    host.innerHTML='<div class="plan-empty">كل المحتوى مكتمل ولا توجد مراجعات مستحقة اليوم. الوقت الآن للمحاكيات وإعادة حل بنوك الأسئلة — شغّل المؤقّت وسجّل نتائجك في قسم «الأداء».</div>';
  } else {
    blocks.forEach(b=>{
      const div=document.createElement("div"); div.className="block";
      const name=esc(b.r.en||b.r.ar);
      const tag=b.type==="review"?'<span class="tag tag-review">مراجعة</span>':(b.type==="pick"?'<span class="tag tag-pick">اختيارك</span>':'<span class="tag tag-study">دراسة</span>');
      div.innerHTML=tag+'<span class="b-name">'+name+'<i>'+esc(b.t.abbr)+'</i></span><span class="b-min mono">~'+b.min+'د</span>';
      div.title= b.type==="pick" ? "جلسة اخترتها بنفسك" : ("الأولوية من وزن الموضوع "+b.t.wMin+"–"+b.t.wMax+"٪"+(b.r.mastery && b.r.mastery!=="none" ? " · إتقانك الحالي: "+MAST[b.r.mastery] : ""));
      const start=document.createElement("button"); start.className="b-act"; start.textContent="ابدأ"; start.onclick=()=>startTimer(b.r.id);
      div.appendChild(start);
      if(b.type==="review"){ const rv=document.createElement("button"); rv.className="b-act done"; rv.textContent="راجعت ✓"; rv.onclick=()=>reviewed(b.r.id); div.appendChild(rv); }
      const x=document.createElement("button"); x.className="r-del"; x.textContent="×"; x.title="استبعاد من خطة اليوم";
      x.onclick=()=>{ if(b.type==="pick"){ cfg.added=cfg.added.filter(a=>a.rid!==b.r.id); } else { cfg.excl.push(b.r.id); } save(); renderToday(); };
      div.appendChild(x);
      host.appendChild(div);
    });
  }
  if(cfg.excl.length){
    const res=document.createElement("a"); res.href="#"; res.className="pb-restore";
    res.textContent="استرجاع المقترحات المستبعدة ("+cfg.excl.length+")";
    res.onclick=e=>{ e.preventDefault(); cfg.excl=[]; save(); renderToday(); };
    host.appendChild(res);
  }
  let og="";
  S.topics.forEach(t=>{
    const rs=t.r.filter(r=>r.status!=="done" && !cfg.added.some(a=>a.rid===r.id));
    if(!rs.length) return;
    og+='<optgroup label="'+esc(t.abbr)+'">'+rs.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.en||r.ar)+'</option>').join("")+'</optgroup>';
  });
  if(og){
    const build=document.createElement("div"); build.className="plan-build";
    build.innerHTML='<button class="pb-toggle" id="pbToggle">+ أضف جلسة على كيفك</button>'+
      '<div class="frm pb-frm" id="pbFrm" hidden>'+
        '<select id="pbSel">'+og+'</select>'+
        '<input class="num" id="pbMin" type="number" min="15" max="120" step="5" value="30" title="الدقائق">'+
        '<button id="pbAdd">أضِف للخطة</button>'+
      '</div>';
    host.appendChild(build);
    build.querySelector("#pbToggle").onclick=()=>{ const f=build.querySelector("#pbFrm"); f.hidden=!f.hidden; };
    build.querySelector("#pbAdd").onclick=()=>{
      const rid=build.querySelector("#pbSel").value;
      let mn=parseInt(build.querySelector("#pbMin").value,10); if(isNaN(mn)) mn=30; mn=Math.max(15,Math.min(120,mn));
      if(!rid) return;
      if(cfg.added.some(a=>a.rid===rid)){ toast("القراءة موجودة في خطتك", true); return; }
      cfg.added.push({rid:rid, min:mn}); save(); renderToday();
    };
  }
  updateTimerUI();
}

/* ---------- focus timer (auto-logs into today's hours + actual time per reading) ---------- */
let timerInt=null, breakShown=false;
function fmtClock(s){ const m=Math.floor(s/60); return String(m).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
function timerSec(){
  const a=S.activeTimer; if(!a) return 0;
  const live = a.pausedAt ? 0 : (Date.now()-a.start);
  return Math.floor(((a.accum||0)+live)/1000);
}
function updateTimerUI(){
  const disp=$("#timerDisp"), btn=$("#timerBtn"), foc=$("#timerFocus"), pb=$("#pauseBtn");
  if(S.activeTimer){
    const a=S.activeTimer, s=timerSec();
    disp.textContent=fmtClock(s); disp.classList.add("run");
    btn.textContent="⏹ إيقاف وتسجيل"; btn.classList.add("stop");
    pb.hidden=false; pb.textContent = a.pausedAt ? "▶ استئناف" : "⏸ إيقاف مؤقت";
    let nm=""; if(a.readingId){ const f=findReading(a.readingId); if(f)nm=(f.r.en||f.r.ar); }
    foc.innerHTML=(nm?('تركيز على: <b>'+esc(nm)+'</b>'):'جلسة حرّة — تُسجّل في ساعات اليوم')
      +(a.pausedAt?' · <b style="color:var(--dim)">موقّف مؤقتاً</b>':'')
      +((s>=3000)?' · <b style="color:var(--warn)">مرّت ٥٠ دقيقة — خذ استراحة ٥ دقائق</b>':'');
    if(!timerInt) timerInt=setInterval(()=>{
      const sec=timerSec();
      $("#timerDisp").textContent=fmtClock(sec);
      if(sec>=3000 && !breakShown){ breakShown=true; updateTimerUI(); }
    },1000);
  } else {
    disp.textContent="00:00"; disp.classList.remove("run");
    btn.textContent="▶ ابدأ جلسة"; btn.classList.remove("stop"); foc.textContent=""; pb.hidden=true;
    if(timerInt){ clearInterval(timerInt); timerInt=null; }
  }
}
function startTimer(readingId){
  if(S.activeTimer) stopTimer(true);
  breakShown=false;
  S.activeTimer={start:Date.now(), readingId:readingId||null, accum:0, pausedAt:null, dayKey:todayKey()};
  if(readingId){ const f=findReading(readingId); if(f&&f.r.status==="todo") f.r.status="doing"; }
  save(); renderTopics(); renderAll();
  scrollTo_(document.querySelector(".today"));
}
function stopTimer(silent){
  if(!S.activeTimer)return;
  const sec=timerSec(); let hrs=sec/3600;
  if(hrs>10){ hrs=10; toast("جلسة أطول من ١٠ ساعات؟ سُجّلت ١٠ — عدّلها يدوياً إن لزم", true); }
  const k=S.activeTimer.dayKey||todayKey();
  if(sec>=30){
    S.dailyLog[k]=(S.dailyLog[k]||0)+hrs;
    if(S.activeTimer.readingId){ const f=findReading(S.activeTimer.readingId); if(f) f.r.spent=(f.r.spent||0)+hrs; }
    S.sessions.push({d:k, m:Math.max(1,Math.round(sec/60)), id:S.activeTimer.readingId||null, h:hourInRiyadh()});
    if(S.sessions.length>500) S.sessions=S.sessions.slice(-500);
    if(!silent) toast("سجّلت "+Math.round(sec/60)+" دقيقة ✓");
  }
  S.activeTimer=null; breakShown=false; save();
  if(timerInt){ clearInterval(timerInt); timerInt=null; }
  const stk=currentStreak(); if(stk>0 && stk%7===0) celebrate("streak-"+stk,"سلسلة "+stk+" يوم متتالٍ 🔥");
  renderTopics(); renderAll();
}

/* ---------- master render ---------- */
function renderAll(){ renderHero(); renderReadiness(); renderInsights(); renderHeat(); renderToday(); renderDaily(); renderPerf(); renderSim(); renderDecay(); renderExamHint(); renderNowBtn(); renderRestBtn(); }

/* ---------- events ---------- */
$("#timerBtn").onclick=()=>{ if(S.activeTimer) stopTimer(); else startTimer(null); };
$("#reroll").onclick=()=>{ const cfg=ensurePlanCfg();
  const fs=todaysPlan().find(b=>b.type==="study");
  if(fs){ cfg.excl.push(fs.r.id); save(); }
  renderToday(); };

$("#logBtn").onclick=()=>{ const v=parseFloat($("#todayHrs").value); if(isNaN(v))return;
  S.dailyLog[todayKey()]=Math.min(16,Math.max(0,v)); save(); renderDaily(); renderInsights(); renderPerf();
  const stk=currentStreak(); if(stk>0 && stk%7===0) celebrate("streak-"+stk,"سلسلة "+stk+" يوم متتالٍ 🔥"); };
$("#todayHrs").addEventListener("keydown",e=>{ if(e.key==="Enter")$("#logBtn").click(); });

$("#tabs").onclick=e=>{ const b=e.target.closest(".tab"); if(!b)return;
  document.querySelectorAll("#tabs .tab").forEach(x=>x.classList.remove("on"));
  b.classList.add("on"); FILTER=b.dataset.f; renderTopics(); };

$("#ptabs").onclick=e=>{ const b=e.target.closest("button"); if(!b || !b.dataset.p)return; perfTab=b.dataset.p; renderPerf(); };

$("#expandAll").onclick=e=>{ e.preventDefault();
  const tops=document.querySelectorAll(".topic"); const opened=document.querySelectorAll(".topic.open").length;
  const openIt= opened<tops.length;
  tops.forEach(t=>t.classList.toggle("open",openIt)); syncExpandLabel(); };

/* settings */
function syncSettings(){ $("#setTarget").value=S.target; $("#setBuffer").value=S.buffer; $("#setQGoal").value=S.qGoal; $("#examDateTop").value=S.examDate; }
$("#setTarget").onchange=e=>{ S.target=Math.min(10,Math.max(.5,parseFloat(e.target.value)||2)); save(); renderAll(); };
$("#setBuffer").onchange=e=>{ S.buffer=Math.min(60,Math.max(0,parseInt(e.target.value)||0)); save(); renderAll(); };
$("#setQGoal").onchange=e=>{ S.qGoal=Math.min(10000,Math.max(100,parseInt(e.target.value)||2000)); save(); renderPerf(); renderReadiness(); renderInsights(); };
$("#examDateTop").onchange=e=>{ if(e.target.value){ S.examDate=e.target.value; save(); renderAll(); } };

/* export / copy / import / reset */
$("#exportBtn").onclick=async ()=>{
  try{
    const name="cfa-l2-progress-"+todayKey()+".json";
    const text=JSON.stringify(S,null,2);
    const file=new File([text],name,{type:"application/json"});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({title:"نسخة CFA الاحتياطية",files:[file]});
      S.lastExport=Date.now(); save();
      toast("اختر «حفظ في الملفات» للاحتفاظ بالنسخة");
      return;
    }
    const blob=new Blob([text],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    S.lastExport=Date.now(); save();
  }catch(err){
    if(err && err.name==="AbortError") return;
    toast("تعذّر التصدير هنا — استخدم «نسخ للحافظة»", true);
  }
};
$("#copyBtn").onclick=async ()=>{
  const s=JSON.stringify(S);
  try{ await navigator.clipboard.writeText(s); S.lastExport=Date.now(); save(); toast("نُسخت نسخة احتياطية للحافظة"); }
  catch(err){
    try{
      const ta=document.createElement("textarea"); ta.value=s; document.body.appendChild(ta);
      ta.select();
      const copied=document.execCommand("copy");
      document.body.removeChild(ta);
      if(!copied) throw new Error("copy failed");
      S.lastExport=Date.now(); save();
      toast("نُسخت نسخة احتياطية للحافظة");
    }catch(e2){ toast("تعذّر النسخ — استخدم «تصدير»", true); }
  }
};
$("#importBtn").onclick=()=>$("#importFile").click();
$("#importFile").onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{ try{ const o=JSON.parse(rd.result);
      if(o&&o.topics){ S=migrate(o); save(); boot(); toast("تم استيراد التقدّم"); }
      else toast("ملف غير صالح", true);
    }catch(err){ toast("تعذّر قراءة الملف", true); } };
  rd.readAsText(f);
  e.target.value="";
};
$("#resetBtn").onclick=()=>armConfirm($("#resetBtn"),()=>{ S=fresh(); save(); boot(); toast("أُعيد الضبط — بداية نظيفة"); });

function fmtBackupDate(ts){
  const d=new Date(ts);
  const hh=String(d.getHours()).padStart(2,"0"), mm=String(d.getMinutes()).padStart(2,"0");
  return fmtDate(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"))+" — "+hh+":"+mm;
}
function renderBackupList(){
  const host=$("#backupList");
  const list=loadBackups().slice().reverse();
  if(!list.length){ host.innerHTML='<div class="cmdk-empty">ما فيه نسخ محفوظة بعد — أول نسخة تنحفظ تلقائياً بعد أسبوع من أول استخدام.</div>'; return; }
  host.innerHTML = list.map((b,i)=>
    '<div class="cmdk-i" data-i="'+i+'" style="cursor:default">'+
      '<span class="lbl">'+esc(fmtBackupDate(b.ts))+'</span>'+
      '<button type="button" class="restbtn" data-restore="'+i+'" style="flex-shrink:0">استعادة</button>'+
    '</div>'
  ).join("");
  host.querySelectorAll("[data-restore]").forEach(btn=>{
    btn.onclick=()=>armConfirm(btn,()=>{
      const b=list[Number(btn.dataset.restore)]; if(!b) return;
      S=migrate(JSON.parse(JSON.stringify(b.data)));
      save(); boot();
      $("#backupModal").classList.remove("on");
      toast("استُعيدت نسخة "+fmtBackupDate(b.ts));
    });
  });
}
$("#backupsBtn").onclick=()=>{ renderBackupList(); $("#backupModal").classList.add("on"); };
$("#backupModal").onclick=e=>{ if(e.target.id==="backupModal") $("#backupModal").classList.remove("on"); };

$("#note").innerHTML = "اختصارات: <b>\u2318K</b> لوحة الأوامر · <b>/</b> بحث · <b>T</b> المؤقّت · <b>؟</b> الدليل. "+
  "أسماء المواضيع والقراءات بالإنجليزي وبساعات تقديرية حسب منهج 2026 — عدّل أي اسم أو رقم ساعات بالضغط عليه ليطابق مزوّدك. "+
  "«خطة اليوم» ترتّب أولوياتك تلقائياً (وزن عالٍ + ضعف أولاً)، والمراجعات المتباعدة (7/21/45/90 يوم) تحميك من نسيان ما أنهيته. "+
  "الحفظ تلقائي داخل متصفح جهازك فقط؛ على الآيباد استخدم Safari عبر رابط مستضاف، لا معاينة تطبيق الملفات. "+
  "لا توجد مزامنة تلقائية بين الأجهزة — استخدم «تصدير/استيراد» للنقل أو للنسخة الاحتياطية الأسبوعية.";

/* ---------- v4: search, pause, celebrations, weekly report ---------- */
$("#srch").oninput=e=>{ QUERY=norm((e.target.value||"").trim()); renderTopics(); };

$("#pauseBtn").onclick=()=>{ const a=S.activeTimer; if(!a)return;
  if(a.pausedAt){ a.start=Date.now(); a.pausedAt=null; }
  else { a.accum=(a.accum||0)+(Date.now()-a.start); a.pausedAt=Date.now(); }
  save(); updateTimerUI(); };

function confettiBurst(){
  const host=$("#cfw"); if(!host) return;
  const cols=["#C7A258","#54B488","#8AB4D8","#ECE9E1","#D86A4B"];
  for(let i=0;i<36;i++){
    const sq=document.createElement("i"); sq.className="cf";
    sq.style.left=(Math.random()*100)+"%";
    sq.style.background=cols[i%cols.length];
    sq.style.animationDuration=(2.2+Math.random()*1.6)+"s";
    sq.style.animationDelay=(Math.random()*0.5)+"s";
    host.appendChild(sq);
    setTimeout(()=>sq.remove(),4800);
  }
}
function celebrate(key,msg){
  if(S.celebrated[key]) return;
  S.celebrated[key]=1; save();
  confettiBurst(); if(msg) toast(msg);
}

function weeklyReport(){
  let hrs7=0; for(let i=0;i<7;i++) hrs7+=S.dailyLog[shiftDateKey(todayKey(),-i)]||0;
  const from=addDays(-6);
  const ses7=S.sessions.filter(x=>x.d>=from).length;
  let qa=0,qc=0;
  for(const d in S.practice){ if(d>=from){ for(const id in S.practice[d]){ qa+=S.practice[d][id].a; qc+=S.practice[d][id].c; } } }
  const T=totals(), R=Math.round(overallReadiness());
  const gaps=S.topics.map(t2=>({t:t2,h:topicHours(t2),m:topicMastery(t2)}))
    .filter(x=>x.t.weight>=10 && (x.h.frac<0.9 || x.m<1.5))
    .sort((a,b)=>(b.t.weight*(1-b.h.frac))-(a.t.weight*(1-a.h.frac))).slice(0,2)
    .map(x=>x.t.en||x.t.ar).join("، ");
  const ms=S.mocks.slice().sort((a,b)=> a.date<b.date?-1:1);
  const lines=[
    "تقرير أسبوع "+fmtDate(from)+" – "+fmtDate(todayKey()),
    "الساعات: "+fmt(hrs7)+" من هدف "+fmt(S.target*7)+" ("+ses7+" جلسة مؤقّت)",
    "الأسئلة: "+qa.toLocaleString("en")+(qa?(" بدقة "+Math.round(qc/qa*100)+"٪"):""),
    (ms.length?("آخر تجريبي: "+fmt(ms[ms.length-1].score)+"٪ ("+fmtDate(ms[ms.length-1].date)+")"):"لا اختبارات تجريبية بعد"),
    "التقدّم الموزون: "+Math.round(T.pct)+"٪ · الجاهزية: "+R+"/100 · السلسلة: "+currentStreak()+" يوم",
    "متانة ما أنهيته: "+Math.round(retentionOverall()*100)+"٪ · مراجعات مستحقة: "+dueReviews().length,
    "بوتيرة "+fmt(S.target)+" سا/يوم الجاهزية المتوقعة يوم الاختبار: "+Math.round(projectAt(S.target).total)+"/100",
    (gaps?("أكبر الفجوات: "+gaps):"")
  ].filter(Boolean);
  return lines.join("\n");
}
$("#repBtn").onclick=async ()=>{
  const txt=weeklyReport();
  try{ await navigator.clipboard.writeText(txt); toast("نُسخ تقرير الأسبوع للحافظة"); }
  catch(err){
    try{
      const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta);
      ta.select();
      const copied=document.execCommand("copy");
      document.body.removeChild(ta);
      if(!copied) throw new Error("copy failed");
      toast("نُسخ تقرير الأسبوع للحافظة");
    }catch(e2){ toast("تعذّر النسخ في هذا المتصفح", true); }
  }
};


/* =========================================================================
   v5 — projection, retention, command palette, rest days, merge, file sync
   ========================================================================= */

/* ---------- undo ---------- */
let undoFn=null;
function offerUndo(msg, fn){
  undoFn=fn;
  const p=$("#undoPill"); if(!p) return;
  p.querySelector("span").textContent=msg;
  p.classList.add("show");
  clearTimeout(offerUndo._t);
  offerUndo._t=setTimeout(()=>{ p.classList.remove("show"); undoFn=null; }, 8000);
}
$("#undoPill").querySelector("button").onclick=()=>{
  if(undoFn){ const f=undoFn; undoFn=null; $("#undoPill").classList.remove("show"); f(); toast("تراجعت عن الحذف"); }
};

/* ---------- retention / decay of finished material ----------
   The review record stores {next, stage}. Last review = next - interval(stage).
   Retention proxy decays exponentially and lands near 30% exactly when the
   review falls due — that's the design point of the 7/21/45/90 ladder.      */
function retentionOf(id){
  const rv=S.reviews[id]; if(!rv) return null;
  const iv=RIVL[rv.stage]||RIVL[0];
  const last=shiftDateKey(rv.next,-iv);
  const el=Math.max(0, daysBetweenKeys(last, todayKey()));
  return Math.max(0, Math.min(1, Math.exp(-1.2*el/iv)));
}
function decayRows(){
  const out=[];
  S.topics.forEach(t=>t.r.forEach(r=>{
    if(r.status!=="done") return;
    const ret=retentionOf(r.id);
    out.push({t:t, r:r, ret: ret==null?1:ret, tracked: ret!=null});
  }));
  return out;
}
function retentionOverall(){
  const rows=decayRows(); let w=0,s=0;
  rows.forEach(x=>{ const ww=x.r.hrs*(x.t.weight/100); w+=ww; s+=ww*x.ret; });
  return w? s/w : 1;
}
function retColor(v){ return v>=0.7?"var(--strong)":(v>=0.45?"var(--mid)":"var(--weak)"); }
function renderDecay(){
  const host=$("#decayCard"); if(!host) return;
  const rows=decayRows();
  const head='<h3>متانة ما أنهيته</h3><div class="sub">إنهاء القراءة ليس تملّكها. هذا تقدير لما بقي منها بناءً على المدة منذ آخر مراجعة — الأقل هنا هو أرخص درجات تكسبها.</div>';
  if(!rows.length){
    host.innerHTML=head+'<p class="empty">لم تُنهِ أي قراءة بعد. أول قراءة تعلّمها «أنهيتها» تدخل جدول المراجعة تلقائياً (7 ← 21 ← 45 ← 90 يوم).</p>';
    return;
  }
  const ov=retentionOverall();
  const untracked=rows.filter(x=>!x.tracked).length;
  const weak=rows.slice().sort((a,b)=>(a.ret*(100-a.t.weight))-(b.ret*(100-b.t.weight))).slice(0,6);
  let list="";
  weak.forEach(x=>{
    const col=retColor(x.ret);
    const dueNow = S.reviews[x.r.id] && S.reviews[x.r.id].next<=todayKey();
    list+='<div class="dc-row">'+
      '<span class="dc-abbr">'+esc(x.t.abbr)+'</span>'+
      '<span class="dc-name" title="'+esc(x.r.en||x.r.ar)+'">'+esc(x.r.en||x.r.ar)+'</span>'+
      '<span class="dc-bar"><i style="width:'+Math.round(x.ret*100)+'%;background:'+col+'"></i></span>'+
      '<span class="dc-pct" style="color:'+col+'">'+Math.round(x.ret*100)+'٪</span>'+
      (x.tracked?'<button class="dc-btn" data-r="'+esc(x.r.id)+'">'+(dueNow?'راجعت ✓':'راجعتها')+'</button>':'')+
      '</div>';
  });
  host.innerHTML=head+
    '<div class="dc-head"><span class="dc-big" style="color:'+retColor(ov)+'">'+Math.round(ov*100)+'٪</span>'+
    '<span class="dc-lab">متوسط مرجّح بوزن الموضوع وساعاته · '+rows.length+' قراءة منتهية'+
    (untracked?(' · '+untracked+' بلا سجل مراجعة'):'')+'</span></div>'+list;
  host.querySelectorAll(".dc-btn").forEach(b=>{ b.onclick=()=>reviewed(b.dataset.r); });
}

/* ---------- pace simulator ---------- */
let simPace=null;
function contentPtsAtFull(){
  let raw=0;
  S.topics.forEach(t=>{
    let h=0,r=0;
    t.r.forEach(x=>{ const m=({none:0.8,weak:0.5,mid:0.8,strong:1.0})[x.mastery] ?? 0.8; h+=x.hrs; r+=x.hrs*m; });
    raw+=(t.weight/100)*(h?r/h:0);
  });
  return raw*50;
}
function projectAt(p){
  const T=totals(), sdl=studyDaysLeft(), edl=examDaysLeft();
  const rb=readinessBreakdown();
  const full=contentPtsAtFull();
  const cov = T.left>0.01 ? Math.min(1,(p*sdl)/T.left) : 1;
  const content = Math.min(full, rb.content + Math.max(0, full-rb.content)*cov);
  const qs=qbStats();
  const projQ = Math.round(qs.a + qs.perDay*edl);
  const qMult = qs.a>0 ? projQ/qs.a : 0;
  let qbankRaw=0;
  S.topics.forEach(t=>{
    const q=topicAcc(t.id); if(!q) return;
    const accuracy=clamp01((q.acc-50)/25);
    const expected=Math.max(1,S.qGoal*(t.weight/100));
    qbankRaw+=(t.weight/100)*accuracy*Math.sqrt(clamp01(q.a*qMult/expected));
  });
  const qbank=qbankRaw*30;
  let finish=null, diff=null;
  if(T.left>0.01 && p>0){ const d=Math.ceil(T.left/p); finish=shiftDateKey(todayKey(),d); diff=daysBetweenKeys(contentDeadline(),finish); }
  return {content:content, qbank:qbank, mocks:rb.mocks, total:content+qbank+rb.mocks, projQ:projQ, finish:finish, diff:diff};
}
function renderSim(){
  const host=$("#simCard"); if(!host) return;
  const T=totals(), sdl=studyDaysLeft();
  const req=T.left/sdl;
  if(simPace==null) simPace=S.target;
  const p=simPace;
  const r=projectAt(p);
  const seg=v=>Math.max(0,Math.min(100,v));
  const finTxt = r.finish==null ? "المحتوى مكتمل"
    : fmtDate(r.finish)+(r.diff>0?(" · متأخر "+r.diff+"ي"):(r.diff<0?(" · مبكر "+(-r.diff)+"ي"):" · بالضبط"));
  const finCol = r.finish==null?"var(--strong)":(r.diff>2?"var(--bad)":(r.diff>0?"var(--mid)":"var(--strong)"));
  host.innerHTML=
    '<h3>محاكاة الوتيرة</h3>'+
    '<div class="sub">حرّك الشريط وشوف أثر الساعة الإضافية قبل ما تلتزم بها. المطلوب اليوم لإنهاء المحتوى في وقته: <b style="color:var(--gold)">'+fmt(req)+'</b> سا/يوم.</div>'+
    '<div class="sim-row">'+
      '<span class="sim-pace" id="simPaceTxt">'+fmt(p)+'<small> سا/يوم</small></span>'+
      '<input type="range" id="simRange" min="0.5" max="8" step="0.25" value="'+p+'">'+
    '</div>'+
    '<div class="sim-quick">'+
      '<button data-v="'+fmt(S.target)+'">هدفك '+fmt(S.target)+'</button>'+
      '<button data-v="'+fmt(Math.max(0.5,Math.round(avg7()*4)/4))+'">معدلك الفعلي '+fmt(avg7())+'</button>'+
      '<button data-v="'+fmt(Math.min(8,Math.max(0.5,Math.ceil(req*4)/4)))+'">المطلوب '+fmt(req)+'</button>'+
    '</div>'+
    '<div class="sim-out">'+
      '<div class="sim-o"><div class="v" style="color:'+finCol+'">'+finTxt+'</div><div class="k">إنهاء المحتوى</div></div>'+
      '<div class="sim-o"><div class="v">'+Math.round(r.total)+'<small>/100</small></div><div class="k">الجاهزية يوم الاختبار</div></div>'+
      '<div class="sim-o"><div class="v">'+r.projQ.toLocaleString("en")+'</div><div class="k">أسئلة متوقعة</div></div>'+
      '<div class="sim-o"><div class="v">'+fmt(p*examDaysLeft())+'<small> سا</small></div><div class="k">ساعات متبقية بهذه الوتيرة</div></div>'+
    '</div>'+
    '<div class="sim-wrap">'+
      '<div class="sim-bar">'+
        '<i class="s-c" style="width:'+seg(r.content)+'%"></i>'+
        '<i class="s-q" style="width:'+seg(r.qbank)+'%"></i>'+
        '<i class="s-m" style="width:'+seg(r.mocks)+'%"></i>'+
      '</div>'+
      '<div class="sim-mark" style="inset-inline-start:70%"><b>عتبة ٧٠</b></div>'+
    '</div>'+
    '<div class="sim-leg"><span><i style="background:var(--gold)"></i>المحتوى '+fmt(r.content)+'</span>'+
      '<span><i style="background:#6E8CC9"></i>الأسئلة '+fmt(r.qbank)+'</span>'+
      '<span><i style="background:var(--strong)"></i>المحاكيات '+fmt(r.mocks)+'</span></div>'+
    '<div class="sim-note" id="simNote"></div>';
  const rng=host.querySelector("#simRange");
  rng.oninput=()=>{ simPace=parseFloat(rng.value)||S.target; renderSim(); };
  host.querySelectorAll(".sim-quick button").forEach(b=>{
    b.onclick=()=>{ simPace=Math.min(8,Math.max(0.5,parseFloat(b.dataset.v)||S.target)); renderSim(); };
  });
  /* the honest caveat: mocks are frozen at what you've actually recorded */
  const note=host.querySelector("#simNote");
  const qs=qbStats();
  let msg="";
  if(qs.a===0) msg="لم تسجّل أسئلة بعد، فمكوّن بنك الأسئلة (٣٠ نقطة) صفر في هذا التوقّع — سجّل أول جلسة أسئلة ليصير الرقم واقعياً.";
  else if(!S.mocks.length) msg="المحاكيات (٢٠ نقطة) ثابتة على صفر لأنك ما سجّلت أي اختبار تجريبي — التوقّع أعلاه سقفه ٨٠ حتى تسجّل واحداً.";
  else msg="مكوّن المحاكيات ثابت على أدائك المسجّل حالياً؛ الوتيرة تحرّك المحتوى والأسئلة فقط.";
  note.innerHTML=msg;
}

/* ---------- best study hours ---------- */
function bestHoursBlock(){
  const ses=(S.sessions||[]).filter(x=>x.h!=null && x.m>0);
  if(ses.length<3) return '<p class="cal-cap">شغّل المؤقّت بضع مرات وسيظهر هنا تحليل لأفضل أوقاتك في اليوم.</p>';
  const B=[0,0,0,0,0,0], LAB=["٠٠–٠٤","٠٤–٠٨","٠٨–١٢","١٢–١٦","١٦–٢٠","٢٠–٢٤"];
  ses.forEach(x=>{ B[Math.min(5,Math.floor(x.h/4))]+=x.m; });
  const mx=Math.max.apply(null,B)||1;
  const bi=B.indexOf(mx);
  const W=600,H=120,pad=28,bw=(W-pad*2)/6;
  let g="";
  B.forEach((v,i)=>{
    const bh=(v/mx)*(H-46), x=pad+i*bw+bw*0.2, y=H-26-bh;
    g+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.6).toFixed(1)+'" height="'+Math.max(2,bh).toFixed(1)+'" rx="3" fill="'+(i===bi?"var(--gold)":"#2a3a4c")+'"/>';
    if(v>0) g+='<text x="'+(x+bw*0.3).toFixed(1)+'" y="'+(y-5).toFixed(1)+'" text-anchor="middle" font-size="9.5" fill="#9DABBD" font-family="JetBrains Mono, monospace">'+Math.round(v/60*10)/10+'س</text>';
    g+='<text x="'+(x+bw*0.3).toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle" font-size="9" fill="#677A8E" font-family="JetBrains Mono, monospace">'+LAB[i]+'</text>';
  });
  return '<div class="chart-wrap" dir="ltr"><svg viewBox="0 0 '+W+' '+H+'">'+g+'</svg></div>'+
    '<p class="cal-cap">توزيع جلسات المؤقّت على ساعات اليوم (بتوقيت الرياض) — أطول تركيز لك في نافذة <b style="color:var(--gold)">'+LAB[bi]+'</b>. احجز أصعب مادة لهذه النافذة.</p>';
}

/* ---------- next best action ---------- */
function nextAction(){
  const due=dueReviews();
  if(due.length) return {rid:due[0].r.id, label:"راجع الآن: "+(due[0].r.en||due[0].r.ar), review:true};
  const b=todaysPlan().find(x=>x.type!=="review");
  if(b) return {rid:b.r.id, label:"ابدأ الأهم: "+(b.r.en||b.r.ar), review:false};
  return null;
}
function renderNowBtn(){
  const btn=$("#nowBtn"); if(!btn) return;
  if(S.activeTimer){ btn.hidden=true; return; }
  const a=nextAction();
  if(!a){ btn.hidden=true; return; }
  btn.hidden=false; btn.textContent=a.label;
  btn.title=a.review?"مراجعة مستحقة — أعلى عائد لكل دقيقة":"أعلى أولوية حسب وزن الموضوع وإتقانك";
  btn.onclick=()=>startTimer(a.rid);
}

/* ---------- planned rest days ---------- */
function renderRestBtn(){
  const b=$("#restBtn"); if(!b) return;
  const on=isRest(todayKey());
  b.classList.toggle("on",on);
  b.textContent = on ? "اليوم: راحة مخطط ✓" : "يوم راحة مخطط";
  b.title = "يوم الراحة المخطط لا يكسر سلسلتك ولا يُحتسب ضمنها";
}
$("#restBtn").onclick=()=>{
  if(!S.restDays) S.restDays={};
  const k=todayKey();
  if(S.restDays[k]) delete S.restDays[k]; else S.restDays[k]=1;
  save(); renderAll();
};

/* ---------- exam window sanity check ---------- */
function renderExamHint(){
  const h=$("#examHint"); if(!h) return;
  const d=S.examDate||"";
  h.className="exam-hint";
  if(d>="2026-11-01" && d<="2026-11-30"){
    if(d<"2026-11-18" || d>"2026-11-22"){
      h.className="exam-hint warn";
      h.textContent="نافذة المستوى الثاني نوفمبر 2026 هي 18–22/11 — تاريخك خارجها. راجع موعدك المجدول.";
    } else h.textContent="ضمن نافذة 18–22/11/2026. ثبّت اليوم المجدول لديك.";
  } else if(d) h.textContent="تأكّد أن التاريخ يطابق موعدك المجدول فعلياً.";
}

/* ---------- merge import (for MacBook ↔ iMac) ---------- */
function mergeState(base, inc){
  const out=JSON.parse(JSON.stringify(base));
  if(!out.restDays) out.restDays={};
  for(const k in (inc.dailyLog||{})) out.dailyLog[k]=Math.max(out.dailyLog[k]||0, Number(inc.dailyLog[k])||0);
  for(const d in (inc.practice||{})){
    if(!out.practice[d]) out.practice[d]={};
    for(const id in inc.practice[d]){
      const a=inc.practice[d][id], b=out.practice[d][id];
      if(!b || (a.a||0)>(b.a||0)) out.practice[d][id]={a:a.a||0,c:a.c||0};
    }
  }
  const seen={}; out.mocks.forEach(m=>seen[m.id]=1);
  (inc.mocks||[]).forEach(m=>{ if(m && !seen[m.id]){ out.mocks.push(m); seen[m.id]=1; } });
  const sk={}; out.sessions.forEach(x=>sk[x.d+"|"+x.m+"|"+(x.id||"")]=1);
  (inc.sessions||[]).forEach(x=>{ const k=x.d+"|"+x.m+"|"+(x.id||""); if(!sk[k]){ out.sessions.push(x); sk[k]=1; } });
  if(out.sessions.length>800) out.sessions=out.sessions.slice(-800);
  const SR={todo:0,doing:1,done:2}, MR={none:0,weak:1,mid:2,strong:3};
  (inc.topics||[]).forEach(it=>{
    const ot=out.topics.find(x=>x.id===it.id); if(!ot) return;
    (it.r||[]).forEach(ir=>{
      const or_=ot.r.find(x=>x.id===ir.id);
      if(!or_){ ot.r.push(JSON.parse(JSON.stringify(ir))); return; }
      if((SR[ir.status]||0)>(SR[or_.status]||0)) or_.status=ir.status;
      if((MR[ir.mastery]||0)>(MR[or_.mastery]||0)) or_.mastery=ir.mastery;
      or_.spent=Math.max(or_.spent||0, ir.spent||0);
      if((ir.note||"").length>(or_.note||"").length) or_.note=ir.note;
    });
  });
  for(const id in (inc.reviews||{})){
    const a=inc.reviews[id], b=out.reviews[id];
    if(!b || a.stage>b.stage || (a.stage===b.stage && a.next>b.next)) out.reviews[id]=a;
  }
  for(const k in (inc.restDays||{})) out.restDays[k]=1;
  for(const k in (inc.celebrated||{})) out.celebrated[k]=1;
  out.qGoal=Math.max(out.qGoal||2000, inc.qGoal||0);
  return out;
}
$("#mergeBtn").onclick=()=>$("#mergeFile").click();
$("#mergeFile").onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const o=JSON.parse(rd.result);
      if(o && o.topics){ S=migrate(mergeState(S, migrate(o))); save(); boot(); toast("تم الدمج — احتُفظ بالأعلى من كل جهاز"); }
      else toast("ملف غير صالح", true);
    }catch(err){ toast("تعذّر قراءة الملف", true); }
  };
  rd.readAsText(f);
  e.target.value="";
};

/* ---------- optional file sync (Chrome/Edge): keep the JSON in iCloud Drive ---------- */
let fileHandle=null, syncT=null;
const IDB_DB="cfa_l2_sync_v1", IDB_ST="h";
function idbOpen(){
  return new Promise((res,rej)=>{
    try{
      const r=indexedDB.open(IDB_DB,1);
      r.onupgradeneeded=()=>{ try{ r.result.createObjectStore(IDB_ST); }catch(e){} };
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    }catch(e){ rej(e); }
  });
}
async function idbPut(k,v){ try{ const db=await idbOpen(); return await new Promise(res=>{ const tx=db.transaction(IDB_ST,"readwrite"); tx.objectStore(IDB_ST).put(v,k); tx.oncomplete=()=>res(1); tx.onerror=()=>res(0); }); }catch(e){ return 0; } }
async function idbGet(k){ try{ const db=await idbOpen(); return await new Promise(res=>{ const tx=db.transaction(IDB_ST,"readonly"); const q=tx.objectStore(IDB_ST).get(k); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }); }catch(e){ return null; } }
function syncState(txt, good){
  const el=$("#syncState"); if(!el) return;
  el.innerHTML = good ? ("<b>"+esc(txt)+"</b>") : esc(txt);
}
function syncPush(){
  if(!fileHandle) return;
  clearTimeout(syncT);
  syncT=setTimeout(async ()=>{
    try{
      const w=await fileHandle.createWritable();
      await w.write(JSON.stringify(S,null,2));
      await w.close();
      S.lastExport=Date.now();
      syncState("مزامن · "+new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}), true);
    }catch(e){ syncState("تعذّرت الكتابة — أعد الربط"); fileHandle=null; }
  }, 1500);
}
async function linkSyncFile(){
  try{
    const h=await window.showSaveFilePicker({
      suggestedName:"cfa-l2-progress.json",
      types:[{description:"JSON", accept:{"application/json":[".json"]}}]
    });
    fileHandle=h; await idbPut("handle",h);
    $("#syncBtn").textContent="إعادة ربط ملف المزامنة";
    syncState("مربوط — يُحفظ تلقائياً", true);
    syncPush();
    toast("رُبط ملف المزامنة — ضعه في iCloud Drive لتصل للجهازين");
  }catch(e){ /* user cancelled */ }
}
async function initSync(){
  if(!(window.showSaveFilePicker)) {
    const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
    syncState(isiOS ? "Safari على الآيباد: استخدم تصدير/استيراد أو النسخة المستضافة" : "مزامنة الملف تحتاج Chrome أو Edge");
    return;
  }
  $("#syncBtn").hidden=false;
  $("#syncBtn").onclick=linkSyncFile;
  const h=await idbGet("handle");
  if(!h) { syncState("غير مربوط"); return; }
  try{
    const perm=await h.queryPermission({mode:"readwrite"});
    if(perm==="granted"){ fileHandle=h; $("#syncBtn").textContent="إعادة ربط ملف المزامنة"; syncState("مربوط — يُحفظ تلقائياً", true); }
    else {
      syncState("مربوط — يحتاج إذناً");
      $("#syncBtn").textContent="تفعيل المزامنة";
      $("#syncBtn").onclick=async ()=>{
        try{
          const p2=await h.requestPermission({mode:"readwrite"});
          if(p2==="granted"){ fileHandle=h; syncState("مربوط — يُحفظ تلقائياً", true); $("#syncBtn").textContent="إعادة ربط ملف المزامنة"; $("#syncBtn").onclick=linkSyncFile; syncPush(); }
          else linkSyncFile();
        }catch(e){ linkSyncFile(); }
      };
    }
  }catch(e){ syncState("غير مربوط"); }
}

/* ---------- command palette ---------- */
let cmdItems=[], cmdSel=0;
function openTopicNode(tid, rid){
  if(FILTER!=="all" || QUERY){
    FILTER="all"; QUERY=""; $("#srch").value="";
    document.querySelectorAll("#tabs .tab").forEach(x=>x.classList.toggle("on",x.dataset.f==="all"));
    renderTopics();
  }
  const node=document.getElementById("topic-"+tid);
  if(!node) return;
  node.classList.add("open"); syncExpandLabel();
  const row = rid ? node.querySelector('.row[data-rid="'+rid.replace(/"/g,'')+'"]') : null;
  scrollTo_(row||node);
  if(row){ row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
}
function buildCmds(){
  const out=[];
  out.push({k:"أمر",label:(S.activeTimer?"إيقاف المؤقّت وتسجيل الوقت":"ابدأ جلسة مؤقّت"),mta:"T",run:()=>{ if(S.activeTimer) stopTimer(); else startTimer(null); }});
  const na=nextAction();
  if(na) out.push({k:"أمر",label:na.label,mta:"",run:()=>startTimer(na.rid)});
  out.push({k:"أمر",label:"سجّل أسئلة تدريب",mta:"",run:()=>{ perfTab="qb"; renderPerf(); scrollTo_(document.querySelector(".perf")); }});
  out.push({k:"أمر",label:"سجّل اختباراً تجريبياً",mta:"",run:()=>{ perfTab="mock"; renderPerf(); scrollTo_(document.querySelector(".perf")); }});
  out.push({k:"أمر",label:"انسخ تقرير الأسبوع",mta:"R",run:()=>$("#repBtn").click()});
  out.push({k:"أمر",label:"صدّر نسخة احتياطية",mta:"E",run:()=>$("#exportBtn").click()});
  out.push({k:"أمر",label:(isRest(todayKey())?"ألغِ يوم الراحة المخطط":"علّم اليوم راحة مخططة"),mta:"",run:()=>$("#restBtn").click()});
  S.topics.forEach(t=>{
    out.push({k:"موضوع",label:(t.en||t.ar),q:(t.en||"")+" "+(t.ar||"")+" "+t.abbr,mta:t.abbr+" · "+t.wMin+"–"+t.wMax+"%",run:()=>openTopicNode(t.id)});
    t.r.forEach(r=>out.push({k:(r.status==="done"?"منتهية":"قراءة"),label:(r.en||r.ar),
      q:(r.en||"")+" "+(r.ar||"")+" "+(t.en||"")+" "+(t.ar||"")+" "+t.abbr,mta:t.abbr,rid:r.id,run:()=>openTopicNode(t.id,r.id)}));
  });
  return out;
}
function renderCmdList(q){
  const nq=norm(q);
  const all=buildCmds();
  cmdItems = nq ? all.filter(x=>norm((x.q||x.label)+" "+(x.mta||"")+" "+x.k).indexOf(nq)!==-1) : all.slice(0,40);
  if(cmdSel>=cmdItems.length) cmdSel=0;
  const host=$("#cmdkList");
  if(!cmdItems.length){ host.innerHTML='<div class="cmdk-empty">لا نتائج. جرّب اسم القراءة بالإنجليزي أو اختصار الموضوع.</div>'; return; }
  host.innerHTML=cmdItems.map((x,i)=>
    '<div class="cmdk-i'+(i===cmdSel?" sel":"")+'" data-i="'+i+'">'+
      '<span class="tagi">'+esc(x.k)+'</span>'+
      '<span class="lbl">'+esc(x.label)+'</span>'+
      (x.mta?('<span class="mta">'+esc(x.mta)+'</span>'):'')+
    '</div>').join("");
  host.querySelectorAll(".cmdk-i").forEach(el=>{
    el.onmouseenter=()=>{ cmdSel=Number(el.dataset.i); host.querySelectorAll(".cmdk-i").forEach(n=>n.classList.toggle("sel",n===el)); };
    el.onclick=()=>runCmd(false);
  });
}
function runCmd(withTimer){
  const it=cmdItems[cmdSel]; if(!it) return;
  closePalette();
  if(withTimer && it.rid){ startTimer(it.rid); return; }
  if(it.run) it.run();
}
function openPalette(){
  const p=$("#cmdk"); p.classList.add("on");
  const inp=$("#cmdkIn"); inp.value=""; cmdSel=0; renderCmdList("");
  setTimeout(()=>inp.focus(),10);
}
function closePalette(){ $("#cmdk").classList.remove("on"); }
$("#cmdkIn").oninput=e=>{ cmdSel=0; renderCmdList(e.target.value); };
$("#cmdk").onclick=e=>{ if(e.target.id==="cmdk") closePalette(); };
$("#cmdkIn").onkeydown=e=>{
  if(e.key==="ArrowDown"){ e.preventDefault(); cmdSel=Math.min(cmdItems.length-1,cmdSel+1); renderCmdList($("#cmdkIn").value);
    const el=$("#cmdkList").querySelector(".cmdk-i.sel"); if(el) el.scrollIntoView({block:"nearest"}); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); cmdSel=Math.max(0,cmdSel-1); renderCmdList($("#cmdkIn").value);
    const el=$("#cmdkList").querySelector(".cmdk-i.sel"); if(el) el.scrollIntoView({block:"nearest"}); }
  else if(e.key==="Enter"){ e.preventDefault(); runCmd(e.shiftKey); }
};

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", e=>{
  const t=e.target, tag=(t.tagName||"").toLowerCase();
  const typing = tag==="input"||tag==="textarea"||tag==="select"||t.isContentEditable;
  if((e.metaKey||e.ctrlKey) && (e.code==="KeyK")){ e.preventDefault(); openPalette(); return; }
  if(e.key==="Escape"){ closePalette(); return; }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key==="/"){ e.preventDefault(); $("#srch").focus(); }
  else if(e.code==="KeyT"){ e.preventDefault(); if(S.activeTimer) stopTimer(); else startTimer(null); }
  else if(e.key==="?" || e.key==="؟"){ e.preventDefault(); const g=document.querySelector(".guide"); g.open=true; scrollTo_(g); }
});

/* ---------- day rollover: keep the plan and dates honest past midnight ---------- */
let __dayGuard=todayKey();
setInterval(()=>{
  const k=todayKey();
  if(k!==__dayGuard){ __dayGuard=k; ensurePlanCfg(); save(); boot(); }
}, 60000);

/* ---------- iPad / local-file notice ---------- */
(function(){
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const localFile=location.protocol==="file:";
  const b=document.getElementById("iosBanner");
  if(b && isiOS && localFile && sessionStorage.getItem("cfa_ios_banner_closed")!=="1") b.classList.add("show");
  const c=document.getElementById("iosBannerClose");
  if(c) c.onclick=()=>{ b.classList.remove("show"); try{sessionStorage.setItem("cfa_ios_banner_closed","1");}catch(e){} };
})();

/* ---------- boot ---------- */
function boot(){ syncSettings(); renderAll(); renderTopics(); }
(async function init(){
  let loaded=null;
  try{ loaded = await store.read(); }catch(e){}
  S = loaded ? migrate(loaded) : fresh();
  maybeAutoBackup();
  /* a timer left running overnight would otherwise bill today for yesterday's session */
  let staleNote=null;
  if(S.activeTimer){
    const dk=S.activeTimer.dayKey||todayKey();
    if(dk!==todayKey()){
      const secs=Math.min(timerSec(), 4*3600);
      if(secs>=60){
        const hrs=secs/3600;
        S.dailyLog[dk]=(S.dailyLog[dk]||0)+hrs;
        const f=S.activeTimer.readingId?findReading(S.activeTimer.readingId):null;
        if(f) f.r.spent=(f.r.spent||0)+hrs;
        S.sessions.push({d:dk, m:Math.round(secs/60), id:S.activeTimer.readingId||null, h:null});
        staleNote="مؤقّت من "+fmtDate(dk)+" كان شغّالاً — سُجّل "+Math.round(secs/60)+" دقيقة على ذلك اليوم";
      }
      S.activeTimer=null;
    }
  }
  boot();
  initSync();
  if(staleNote) setTimeout(()=>toast(staleNote, true), 600);
  const persisted=await store.write(S);
  if(!persisted){
    $("#note").insertAdjacentHTML("beforeend",
      '<br><b style="color:var(--bad)">تنبيه: هذا المتصفح منع الحفظ الدائم. افتح الملف في متصفح آخر قبل تسجيل أي تقدّم.</b>');
    toast("الحفظ الدائم غير متاح في هذا المتصفح", true);
  }
})();
document.addEventListener("visibilitychange",()=>{ if(document.hidden && S){ store.write(S); } });
