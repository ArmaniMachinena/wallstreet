/* WSA — screens, sessions, data, widgets, kit. Exposes window.CD for Jarvis. */
(function(){
"use strict";
const OWNER_NAME = "Assem";            // used in the greeting and by Jarvis
const NY = "America/New_York";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const S = {get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},
           set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || NY;

/* ============================================================ time zone helpers */
const fmtCache = {};
function partsOf(tz, t){
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",weekday:"short"}));
  const p = {}; f.formatToParts(new Date(t)).forEach(x => p[x.type] = x.value);
  const h = +p.hour % 24;
  return {y:+p.year, m:+p.month, d:+p.day, h, mi:+p.minute, s:+p.second, wd:p.weekday,
          ymd:`${p.year}-${p.month}-${p.day}`, hms:`${String(h).padStart(2,"0")}:${p.minute}:${p.second}`, hm:`${String(h).padStart(2,"0")}:${p.minute}`};
}
function offsetMs(tz, t){ const p = partsOf(tz, t); return Date.UTC(p.y, p.m-1, p.d, p.h, p.mi, p.s) - Math.floor(t/1000)*1000; }
function zoned(tz, y, m, d, minutes){
  const guess = Date.UTC(y, m-1, d, 0, minutes);
  let t = guess - offsetMs(tz, guess);
  const o2 = offsetMs(tz, t); if (guess - o2 !== t) t = guess - o2;
  return t;
}
function ymdAdd(ymd, k){ const [y,m,d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y,m-1,d+k)); return t.toISOString().slice(0,10); }
function dowOf(ymd){ const [y,m,d] = ymd.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)).getUTCDay(); }
function dur(ms){
  const m = Math.max(0, Math.round(ms/60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m/60), r = m % 60;
  if (h < 24) return `${h}h ${String(r).padStart(2,"0")}m`;
  return `${Math.floor(h/24)}d ${h%24}h`;
}
function ago(iso){ if(!iso) return ""; const ms = Date.now() - new Date(iso).getTime(); const m = Math.round(ms/60000);
  if (m < 1) return "now"; if (m < 60) return m+"m"; const h = Math.round(m/60); return h < 48 ? h+"h" : Math.round(h/24)+"d"; }
function clock12(tz, t){ return new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"numeric",minute:"2-digit"}).format(new Date(t)); }

/* ============================================================ market sessions */
const wk = list => d => (d === 0 || d === 6) ? [] : list;
const US_HOL = new Set(["2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05"]);
const US_EARLY = {"2026-11-27":780,"2026-12-24":780};
const BOND_EARLY = {"2026-11-27":840,"2026-12-24":840,"2026-12-31":840};
const UK_HOL = new Set(["2026-12-25","2026-12-28","2027-01-01"]); const UK_EARLY = {"2026-12-24":750,"2026-12-31":750};
const DE_HOL = new Set(["2026-12-24","2026-12-25","2026-12-31","2027-01-01"]);
const JP_HOL = new Set(["2026-11-23","2026-12-31","2027-01-01","2027-01-11"]);
const HK_HOL = new Set(["2026-12-25","2027-01-01"]); const HK_EARLY = {"2026-12-24":720,"2026-12-31":720};
const CN_HOL = new Set(["2027-01-01"]);
const MARKETS = [
  {id:"asx",  name:"Sydney",        ex:"ASX",        tz:"Australia/Sydney", s:wk([[600,960]])},
  {id:"tse",  name:"Tokyo",         ex:"TSE",        tz:"Asia/Tokyo",       s:wk([[540,690],[750,930]]), hol:JP_HOL},
  {id:"sse",  name:"Shanghai",      ex:"SSE",        tz:"Asia/Shanghai",    s:wk([[570,690],[780,900]]), hol:CN_HOL},
  {id:"hkex", name:"Hong Kong",     ex:"HKEX",       tz:"Asia/Hong_Kong",   s:wk([[570,720],[780,960]]), hol:HK_HOL, early:HK_EARLY},
  {id:"nse",  name:"Mumbai",        ex:"NSE",        tz:"Asia/Kolkata",     s:wk([[555,930]])},
  {id:"kase", name:"Almaty",        ex:"KASE",       tz:"Asia/Almaty",      s:wk([[690,1020]])},
  {id:"xetra",name:"Frankfurt",     ex:"Xetra",      tz:"Europe/Berlin",    s:wk([[540,1050]]), hol:DE_HOL},
  {id:"lse",  name:"London",        ex:"LSE",        tz:"Europe/London",    s:wk([[480,990]]), hol:UK_HOL, early:UK_EARLY},
  {id:"nyse", name:"New York",      ex:"NYSE · Nasdaq", tz:NY,              s:wk([[240,570,"ext","Pre-market"],[570,960],[960,1200,"ext","After-hours"]]), hol:US_HOL, early:US_EARLY},
  {id:"ust",  name:"US Treasuries", ex:"cash, NY hours", tz:NY,             s:wk([[480,1020]]), hol:US_HOL, early:BOND_EARLY},
  {id:"cme",  name:"CME Globex",    ex:"futures",    tz:NY,                 s:d => d===6?[]:d===0?[[1080,1440]]:d===5?[[0,1020]]:[[0,1020],[1080,1440]], hol:US_HOL},
  {id:"fx",   name:"FX",            ex:"spot, 24/5", tz:NY,                 s:d => d===6?[]:d===0?[[1020,1440]]:d===5?[[0,1020]]:[[0,1440]]},
];
const ALIASES = {asx:["sydney","australia","asx"],tse:["tokyo","japan","nikkei","tse"],sse:["shanghai","china","sse"],hkex:["hong kong","hang seng","hkex"],
  nse:["mumbai","india","nse"],kase:["almaty","kazakhstan","kase"],xetra:["frankfurt","germany","xetra","dax"],lse:["london","uk","lse","ftse"],
  nyse:["new york","nyse","nasdaq","wall street","us stocks","the market","stock market"],ust:["treasuries","treasury","bonds","bond market"],cme:["futures","cme","globex"],fx:["fx","forex","currencies"]};

function sessionsOn(m, ymd){
  if (m.hol && m.hol.has(ymd)) return [];
  let list = m.s(dowOf(ymd)).map(x => x.slice());
  const e = m.early && m.early[ymd];
  if (e != null){
    list = list.filter(x => x[0] < e && x[2] !== "ext").map(x => [x[0], Math.min(x[1], e), x[2], x[3]]);
  }
  return list;
}
function intervals(m, from, to){
  const out = [];
  let ymd = ymdAdd(partsOf(m.tz, from).ymd, -1);
  const last = ymdAdd(partsOf(m.tz, to).ymd, 1);
  while (ymd <= last){
    const [y,mo,d] = ymd.split("-").map(Number);
    for (const s of sessionsOn(m, ymd)){
      out.push({a:zoned(m.tz,y,mo,d,s[0]), b:zoned(m.tz,y,mo,d,s[1]), ext:s[2]==="ext", label:s[3]||""});
    }
    ymd = ymdAdd(ymd, 1);
  }
  out.sort((p,q) => p.a - q.a);
  const merged = [];
  for (const iv of out){
    const L = merged[merged.length-1];
    if (L && L.ext === iv.ext && iv.a <= L.b + 1000) L.b = Math.max(L.b, iv.b); else merged.push({...iv});
  }
  return merged;
}
function marketStatus(m, now){
  const ivs = intervals(m, now - 2*864e5, now + 9*864e5);
  const cur = ivs.find(iv => now >= iv.a && now < iv.b);
  const nextMain = ivs.find(iv => !iv.ext && iv.a > now);
  if (cur && !cur.ext) return {st:"open", text:`Open · closes in ${dur(cur.b-now)}`, short:"Open", until:cur.b, ivs};
  if (cur && cur.ext){
    if (nextMain && nextMain.a <= cur.b + 1000) return {st:"pre", text:`${cur.label} · opens in ${dur(nextMain.a-now)}`, short:cur.label, until:nextMain.a, ivs};
    return {st:"pre", text:`${cur.label} · ends in ${dur(cur.b-now)}`, short:cur.label, until:cur.b, ivs};
  }
  if (nextMain) return {st:"closed", text:`Closed · opens in ${dur(nextMain.a-now)}`, short:"Closed", until:nextMain.a, ivs};
  return {st:"closed", text:"Closed", short:"Closed", ivs};
}

let tlTz = S.get("cd-tltz", NY);
function tzOf(v){ return v === "local" ? LOCAL_TZ : v; }
function renderSessions(){
  const now = Date.now(), tz = tzOf(tlTz), p = partsOf(tz, now);
  const day0 = zoned(tz, p.y, p.m, p.d, 0), day1 = zoned(tz, p.y, p.m, p.d, 1440), span = day1 - day0;
  const pct = t => ((t - day0) / span * 100).toFixed(3) + "%";
  let html = `<div class="lab" style="min-height:24px"><span class="label">${esc(tz.replace("_"," ").split("/").pop())} time</span></div><div class="hours">`;
  for (let h = 0; h <= 24; h += 3){ if (h > 0 && h < 24) html += `<span style="left:${(h/24*100).toFixed(2)}%">${String(h).padStart(2,"0")}</span>`; }
  html += `<i class="nowline" style="left:${pct(now)}" data-t="${p.hm}"></i></div>`;
  for (const m of MARKETS){
    const st = marketStatus(m, now);
    let segs = "";
    for (const iv of st.ivs){
      const a = Math.max(iv.a, day0), b = Math.min(iv.b, day1);
      if (b <= a) continue;
      const on = now >= iv.a && now < iv.b;
      segs += `<i class="seg${iv.ext?" ext":""}${on?" on":""}" style="left:${pct(a)};width:${((b-a)/span*100).toFixed(3)}%" title="${esc(m.name)} ${clock12(tz,iv.a)}–${clock12(tz,iv.b)}"></i>`;
    }
    let grid = ""; for (let h = 3; h < 24; h += 3) grid += `<i class="grid-l" style="left:${(h/24*100).toFixed(2)}%"></i>`;
    html += `<div class="lab"><b>${esc(m.name)} <small>${esc(m.ex)}</small></b><span class="st ${st.st}" data-m="${m.id}">${esc(st.text)}</span></div><div class="trk">${grid}${segs}<i class="nowline" style="left:${pct(now)}"></i></div>`;
  }
  $("sess").innerHTML = html;
}
function tickSessions(){
  const now = Date.now();
  document.querySelectorAll("#sess .st").forEach(el => {
    const m = MARKETS.find(x => x.id === el.dataset.m); const st = marketStatus(m, now);
    el.textContent = st.text; el.className = "st " + st.st;
  });
  // up next across markets (24h)
  const ev = [];
  for (const m of MARKETS){
    if (m.id === "fx") continue;
    for (const iv of intervals(m, now - 864e5, now + 2*864e5)){
      if (iv.ext && m.id !== "nyse") continue;
      const nm = iv.ext ? `${m.name} ${iv.label.toLowerCase()}` : m.name;
      if (iv.a > now && iv.a - now < 864e5) ev.push({t:iv.a, txt:`${nm} opens`, c:"o"});
      if (iv.b > now && iv.b - now < 864e5 && !(m.id==="cme" && iv.b - iv.a > 864e5)) ev.push({t:iv.b, txt:`${nm} ${iv.ext?"ends":"closes"}`, c:"c"});
    }
  }
  ev.sort((a,b) => a.t - b.t);
  $("next-up").innerHTML = ev.slice(0,5).map(e => `<span class="${e.c}">${esc(e.txt)} · <b>${dur(e.t-now)}</b></span>`).join("");
}
document.querySelectorAll("#tz-tabs button").forEach(b => {
  b.setAttribute("aria-pressed", b.dataset.tz === tlTz);
  b.onclick = () => { tlTz = b.dataset.tz; S.set("cd-tltz", tlTz); document.querySelectorAll("#tz-tabs button").forEach(x => x.setAttribute("aria-pressed", x===b)); renderSessions(); };
});

/* ============================================================ header clock + greeting */
function tickHeader(){
  const now = Date.now(), p = partsOf(NY, now), st = marketStatus(MARKETS.find(m => m.id==="nyse"), now);
  $("ny-big").textContent = p.hms;
  $("nyse-pill").className = "pill " + st.st;
  $("nyse-state").textContent = "NYSE · " + st.text;
  const g = p.h < 5 ? "Working late" : p.h < 12 ? "Good morning" : p.h < 17 ? "Good afternoon" : "Good evening";
  $("greet").textContent = `${g}, ${OWNER_NAME}`;
  const dstr = new Intl.DateTimeFormat("en-US",{timeZone:NY,weekday:"long",month:"long",day:"numeric"}).format(new Date(now));
  const reds = (DATA.radar?.clusters || []).filter(c => c.light === "red").length;
  const nxt = upcomingEvents(now, 1)[0];
  $("greet-sub").textContent = `${dstr} in New York. NYSE: ${st.text.toLowerCase()}.` + (reds ? ` ${reds} red ${reds>1?"stories":"story"} on the radar.` : "") + (nxt ? ` Next: ${nxt.title}${nxt.ts?` at ${clock12(NY,nxt.ts)}`:""}.` : "");
}

/* ============================================================ TradingView */
function tv(host, name, cfg){
  const el = typeof host === "string" ? $(host) : host;
  if (!el) return;
  el.innerHTML = "";
  const c = document.createElement("div"); c.className = "tradingview-widget-container";
  const w = document.createElement("div"); w.className = "tradingview-widget-container__widget"; c.appendChild(w);
  const s = document.createElement("script"); s.type = "text/javascript"; s.async = true;
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-" + name + ".js";
  s.textContent = JSON.stringify(Object.assign({colorTheme:"dark", locale:"en", isTransparent:true}, cfg));
  s.onerror = () => { el.innerHTML = `<div class="empty">Live TradingView data couldn't load here. It works on the published site (armanimachinena.github.io/wallstreet) or when the network allows tradingview.com.</div>`; };
  c.appendChild(s); el.appendChild(c);
}
const T = (s,d) => ({s,d});
const SYM = {
  "s&p":"FOREXCOM:SPXUSD","s and p":"FOREXCOM:SPXUSD","s&p 500":"FOREXCOM:SPXUSD","spx":"FOREXCOM:SPXUSD","nasdaq":"FOREXCOM:NSXUSD","dow":"FOREXCOM:DJI","dow jones":"FOREXCOM:DJI",
  "russell":"TVC:RUT","vix":"TVC:VIX","ten year":"TVC:US10Y","10 year":"TVC:US10Y","10-year":"TVC:US10Y","tens":"TVC:US10Y","two year":"TVC:US02Y","2 year":"TVC:US02Y","2-year":"TVC:US02Y",
  "five year":"TVC:US05Y","5 year":"TVC:US05Y","thirty year":"TVC:US30Y","30 year":"TVC:US30Y","long bond":"TVC:US30Y","bund":"TVC:DE10Y","gilt":"TVC:GB10Y","jgb":"TVC:JP10Y",
  "dollar":"TVC:DXY","dollar index":"TVC:DXY","dxy":"TVC:DXY","euro":"FX:EURUSD","yen":"FX:USDJPY","pound":"FX:GBPUSD","sterling":"FX:GBPUSD","tenge":"FX_IDC:USDKZT","yuan":"FX_IDC:USDCNY",
  "gold":"OANDA:XAUUSD","silver":"OANDA:XAGUSD","copper":"OANDA:XCUUSD","platinum":"OANDA:XPTUSD","palladium":"OANDA:XPDUSD",
  "oil":"TVC:UKOIL","brent":"TVC:UKOIL","crude":"TVC:USOIL","wti":"TVC:USOIL","natural gas":"OANDA:NATGASUSD","nat gas":"OANDA:NATGASUSD","gas":"OANDA:NATGASUSD",
  "wheat":"OANDA:WHEATUSD","corn":"OANDA:CORNUSD","soybeans":"OANDA:SOYBNUSD","soy":"OANDA:SOYBNUSD","sugar":"OANDA:SUGARUSD",
  "bitcoin":"BITSTAMP:BTCUSD","ether":"BITSTAMP:ETHUSD","ethereum":"BITSTAMP:ETHUSD",
  "apple":"NASDAQ:AAPL","microsoft":"NASDAQ:MSFT","nvidia":"NASDAQ:NVDA","amazon":"NASDAQ:AMZN","google":"NASDAQ:GOOGL","alphabet":"NASDAQ:GOOGL","meta":"NASDAQ:META","tesla":"NASDAQ:TSLA",
  "jpmorgan":"NYSE:JPM","jp morgan":"NYSE:JPM","goldman":"NYSE:GS","goldman sachs":"NYSE:GS","morgan stanley":"NYSE:MS","citi":"NYSE:C","citigroup":"NYSE:C","bank of america":"NYSE:BAC",
  "wells fargo":"NYSE:WFC","blackrock":"NYSE:BLK","blackstone":"NYSE:BX","berkshire":"NYSE:BRK.B","walmart":"NYSE:WMT","home depot":"NYSE:HD","target":"NYSE:TGT","disney":"NYSE:DIS",
  "tlt":"NASDAQ:TLT","hyg":"AMEX:HYG","lqd":"AMEX:LQD","emb":"NASDAQ:EMB","kaspi":"NASDAQ:KSPI"
};
const CH = [["TVC:US10Y","10Y"],["TVC:US02Y","2Y"],["FOREXCOM:SPXUSD","S&P"],["TVC:UKOIL","Brent"],["OANDA:XAUUSD","Gold"],["OANDA:XCUUSD","Copper"],["TVC:DXY","DXY"],["BITSTAMP:BTCUSD","BTC"]];
let chartSym = S.get("cd-chart", CH[0][0]);
function drawChart(){
  [...$("chart-tabs").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.s === chartSym));
  tv("w-chart","advanced-chart",{autosize:true,symbol:chartSym,interval:"60",timezone:NY,theme:"dark",style:"1",allow_symbol_change:true,calendar:false,hide_volume:false,
    backgroundColor:"rgba(18,30,39,1)",gridColor:"rgba(34,50,61,.6)",support_host:"https://www.tradingview.com"});
}
$("chart-tabs").innerHTML = CH.map(([s,l]) => `<button type="button" data-s="${s}" aria-pressed="false">${l}</button>`).join("");
[...$("chart-tabs").children].forEach(b => b.onclick = () => setChart(b.dataset.s));
function setChart(sym){ chartSym = sym; S.set("cd-chart", sym); if (inited.markets) drawChart(); }

function newsTape(f){
  const cfg = {width:"100%",height:"100%",displayMode:"regular"};
  if (f === "all") cfg.feedMode = "all_symbols"; else { cfg.feedMode = "market"; cfg.market = f; }
  tv("w-news","timeline",cfg);
}
document.querySelectorAll("#news-tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#news-tabs button").forEach(x => x.setAttribute("aria-pressed", x===b)); newsTape(b.dataset.f); });

const INIT = {
  desk(){
    tv("w-overview","market-overview",{width:"100%",height:"100%",dateRange:"1D",showChart:true,showSymbolLogo:true,showFloatingTooltip:true,
      plotLineColorGrowing:"#5cc48c",plotLineColorFalling:"#f07f72",gridLineColor:"rgba(0,0,0,0)",scaleFontColor:"#8f9ca6",
      belowLineFillColorGrowing:"rgba(92,196,140,.12)",belowLineFillColorFalling:"rgba(240,127,114,.12)",symbolActiveColor:"rgba(214,176,98,.12)",
      tabs:[
        {title:"US",symbols:[T("FOREXCOM:SPXUSD","S&P 500"),T("FOREXCOM:NSXUSD","Nasdaq 100"),T("FOREXCOM:DJI","Dow 30"),T("TVC:RUT","Russell 2000"),T("TVC:VIX","VIX")]},
        {title:"Rates",symbols:[T("TVC:US02Y","UST 2Y"),T("TVC:US05Y","UST 5Y"),T("TVC:US10Y","UST 10Y"),T("TVC:US30Y","UST 30Y"),T("TVC:DE10Y","Bund 10Y"),T("TVC:GB10Y","Gilt 10Y"),T("TVC:JP10Y","JGB 10Y")]},
        {title:"World",symbols:[T("TVC:UKX","FTSE 100"),T("XETR:DAX","DAX"),T("TVC:SX5E","Euro STOXX 50"),T("TVC:NI225","Nikkei 225"),T("TVC:HSI","Hang Seng"),T("SSE:000001","Shanghai")]},
        {title:"Cmdty",symbols:[T("TVC:UKOIL","Brent"),T("TVC:USOIL","WTI"),T("OANDA:NATGASUSD","Nat gas"),T("OANDA:XAUUSD","Gold"),T("OANDA:XAGUSD","Silver"),T("OANDA:XCUUSD","Copper"),T("OANDA:WHEATUSD","Wheat")]},
        {title:"FX",symbols:[T("TVC:DXY","Dollar index"),T("FX:EURUSD","EUR/USD"),T("FX:GBPUSD","GBP/USD"),T("FX:USDJPY","USD/JPY"),T("FX_IDC:USDKZT","USD/KZT")]},
        {title:"Crypto",symbols:[T("BITSTAMP:BTCUSD","Bitcoin"),T("BITSTAMP:ETHUSD","Ether")]}
      ]});
  },
  markets(){
    drawChart();
    tv("w-hot","hotlists",{width:"100%",height:"100%",dateRange:"1D",exchange:"US",showChart:true,showSymbolLogo:true,showFloatingTooltip:false,
      plotLineColorGrowing:"#5cc48c",plotLineColorFalling:"#f07f72",gridLineColor:"rgba(0,0,0,0)",scaleFontColor:"#8f9ca6"});
    const q = (n,d) => ({name:n, displayName:d});
    tv("w-cmd","market-quotes",{width:"100%",height:"100%",showSymbolLogo:true,symbolsGroups:[
      {name:"Energy",symbols:[q("TVC:UKOIL","Brent crude"),q("TVC:USOIL","WTI crude"),q("OANDA:NATGASUSD","Natural gas")]},
      {name:"Metals",symbols:[q("OANDA:XAUUSD","Gold"),q("OANDA:XAGUSD","Silver"),q("OANDA:XPTUSD","Platinum"),q("OANDA:XPDUSD","Palladium"),q("OANDA:XCUUSD","Copper")]},
      {name:"Grains & softs",symbols:[q("OANDA:WHEATUSD","Wheat"),q("OANDA:CORNUSD","Corn"),q("OANDA:SOYBNUSD","Soybeans"),q("OANDA:SUGARUSD","Sugar")]},
      {name:"Commodity FX",symbols:[q("FX_IDC:USDKZT","USD/KZT"),q("FX:AUDUSD","AUD/USD"),q("FX:USDCAD","USD/CAD"),q("FX_IDC:USDBRL","USD/BRL")]}
    ]});
    tv("w-heat","stock-heatmap",{width:"100%",height:"100%",dataSource:"SPX500",blockSize:"market_cap_basic",blockColor:"change",grouping:"sector",hasTopBar:false,isZoomEnabled:true,hasSymbolTooltip:true,isMonoSize:false});
    tv("w-fx","forex-cross-rates",{width:"100%",height:"100%",currencies:["EUR","USD","JPY","GBP","CHF","AUD","CAD","CNY"]});
    drawCurve("curve-big", true);
  },
  events(){ tv("w-cal","events",{width:"100%",height:"100%",importanceFilter:"0,1",countryFilter:"us,eu,gb,jp,cn"}); },
  radar(){ newsTape("all"); },
  street(){}, kit(){}
};
const inited = {};

/* ============================================================ router */
const ORDER = ["desk","street","markets","events","radar","kit"];
let current = "desk";
function go(name){
  if (!ORDER.includes(name)) name = "desk";
  current = name;
  ORDER.forEach(n => { $("s-" + n).hidden = n !== name; });
  document.querySelectorAll(".nav a").forEach(a => { if (a.dataset.s === name) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  if (!inited[name]){ inited[name] = true; try { INIT[name](); } catch(e){ console.error(e); } }
  if (name === "radar"){ $("nav-radar").classList.remove("alert"); markRedSeen(); }
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  document.title = (name === "desk" ? "" : $("s-" + name).dataset.title + " · ") + "WSA";
  window.scrollTo({top:0});
}
window.addEventListener("hashchange", () => go(location.hash.slice(1)));
$("popout").onclick = () => { window.open(location.pathname + "#" + current, "cd-" + current + "-" + Date.now(), "popup,width=1600,height=1000"); };
document.addEventListener("keydown", e => {
  if (e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10); if (n >= 1 && n <= 6){ go(ORDER[n-1]); e.preventDefault(); }
});

/* ============================================================ data */
const DATA = {};
async function load(name){
  try {
    const r = await fetch(`data/${name}.json?t=${Date.now()}`, {cache:"no-store"});
    if (!r.ok) throw new Error(r.status);
    DATA[name] = await r.json();
  } catch(e){ DATA[name] = DATA[name] || null; }
  return DATA[name];
}
function setStatus(){
  const t = DATA.radar?.fetched_at || DATA.wire?.fetched_at;
  $("data-status").textContent = t ? `Feeds refreshed ${ago(t)} ago` : "Feeds will appear after the first refresh run";
}

/* ---- wire */
function renderWire(){
  const j = DATA.wire, el = $("wire");
  if (!j || !j.items || !j.items.length){ el.innerHTML = `<li class="empty">Headlines arrive after the first refresh run (about every 10 minutes).</li>`; return; }
  const now = Date.now();
  el.innerHTML = j.items.slice(0,80).map(x => {
    const age = now - new Date(x.published).getTime();
    return `<li class="${age < 45*60000 ? "fresh" : ""}"><a class="item" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="tm">${ago(x.published)}</span><span><span class="tt">${esc(x.title)}</span><br><span class="src"><b>${esc(x.source)}</b> · ${esc(x.category)}</span></span></a></li>`;
  }).join("");
  $("wire-asof").textContent = "Updated " + ago(j.fetched_at) + " ago";
}

/* ---- radar */
let radFilter = "all";
function clusterHTML(c, mini){
  const lead = c.sources.find(s => s.title === c.title) || c.sources[0];
  const badges = c.sources.map(s => `<a class="${s.desk==="NY"||s.desk==="DC"?"ny":""}" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.outlet)}: ${esc(s.title)}">${esc(s.tag)}</a>`).join("");
  if (mini) return `<div class="rcl mini ${c.light}"><span class="light ${c.light}"></span><div><h3><a href="${esc(lead.url)}" target="_blank" rel="noopener">${esc(c.title)}</a></h3><div class="badges">${badges}</div></div><div class="count">${c.outlets}<small>outlets</small></div></div>`;
  return `<div class="rcl ${c.light}"><span class="light ${c.light}"></span><div><h3><a href="${esc(lead.url)}" target="_blank" rel="noopener">${esc(c.title)}</a></h3>
    <div class="badges">${badges}</div>
    <div class="meta">First seen ${ago(c.first_seen)} ago · latest ${ago(c.last_seen)} ago · ${c.articles} articles${c.last_hour?` · <b style="color:var(--live)">${c.last_hour} in the last hour</b>`:""}</div></div>
    <div class="count">${c.outlets}<small>outlets</small></div></div>`;
}
function renderRadar(){
  const j = DATA.radar;
  const list = $("radar-list"), mini = $("desk-radar");
  if (!j || !j.clusters || !j.clusters.length){
    const msg = `<div class="empty">The radar fills after the first refresh run. It checks about 25 news feeds every 10 minutes.</div>`;
    list.innerHTML = msg; mini.innerHTML = msg; $("breaking").hidden = true; return;
  }
  const cl = j.clusters.filter(c => radFilter === "all" || (radFilter === "red" ? c.light === "red" : c.light !== "green"));
  list.innerHTML = cl.length ? cl.map(c => clusterHTML(c)).join("") : `<div class="empty">Nothing at this level right now. Quiet tape.</div>`;
  mini.innerHTML = j.clusters.slice(0,9).map(c => clusterHTML(c, true)).join("");
  $("radar-foot").textContent = `${j.scanned} articles from the last ${j.window_hours} hours · refreshed ${ago(j.fetched_at)} ago`;
  // breaking banner: freshest red story active in the last 3 hours
  const hot = j.clusters.filter(c => c.light === "red" && Date.now() - new Date(c.last_seen).getTime() < 3*3600e3)[0];
  const b = $("breaking");
  if (hot){ b.hidden = false; b.href = hot.sources[0].url; $("breaking-t").textContent = hot.title; $("breaking-m").textContent = `${hot.outlets} outlets · ${ago(hot.first_seen)} ago`; }
  else b.hidden = true;
  checkRedAlerts(j.clusters.filter(c => c.light === "red"));
}
document.querySelectorAll("#rad-filter button").forEach(b => b.onclick = () => {
  radFilter = b.dataset.l; document.querySelectorAll("#rad-filter button").forEach(x => x.setAttribute("aria-pressed", x===b)); renderRadar(); });

/* ---- alerts */
let alertsOn = S.get("cd-alerts", false), audioCtx = null;
function updAlertBtn(){ $("alerts-btn").textContent = alertsOn ? "Alerts on ✓" : "Turn on alerts"; }
updAlertBtn();
$("alerts-btn").onclick = async () => {
  alertsOn = !alertsOn; S.set("cd-alerts", alertsOn); updAlertBtn();
  if (alertsOn){
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); chime(); } catch(e){}
    try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch(e){}
  }
};
document.addEventListener("pointerdown", () => { if (alertsOn && !audioCtx){ try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} } }, {once:true});
function chime(){
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [880, 1320].forEach((f,i) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0.0001, t+i*.18); g.gain.exponentialRampToValueAtTime(0.15, t+i*.18+.02); g.gain.exponentialRampToValueAtTime(0.0001, t+i*.18+.5);
    o.connect(g).connect(audioCtx.destination); o.start(t+i*.18); o.stop(t+i*.18+.55); });
}
function toast(title, sub, url){
  const d = document.createElement("div"); d.className = "toast";
  d.innerHTML = `<span class="light red"></span><div><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a><small>${esc(sub)}</small></div><button type="button" aria-label="Dismiss">×</button>`;
  d.querySelector("button").onclick = () => d.remove();
  $("toasts").prepend(d); setTimeout(() => d.remove(), 60000);
}
function markRedSeen(){ const reds = (DATA.radar?.clusters||[]).filter(c => c.light==="red").map(c => c.id); const seen = new Set(S.get("cd-seen-red", [])); reds.forEach(id => seen.add(id)); S.set("cd-seen-red", [...seen].slice(-300)); }
function checkRedAlerts(reds){
  const stored = S.get("cd-seen-red", null);
  if (stored === null){ S.set("cd-seen-red", reds.map(c => c.id)); return; }  // first visit: no flood
  const seen = new Set(stored);
  const fresh = reds.filter(c => !seen.has(c.id));
  if (!fresh.length) return;
  fresh.forEach(c => seen.add(c.id)); S.set("cd-seen-red", [...seen].slice(-300));
  if (current !== "radar") $("nav-radar").classList.add("alert");
  fresh.slice(0,3).forEach(c => {
    toast(c.title, `${c.outlets} outlets: ${c.sources.map(s => s.tag).join(", ")}`, c.sources[0].url);
    if (alertsOn){
      chime();
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("WSA · red story", {body:c.title, tag:c.id}); } catch(e){}
    }
    window.dispatchEvent(new CustomEvent("cd:red", {detail:c}));
  });
}

/* ---- social */
const XLIST = [["@NickTimiraos","WSJ chief economics correspondent · the Fed whisperer"],["@LizAnnSonders","Schwab chief investment strategist"],["@DeItaone","Walter Bloomberg · fast headlines"],
  ["@FirstSquawk","Breaking market headlines"],["@elerianm","Mohamed El-Erian"],["@TheStalwart","Joe Weisenthal · Bloomberg Odd Lots"],["@tracyalloway","Tracy Alloway · Bloomberg"],
  ["@charliebilello","Charts on markets & macro"],["@biancoresearch","Jim Bianco · rates & macro"],["@federalreserve","Federal Reserve Board"],["@NewYorkFed","New York Fed"],
  ["@SecScottBessent","US Treasury Secretary"],["@RayDalio","Bridgewater founder"],["@BillAckman","Pershing Square"],["@CathieDWood","ARK Invest"],["@zerohedge","Contrarian market news"]];
$("xlist").innerHTML = XLIST.map(([h,d]) => `<a href="https://x.com/${h.slice(1)}" target="_blank" rel="noopener"><b>${esc(h)}</b><span>${esc(d)}</span></a>`).join("");
function renderSocial(){
  const j = DATA.social;
  if (!j){ ["moves","people","posts"].forEach(id => $(id).innerHTML = `<div class="empty">Arrives after the first refresh run.</div>`); $("trending").innerHTML = `<span class="muted">Arrives after the first refresh run.</span>`; return; }
  $("social-asof").textContent = "Refreshed " + ago(j.fetched_at) + " ago";
  $("trending").innerHTML = (j.trending||[]).length ? j.trending.map(t => `<button type="button" class="chip" data-s="${esc(t.symbol)}" title="${esc(t.title)}"><b>${esc(t.symbol)}</b><span class="muted">${esc((t.title||"").slice(0,22))}</span></button>`).join("") : `<span class="muted">StockTwits didn't answer this round.</span>`;
  $("trending").querySelectorAll("button").forEach(b => b.onclick = () => { setChart(b.dataset.s); go("markets"); });
  $("moves").innerHTML = (j.moves||[]).length ? j.moves.map(m => `<li><a class="item" href="${esc(m.url)}" target="_blank" rel="noopener"><span class="tm">${ago(m.published)}</span><span><span class="tt">${esc(m.title)}</span><br><span class="src"><b>${esc(m.source||"")}</b></span></span></a></li>`).join("") : `<li class="empty">No people moves found this round.</li>`;
  $("people").innerHTML = (j.people||[]).map(p => `<div class="person"><div class="who"><b>${esc(p.name)}</b>${p.x?`<a class="xl" href="https://x.com/${esc(p.x)}" target="_blank" rel="noopener">@${esc(p.x)}</a>`:""}</div><span class="muted" style="font-size:11px">${esc(p.role)}</span>
     ${p.items.length ? p.items.map(i => `<a class="h" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)} <small>· ${esc(i.source||"")} · ${ago(i.published)}</small></a>`).join("") : `<small>No headlines in the last 3 days.</small>`}</div>`).join("");
  $("posts").innerHTML = (j.posts||[]).length ? j.posts.slice(0,40).map(p => `<div class="post"><div class="by"><b>${esc(p.name)}</b><span class="muted">${ago(p.published)}</span></div><p>${esc(p.text)}</p><a href="${esc(p.url)}" target="_blank" rel="noopener">Open on Bluesky · ♥ ${p.likes||0}</a></div>`).join("") : `<div class="empty">No posts this round.</div>`;
}

/* ---- events */
let evFilter = "all";
const KIND_LABEL = {fed:"Fed",data:"Data",earnings:"Earnings",nyc:"NYC",ipo:"IPO",auction:"Auction",conf:"Conference",holiday:"Market hours"};
function allEvents(){
  const items = [...(DATA.events?.items||[]), ...(DATA.live_events?.items||[])];
  const seen = new Set(), out = [];
  for (const e of items){
    const key = e.date + "|" + (e.kind === "earnings" ? (e.title.split(" ")[0]) : e.title.toLowerCase().slice(0,40));
    if (seen.has(key)) continue; seen.add(key);
    const [y,m,d] = e.date.split("-").map(Number);
    const mins = e.time ? (+e.time.slice(0,2))*60 + (+e.time.slice(3,5)) : null;
    out.push({...e, ts: mins != null ? zoned(NY, y, m, d, mins) : null, day0: zoned(NY, y, m, d, 0)});
  }
  out.sort((a,b) => (a.day0 - b.day0) || ((a.ts ?? a.day0 + 86399e3) - (b.ts ?? b.day0 + 86399e3)));
  return out;
}
function passes(e){ if (evFilter === "all") return true; if (evFilter === "nyc") return !!e.nyc; return e.kind === evFilter; }
function evHTML(e, now, opts={}){
  const past = e.ts ? now > e.ts + 3600e3 : false, live = e.ts && now >= e.ts && now <= e.ts + 3600e3;
  const t = e.ts ? clock12(NY, e.ts) : (e.kind === "holiday" ? "All day" : "TBA");
  const sub = opts.date ? new Intl.DateTimeFormat("en-US",{timeZone:NY,weekday:"short",month:"short",day:"numeric"}).format(new Date(e.day0 + 12*3600e3)) : (e.ts && e.ts > now && e.ts - now < 864e5 ? "in " + dur(e.ts - now) : (live ? "now" : ""));
  const inner = `<span class="t">${opts.date ? `<b>${esc(sub)}</b>${esc(t)}` : `<b>${esc(t)}</b>${esc(sub)}`}</span><span><span class="ti">${esc(e.title)}</span><span class="kind ${e.kind}">${KIND_LABEL[e.kind]||e.kind}</span>${e.nyc && e.kind !== "nyc" ? `<span class="nycpin">● NYC</span>` : ""}<br><span class="wh">${esc(e.where||"")}${e.note?` · ${esc(e.note)}`:""}</span></span>`;
  const cls = `ev${past?" past":""}${live?" now":""}`;
  return e.url ? `<a class="${cls}" href="${esc(e.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
}
function dayEvents(offset){
  const now = Date.now(), p = partsOf(NY, now), ymd = ymdAdd(p.ymd, offset);
  return allEvents().filter(e => e.date === ymd);
}
function upcomingEvents(now, n){
  return allEvents().filter(e => (e.ts ?? e.day0 + 86399e3) > now).slice(0, n);
}
function renderEvents(){
  const now = Date.now(), p = partsOf(NY, now);
  const fmt = ymd => { const [y,m,d] = ymd.split("-").map(Number); return new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric"}).format(new Date(Date.UTC(y,m-1,d))); };
  const today = p.ymd, tmrw = ymdAdd(today, 1);
  $("today-d").textContent = fmt(today); $("tmrw-d").textContent = fmt(tmrw);
  const evs = allEvents();
  const empty = msg => `<div class="empty">${msg}</div>`;
  const tl = evs.filter(e => e.date === today && passes(e)), tm = evs.filter(e => e.date === tmrw && passes(e));
  const wkend = ymd => [0,6].includes(dowOf(ymd));
  $("ev-today").innerHTML = tl.length ? tl.map(e => evHTML(e, now)).join("") : empty(wkend(today) ? "Weekend. US markets are closed." : "Nothing scheduled for this filter.");
  $("ev-tmrw").innerHTML = tm.length ? tm.map(e => evHTML(e, now)).join("") : empty(wkend(tmrw) ? "Weekend. US markets are closed." : "Nothing scheduled for this filter.");
  const lim = now + 45*864e5;
  const nyc = evs.filter(e => e.nyc && e.kind !== "holiday" && (e.ts ?? e.day0 + 86399e3) > now && e.day0 < lim);
  $("ev-nyc").innerHTML = nyc.length ? nyc.map(e => evHTML(e, now, {date:true})).join("") : empty("No in-person New York events on file. See the directories below.");
  const lim60 = now + 60*864e5; let html = "", lastDay = "";
  for (const e of evs){
    if ((e.ts ?? e.day0 + 86399e3) < now || e.day0 > lim60 || !passes(e)) continue;
    if (e.date !== lastDay){ lastDay = e.date; html += `<div class="dayhead">${fmt(e.date)}</div>`; }
    html += evHTML(e, now);
  }
  $("ev-all").innerHTML = html || empty("Nothing coming up for this filter.");
  // desk panel: today + tomorrow (all kinds)
  let d = "";
  const block = (label, list) => { if (!list.length) return; d += `<div class="dayhead">${label}</div>` + list.map(e => evHTML(e, now)).join(""); };
  block("Today · " + fmt(today), evs.filter(e => e.date === today));
  block("Tomorrow · " + fmt(tmrw), evs.filter(e => e.date === tmrw));
  if (!d){ const nx = upcomingEvents(now, 6); block("Next up", nx); }
  $("desk-today").innerHTML = d || empty("Nothing on file. Check the Events screen.");
}
document.querySelectorAll("#ev-filter button").forEach(b => b.onclick = () => {
  evFilter = b.dataset.k; document.querySelectorAll("#ev-filter button").forEach(x => x.setAttribute("aria-pressed", x===b)); renderEvents(); });
const DIRS = [["Bloomberg Live","Bloomberg's conferences & summits","https://www.bloomberglive.com/"],["Reuters Events","Reuters NEXT and industry events","https://www.reuters.com/events/"],
  ["NYT DealBook","DealBook Summit & newsletter","https://www.nytimes.com/dealbook"],["CFA Society New York","Talks, groups, networking","https://cfany.org/events/"],
  ["Museum of American Finance","Talks on Wall Street history","https://www.moaf.org/"],["New York Fed events","Conferences & speeches","https://www.newyorkfed.org/newsevents/events"],
  ["Fed calendar","All Fed speakers & releases","https://www.federalreserve.gov/newsevents/calendar.htm"],["SIFMA events","Fixed income & markets industry","https://www.sifma.org/events/"],
  ["Nasdaq IPO calendar","Upcoming listings","https://www.nasdaq.com/market-activity/ipos"],["Earnings calendar","Nasdaq · daily","https://www.nasdaq.com/market-activity/earnings"],
  ["Treasury auctions","Upcoming & results","https://www.treasurydirect.gov/auctions/upcoming/"],["Luma · NYC finance","Meetups & founder events","https://lu.ma/discover"],
  ["Eventbrite · NYC finance","Talks & networking","https://www.eventbrite.com/d/ny--new-york/finance/"],["Meetup · NYC investing","Community groups","https://www.meetup.com/find/?keywords=finance&location=us--ny--New%20York"],
  ["Women in Finance NY","100 Women in Finance","https://100women.org/events/"],["92NY talks","Business & economics talks","https://www.92ny.org/"]];
$("ev-dirs").innerHTML = DIRS.map(([n,d,u]) => `<a href="${u}" target="_blank" rel="noopener"><b>${esc(n)}</b><span>${esc(d)}</span></a>`).join("");

/* ---- curve & credit */
const TENOR_Y = t => { const m = /^([\d.]+)\s*([MY])/.exec(t); if (!m) return null; return m[2] === "M" ? +m[1]/12 : +m[1]; };
function drawCurve(id, big){
  const j = DATA.curve, svg = $(id); if (!svg) return;
  if (!j || !j.latest){ svg.innerHTML = `<text x="16" y="40" fill="var(--muted)" font-size="13">The curve arrives after the first refresh run.</text>`; return; }
  const W = big ? 760 : 360, H = big ? 330 : 210, L = 40, R = 14, Tp = 18, B = 30;
  const sets = [["month",j.month,"var(--faint)","2 4"],["week",j.week,"var(--muted)","5 4"],["latest",j.latest,"var(--brass)",""]];
  const all = sets.flatMap(s => s[1].points.map(p => p.y));
  let lo = Math.floor((Math.min(...all) - .05) * 4) / 4, hi = Math.ceil((Math.max(...all) + .05) * 4) / 4;
  const step = hi - lo > 1.5 ? .5 : .25;
  const xs = t => { const yv = TENOR_Y(t); return L + Math.sqrt(yv) / Math.sqrt(30) * (W - L - R); };
  const ys = v => Tp + (hi - v) / (hi - lo) * (H - Tp - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W-R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--rule)"/><text x="${L-6}" y="${ys(v)+4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${v.toFixed(2)}</text>`;
  const ticks = big ? ["1M","3M","6M","1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"] : ["3M","1Y","2Y","5Y","10Y","30Y"];
  ticks.forEach(t => { if (TENOR_Y(t) != null) g += `<text x="${xs(t)}" y="${H-10}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${t}</text>`; });
  let lines = "";
  for (const [k, set, col, dash] of sets){
    const pts = set.points.filter(p => TENOR_Y(p.tenor) != null);
    const d = pts.map((p,i) => (i?"L":"M") + xs(p.tenor).toFixed(1) + " " + ys(p.y).toFixed(1)).join(" ");
    lines += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${k==="latest"?2.4:1.4}" ${dash?`stroke-dasharray="${dash}"`:""}/>`;
    if (k === "latest") pts.forEach(p => { lines += `<circle cx="${xs(p.tenor)}" cy="${ys(p.y)}" r="${big?3:2.2}" fill="var(--card)" stroke="${col}" stroke-width="1.6"><title>${p.tenor}: ${p.y.toFixed(2)}%</title></circle>`; });
  }
  const val = (set, t) => (set.points.find(p => p.tenor === t) || {}).y;
  const two = val(j.latest,"2Y"), ten = val(j.latest,"10Y"), thirty = val(j.latest,"30Y");
  const leg = `<g font-size="11" font-family="IBM Plex Sans,sans-serif"><text x="${L+4}" y="${Tp-4}" fill="var(--brass)">— ${j.latest.date}</text><text x="${L+(big?110:96)}" y="${Tp-4}" fill="var(--muted)">- - 1w</text><text x="${L+(big?160:140)}" y="${Tp-4}" fill="var(--faint)">··· 1m</text>
    ${two!=null&&ten!=null?`<text x="${W-R}" y="${Tp-4}" text-anchor="end" fill="var(--ink)" font-family="IBM Plex Mono,monospace">2s10s ${((ten-two)*100).toFixed(0)} bp${big&&thirty!=null?` · 10Y ${ten.toFixed(2)}% · 30Y ${thirty.toFixed(2)}%`:""}</text>`:""}</g>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = g + lines + leg;
  if (big) $("curve-asof").textContent = `As of ${j.latest.date}`;
}
function spark(points, w=120, h=30){
  const v = points.map(p => p[1]), lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const d = v.map((y,i) => (i?"L":"M") + (i/(v.length-1)*w).toFixed(1) + " " + (h - 3 - (y-lo)/r*(h-6)).toFixed(1)).join(" ");
  const ly = h - 3 - (v[v.length-1]-lo)/r*(h-6);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h} Z" fill="var(--brass)" fill-opacity=".08"/><path d="${d}" fill="none" stroke="var(--brass)" stroke-width="1.4"/><circle cx="${w}" cy="${ly}" r="2.5" fill="var(--brass)"/></svg>`;
}
function renderCredit(){
  const j = DATA.credit;
  const rows = (only) => {
    if (!j || !j.series?.length) return `<div class="empty">Credit spreads arrive after the first refresh run.</div>`;
    return j.series.filter(s => !only || only.includes(s.id)).map(s => {
      const pts = s.points, last = pts[pts.length-1][1], prev = pts[Math.max(0, pts.length-22)][1], ch = last - prev;
      const isSpread = s.id.startsWith("BAML");
      const chTxt = s.unit === "%" ? `${ch>=0?"+":"−"}${Math.abs(ch*100).toFixed(0)} bp 1m` : `${ch>=0?"+":"−"}${Math.abs(ch).toFixed(1)} 1m`;
      const cls = isSpread ? (ch > 0 ? "down" : "up") : "muted";
      return `<div class="spark"><div><b>${esc(s.label)}</b><br><span class="asof">${esc(pts[pts.length-1][0])}</span></div>${spark(pts)}<div class="v">${s.unit==="%"?last.toFixed(2)+"%":last.toFixed(1)}<small class="${cls}">${chTxt}</small></div></div>`;
    }).join("");
  };
  $("credit").innerHTML = rows();
  $("credit-mini").innerHTML = rows(["SOFR","BAMLH0A0HYM2","BAMLC0A0CM"]);
}

/* ============================================================ live TV */
let ch = "UCIALMKvObZNtJ6AmdCLP7Lg", playing = false;
function tvPlay(){ playing = true; if (location.hostname.endsWith("claude.ai") || location.hostname.includes("claudeusercontent")){ $("tv").innerHTML = `<div class="empty" style="text-align:center">Video can't play inside this preview. On the published site the live stream plays here. Meanwhile use the links below.</div>`; return; } $("tv").innerHTML =`<iframe src="https://www.youtube.com/embed/live_stream?channel=${ch}&autoplay=1&mute=1" title="Live financial TV" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; }
function tvStop(){ playing = false; $("tv").innerHTML = `<button type="button" class="btn" id="tv-start">▶ Play live stream</button>`; $("tv-start").onclick = tvPlay; }
$("tv-start").onclick = tvPlay;
document.querySelectorAll("#tv-tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#tv-tabs button").forEach(x => x.setAttribute("aria-pressed", x===b)); ch = b.dataset.ch; if (playing) tvPlay(); });

/* ============================================================ kit: bond math */
let mode = "price";
const fmt = (v,d) => v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
function cfs(c,n,f){ const k = Math.max(1, Math.round(n*f)), cp = c/f, a = []; for (let i=1;i<=k;i++) a.push([i, cp + (i===k?100:0)]); return a; }
function price(c,y,n,f){ return cfs(c,n,f).reduce((s,[i,cf]) => s + cf/Math.pow(1+y/100/f, i), 0); }
function solveY(c,p,n,f){ let lo=-5, hi=60; for (let i=0;i<120;i++){ const m=(lo+hi)/2; price(c,m,n,f) > p ? lo=m : hi=m; } return (lo+hi)/2; }
function risk(c,y,n,f){ const r=y/100/f, P=price(c,y,n,f); let mac=0, cx=0; cfs(c,n,f).forEach(([i,cf]) => { const pv=cf/Math.pow(1+r,i); mac+=(i/f)*pv; cx+=cf*i*(i+1)/Math.pow(1+r,i+2); }); mac/=P; const md=mac/(1+r); cx/=P*f*f; return {P,mac,md,cx,dv:md*P/10000}; }
function setMode(m){ mode=m; $("m-price").setAttribute("aria-pressed", m==="price"); $("m-yield").setAttribute("aria-pressed", m==="yield"); $("f-ytm").hidden = m!=="price"; $("f-px").hidden = m!=="yield"; calc(); }
$("m-price").onclick = () => setMode("price"); $("m-yield").onclick = () => setMode("yield");
document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { const [c,n,y] = b.dataset.p.split(","); $("b-cpn").value=c; $("b-yrs").value=n; $("b-ytm").value=y; setMode("price"); });
["b-cpn","b-yrs","b-ytm","b-px","b-freq"].forEach(id => $(id).addEventListener("input", calc));
function calc(){
  const c = parseFloat($("b-cpn").value), n = parseFloat($("b-yrs").value), f = parseInt($("b-freq").value,10);
  if (!(c>=0) || !(n>0)) return; let y, P;
  if (mode === "price"){ y = parseFloat($("b-ytm").value); if (!isFinite(y)) return; P = price(c,y,n,f); $("b-px").value = P.toFixed(2); }
  else { P = parseFloat($("b-px").value); if (!(P>0)) return; y = solveY(c,P,n,f); $("b-ytm").value = y.toFixed(3); }
  const R = risk(c,y,n,f);
  $("o-px").textContent = fmt(R.P,3); $("o-pxd").textContent = R.P>100.0005 ? "premium to par" : R.P<99.9995 ? "discount to par" : "at par";
  $("o-y").textContent = y.toFixed(3)+"%"; $("o-cy").textContent = "current "+(c/R.P*100).toFixed(3)+"%";
  $("o-md").textContent = R.md.toFixed(2); $("o-mac").textContent = "Macaulay "+R.mac.toFixed(2)+"y";
  $("o-cx").textContent = R.cx.toFixed(1); $("o-dv").textContent = R.dv.toFixed(4); $("o-dvm").textContent = "$"+fmt(R.dv*100,0)+" per $1mm";
  $("shock").innerHTML = [-100,-50,-25,25,50,100].map(bp => { const dy=bp/1e4, p=(-R.md*dy+.5*R.cx*dy*dy)*100; return `<div><span>${bp>0?"+":"−"}${Math.abs(bp)} bp</span><b class="${p>=0?"up":"down"}">${p>=0?"+":"−"}${Math.abs(p).toFixed(2)}%</b></div>`; }).join("");
  pyCurve(c,n,f,y,R);
}
function pyCurve(c,n,f,y0,R){
  const W=900,H=220,L=48,Rm=16,Tp=14,B=34,lo=Math.max(0,y0-3),hi=y0+3,pts=[];
  for (let i=0;i<=60;i++){ const y=lo+(hi-lo)*i/60; pts.push([y,price(c,y,n,f)]); }
  const pmin=Math.min(...pts.map(a=>a[1])), pmax=Math.max(...pts.map(a=>a[1])), st=pmax-pmin>40?10:pmax-pmin>15?5:2;
  const a=Math.floor(pmin/st)*st, b=Math.ceil(pmax/st)*st, X=y=>L+(y-lo)/(hi-lo)*(W-L-Rm), Y=p=>Tp+(b-p)/(b-a)*(H-Tp-B);
  let g="";
  for (let p=a;p<=b+1e-9;p+=st) g+=`<line x1="${L}" x2="${W-Rm}" y1="${Y(p)}" y2="${Y(p)}" stroke="var(--rule)"/><text x="${L-8}" y="${Y(p)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${p}</text>`;
  for (let k=Math.ceil(lo);k<=Math.floor(hi);k++) g+=`<text x="${X(k)}" y="${H-12}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${k}%</text>`;
  const path = pts.map(([y,p],i) => (i?"L":"M")+X(y).toFixed(1)+" "+Y(p).toFixed(1)).join(" ");
  const tp = y => R.P*(1-R.md*(y-y0)/100);
  $("pyc").innerHTML = `<defs><clipPath id="clp"><rect x="${L}" y="${Tp}" width="${W-L-Rm}" height="${H-Tp-B}"/></clipPath></defs>${g}<line x1="${L}" x2="${W-Rm}" y1="${H-B}" y2="${H-B}" stroke="var(--muted)"/>
  <g clip-path="url(#clp)"><path d="${path} L${X(hi)} ${H-B} L${X(lo)} ${H-B} Z" fill="var(--brass)" fill-opacity=".1"/><line x1="${X(y0-1.5)}" y1="${Y(tp(y0-1.5))}" x2="${X(y0+1.5)}" y2="${Y(tp(y0+1.5))}" stroke="var(--muted)" stroke-dasharray="4 4"/><path d="${path}" fill="none" stroke="var(--brass)" stroke-width="2.2"/></g>
  <circle cx="${X(y0)}" cy="${Y(R.P)}" r="5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>
  <text x="${Math.min(X(y0)+10,W-170)}" y="${Math.max(Y(R.P)-10,Tp+12)}" font-size="12" fill="var(--ink)" font-family="IBM Plex Mono,monospace">${R.P.toFixed(2)} @ ${y0.toFixed(2)}%</text>
  <text x="${W-Rm}" y="${Tp+10}" text-anchor="end" font-size="11" fill="var(--muted)">Price vs yield · dashed = duration estimate</text>`;
}
calc();

/* ============================================================ kit: lexicon & links */
const G = [
["Bonds","Accrued interest","Coupon earned since the last payment. Dirty price = clean price + accrued."],
["Bonds","Basis point (bp)","0.01%. A move from 4.90% to 5.00% is 10 bp."],
["Bonds","Bullet","Bond that repays all principal at maturity."],
["Bonds","Callable","Issuer may redeem early at set prices; quote yield-to-worst."],
["Bonds","Convexity","Curvature of price vs yield; positive convexity cushions losses when yields rise."],
["Bonds","Covenant","Promise in the indenture, e.g. a leverage cap. High yield carries more."],
["Bonds","Curve steepener","Long yields rise relative to short ones; 2s10s widens."],
["Bonds","DV01","Dollar price change for a 1 bp move; the unit traders size risk in."],
["Bonds","Duration","Modified duration: % price change for a 1% move in yield."],
["Bonds","FRN","Floating-rate note; coupon resets off SOFR plus a fixed spread."],
["Bonds","G-spread","Bond yield minus the interpolated Treasury yield."],
["Bonds","High yield","Rated below BBB−/Baa3; junk or spec grade."],
["Bonds","Investment grade","BBB−/Baa3 or better."],
["Bonds","New-issue concession","Extra yield a new bond pays over the issuer's existing curve to get the deal done."],
["Bonds","OAS","Option-adjusted spread: spread after removing embedded options."],
["Bonds","On-the-run","The most recently issued Treasury at a maturity; most liquid."],
["Bonds","Par","Price of 100; coupon equals yield."],
["Bonds","Repo","Short-term secured borrowing against bonds."],
["Bonds","SOFR","Secured Overnight Financing Rate; the US benchmark after LIBOR."],
["Bonds","Tail","When a Treasury auction clears at a higher yield than the when-issued level: weak demand."],
["Bonds","Bid-to-cover","Bids received ÷ amount sold at an auction. Higher means stronger demand."],
["Bonds","Tights / wides","Spreads at their narrowest / widest."],
["Bonds","Yield to worst","Lowest yield across all call dates and maturity."],
["Bonds","YTM","Discount rate that makes PV of cash flows equal the price."],
["Banking","Accretion / dilution","Whether a deal raises or lowers the buyer's EPS."],
["Banking","Bookrunner","Bank that runs the order book on a deal; “lead left” is top."],
["Banking","Comps","Comparable-company valuation using trading multiples (EV/EBITDA, P/E)."],
["Banking","DCF","Discounted cash flow: value from projected free cash flow and a terminal value."],
["Banking","Fairness opinion","Bank's letter that a deal price is fair to shareholders."],
["Banking","Greenshoe","Option for underwriters to sell up to 15% more shares in an IPO."],
["Banking","LBO","Buyout financed mostly with debt, paid down from the target's cash flow."],
["Banking","Pitch book","Deck bankers bring to a client: situation, valuation, ideas."],
["Banking","Precedents","Valuation from multiples paid in past comparable deals."],
["Banking","Roadshow","Meetings where management markets a deal to investors."],
["Banking","Tombstone","Notice or plaque marking a closed deal and the banks on it."],
["Banking","Synergies","Cost savings or revenue gains expected from combining two companies."],
["Banking","Lock-up","Period after an IPO when insiders can't sell shares, usually 180 days."],
["Markets","Bid / offer","Price a dealer buys at / sells at; the gap is the spread."],
["Markets","Flow","Client buying and selling hitting the desk."],
["Markets","Risk-on / risk-off","Markets favouring stocks and credit / havens like Treasuries, gold, yen."],
["Markets","Short squeeze","Rapid rise as short sellers rush to buy back."],
["Markets","Hawkish / dovish","Central bank leaning toward higher / lower rates."],
["Markets","Dot plot","FOMC members' rate projections, published quarterly."],
["Markets","VIX","Implied 30-day volatility of the S&P 500; the “fear gauge”."],
["Markets","Basis","Difference between a futures price and the cash price."],
["Markets","BMO / AMC","Before market open / after market close: when a company reports earnings."],
["Commodities","Backwardation","Futures below spot; signals tight near-term supply."],
["Commodities","Contango","Futures above spot; storage and carry costs priced in."],
["Commodities","Brent / WTI","Global and US crude benchmarks; the spread tracks transport and supply."],
["Commodities","Crack spread","Refining margin: product prices minus crude cost."],
["Commodities","Roll yield","Gain or loss from rolling futures into the next contract."],
["Commodities","COT report","CFTC weekly positioning of commercials and speculators."],
["Microfinance","MFI","Microfinance institution lending small sums to low-income borrowers."],
["Microfinance","MIV","Microfinance investment vehicle: fund lending to MFIs."],
["Microfinance","PAR30","Portfolio at risk over 30 days; key asset-quality ratio."],
["Microfinance","OSS","Operational self-sufficiency; above 100% the MFI covers its costs."],
["Microfinance","Group lending","Joint-liability loans to a group, which substitutes for collateral."],
["Microfinance","DFI","Development finance institution: IFC, EBRD, FMO, Proparco."],
["Microfinance","Social bond","Proceeds fund social projects; follows ICMA principles."],
["Microfinance","Over-indebtedness","Borrowers holding more loans than they can repay; a systemic MFI risk."]
];
const cats = ["All", ...new Set(G.map(x => x[0]))]; let cat = "All";
$("g-cats").innerHTML = cats.map(c => `<button type="button" aria-pressed="${c==="All"}" data-c="${c}">${c}</button>`).join("");
$("g-cats").querySelectorAll("button").forEach(b => b.onclick = () => { cat = b.dataset.c; $("g-cats").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x===b)); lex(); });
$("g-count").textContent = G.length + " terms";
function lex(){
  const q = $("g-q").value.trim().toLowerCase();
  const hit = G.filter(([c,t,d]) => (cat==="All"||c===cat) && (!q || t.toLowerCase().includes(q) || d.toLowerCase().includes(q)));
  $("gl").innerHTML = hit.length ? hit.map(([c,t,d]) => `<li><b>${t}</b><span class="k">${c}</span> <span>— ${d}</span></li>`).join("") : `<li class="empty">No term matches “${esc(q)}”. Try a shorter word.</li>`;
}
$("g-q").addEventListener("input", lex); lex();
function links(id, l){ $(id).innerHTML = l.map(([n,d,u]) => `<a href="${u}" target="_blank" rel="noopener"><b>${esc(n)}</b><span>${esc(d)}</span></a>`).join(""); }
links("data",[["FRED","Every US macro series","https://fred.stlouisfed.org/"],["UST yield curve","Daily par curve","https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"],
  ["SOFR","NY Fed reference rates","https://www.newyorkfed.org/markets/reference-rates/sofr"],["FINRA TRACE","Corporate bond trades","https://www.finra.org/finra-data/fixed-income"],
  ["EMMA","Municipal bonds","https://emma.msrb.org/"],["SEC EDGAR","Filings & prospectuses","https://www.sec.gov/edgar/search/"],["EIA weekly","Crude inventories","https://www.eia.gov/petroleum/supply/weekly/"],
  ["CFTC COT","Futures positioning","https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"],["World Bank Pink Sheet","Commodity prices","https://www.worldbank.org/en/research/commodity-markets"],["LME","Base metals","https://www.lme.com/"]]);
links("mfi",[["CGAP","Inclusion research","https://www.cgap.org/"],["Symbiotics","MFI bond arranger","https://symbioticsgroup.com/"],["BlueOrchard","Impact credit","https://www.blueorchard.com/"],
  ["Global Findex","World Bank data","https://www.worldbank.org/en/publication/globalfindex"],["ICMA","Social Bond Principles","https://www.icmagroup.org/sustainable-finance/the-principles-guidelines-and-handbooks/social-bond-principles-sbp/"],["IFC","Financial institutions","https://www.ifc.org/"]]);

/* ---- watchlist & notes */
let wl = S.get("cd-wl3", ["NYSE:JPM","NYSE:GS","NASDAQ:TLT","AMEX:HYG","AMEX:LQD","NASDAQ:EMB"]);
function drawWL(){
  $("wl").innerHTML = wl.length ? wl.map((t,i) => `<span class="chipx"><button type="button" class="go" data-s="${esc(t)}">${esc(t)}</button><button type="button" class="x" data-i="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join("") : `<span class="muted">Add a ticker to start.</span>`;
  $("wl").querySelectorAll(".go").forEach(b => b.onclick = () => { setChart(b.dataset.s); go("markets"); });
  $("wl").querySelectorAll(".x").forEach(b => b.onclick = () => { wl.splice(+b.dataset.i,1); S.set("cd-wl3", wl); drawWL(); });
}
function addWatch(sym){ sym = String(sym).trim().toUpperCase().replace(/[^A-Z0-9.:!_\-]/g,""); if (sym && !wl.includes(sym)){ wl.push(sym); S.set("cd-wl3", wl); drawWL(); } return sym; }
$("wl-form").addEventListener("submit", e => { e.preventDefault(); addWatch($("wl-in").value); $("wl-in").value = ""; });
drawWL();
$("notes").value = S.get("cd-notes", ""); let nt;
function saveNotes(){ $("n-saved").textContent = S.set("cd-notes", $("notes").value) ? "Saved " + new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "Browser blocks saving"; }
$("notes").addEventListener("input", () => { clearTimeout(nt); nt = setTimeout(saveNotes, 400); });
function addNote(text){ const stamp = new Intl.DateTimeFormat("en-US",{timeZone:NY,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date()); $("notes").value = `• ${stamp} — ${text}\n` + $("notes").value; saveNotes(); }

/* ============================================================ boot & refresh loops */
tv("tape","ticker-tape",{displayMode:"adaptive",showSymbolLogo:true,symbols:[
  {proName:"FOREXCOM:SPXUSD",title:"S&P 500"},{proName:"FOREXCOM:NSXUSD",title:"Nasdaq 100"},{proName:"FOREXCOM:DJI",title:"Dow"},
  {proName:"TVC:US02Y",title:"UST 2Y"},{proName:"TVC:US10Y",title:"UST 10Y"},{proName:"TVC:US30Y",title:"UST 30Y"},{proName:"TVC:DXY",title:"DXY"},
  {proName:"OANDA:XAUUSD",title:"Gold"},{proName:"TVC:UKOIL",title:"Brent"},{proName:"TVC:USOIL",title:"WTI"},{proName:"OANDA:XCUUSD",title:"Copper"},
  {proName:"FX:EURUSD",title:"EUR/USD"},{proName:"FX:USDJPY",title:"USD/JPY"},{proName:"FX_IDC:USDKZT",title:"USD/KZT"},{proName:"BITSTAMP:BTCUSD",title:"Bitcoin"},{proName:"TVC:VIX",title:"VIX"}]});

go(location.hash.slice(1) || "desk");
renderSessions(); tickSessions(); tickHeader();
setInterval(() => { tickHeader(); }, 1000);
setInterval(() => { tickSessions(); }, 15000);
setInterval(() => { renderSessions(); }, 60000);
setInterval(() => { renderEvents(); }, 60000);

async function refreshFast(){ await Promise.all([load("radar"), load("wire")]); renderRadar(); renderWire(); setStatus(); }
async function refreshSlow(){ await Promise.all([load("social"), load("live_events"), load("events")]); renderSocial(); renderEvents(); }
async function refreshDaily(){ await Promise.all([load("curve"), load("credit")]); drawCurve("curve-mini"); if (inited.markets) drawCurve("curve-big", true); renderCredit(); }
(async () => { await Promise.all([refreshFast(), refreshSlow(), refreshDaily()]); tickHeader(); window.dispatchEvent(new Event("cd:ready")); })();
setInterval(refreshFast, 2*60000);
setInterval(refreshSlow, 10*60000);
setInterval(refreshDaily, 60*60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden){ refreshFast(); renderSessions(); tickSessions(); } });

/* ============================================================ API for Jarvis */
window.CD = {
  OWNER_NAME, NY, ORDER, SYM, MARKETS, ALIASES, G,
  go, current: () => current, setChart, addNote, addWatch, partsOf, clock12, dur,
  status: id => marketStatus(MARKETS.find(m => m.id === id), Date.now()),
  radar: () => DATA.radar?.clusters || [],
  dayEvents, upcoming: n => upcomingEvents(Date.now(), n),
  tv: on => { if (on){ go("desk"); tvPlay(); } else tvStop(); },
  setAlerts: on => { if (on !== alertsOn) $("alerts-btn").click(); },
};
})();
