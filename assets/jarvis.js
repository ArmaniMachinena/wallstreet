/* Jarvis — a small voice assistant for WSA.
   Speech recognition: Web Speech API (Chrome, Edge, Safari 17+). Replies: speechSynthesis.
   Click the orb (or press J) to give one command; tick "Always listening" to wake it by saying "Jarvis". */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const CD = window.CD;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const S = {get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},
           set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

const orb = $("orb"), panel = $("jp"), logEl = $("jlog"), heard = $("heard"), stateEl = $("orb-state");
const wakeBox = $("j-wake"), speakBox = $("j-speak"), alertBox = $("j-alerts");
wakeBox.checked = S.get("j-wake", false); speakBox.checked = S.get("j-speak", true); alertBox.checked = S.get("j-alerts", false);

let state = "idle";          // idle | listening | thinking | speaking
let rec = null, wantOn = false, oneShot = false, awaitUntil = 0, speaking = false, level = 0;

/* ------------------------------------------------------------ log & speech */
function log(text, who){
  const d = document.createElement("div"); d.className = who === "u" ? "u" : "j" + (who === "err" ? " err" : ""); d.textContent = text;
  logEl.appendChild(d); while (logEl.children.length > 40) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
let voice = null;
function pickVoice(){
  const vs = speechSynthesis.getVoices(); if (!vs.length) return;
  const pref = ["Google UK English Male","Daniel","Microsoft Ryan Online (Natural) - English (United Kingdom)","Microsoft George - English (United Kingdom)","Arthur","Google UK English Female","Google US English"];
  voice = pref.map(n => vs.find(v => v.name === n)).find(Boolean) || vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, opts={}){
  log(text, opts.err ? "err" : "j");
  if (!speakBox.checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/·/g, ",").replace(/\bbp\b/g, "basis points").replace(/\bUST\b/g, "Treasury"));
  if (voice) u.voice = voice; u.rate = 1.03; u.pitch = .95;
  u.onstart = () => { speaking = true; setState("speaking"); };
  u.onend = u.onerror = () => { speaking = false; setState(wantOn ? "listening" : "idle"); };
  speechSynthesis.speak(u);
}
function showHeard(t){ heard.textContent = "“" + t + "”"; heard.hidden = false; clearTimeout(showHeard.t); showHeard.t = setTimeout(() => heard.hidden = true, 3500); }

/* ------------------------------------------------------------ recognition */
function setState(s){
  state = s; orb.classList.toggle("listening", s === "listening");
  stateEl.textContent = s === "listening" ? (wakeBox.checked && !oneShot ? "Say “Jarvis”" : "Listening") : s === "speaking" ? "Speaking" : s === "thinking" ? "…" : "Jarvis";
  $("j-mic").textContent = !SR ? "Voice needs Chrome, Edge or Safari" : s === "listening" ? "Listening…" : "Voice ready";
}
function startRec(){
  if (!SR){ panel.hidden = false; say("Voice recognition isn't available in this browser. Chrome or Edge work best. You can type commands below.", {err:true}); return; }
  if (rec) return;
  rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.continuous = wakeBox.checked && !oneShot;
  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i], text = r[0].transcript.trim();
      level = 1;
      if (!r.isFinal){ if (!wakeBox.checked || oneShot || /jarvis|jervis/i.test(text) || Date.now() < awaitUntil) showHeard(text); continue; }
      if (speaking) continue;  // ignore our own voice
      onFinal(text);
    }
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed"){ wantOn = false; wakeBox.checked = false; S.set("j-wake", false); say("I can't use the microphone. Allow it in the browser's address bar, then try again.", {err:true}); }
  };
  rec.onend = () => { rec = null; if (wantOn && !oneShot) setTimeout(() => { if (wantOn && !rec) try { startRec(); } catch(e){} }, 250); else { oneShot = false; setState("idle"); } };
  try { rec.start(); setState("listening"); } catch(e){ rec = null; }
}
function stopRec(){ wantOn = false; oneShot = false; if (rec){ try { rec.stop(); } catch(e){} } rec = null; setState("idle"); }
function listenOnce(){ if (speaking) speechSynthesis.cancel(); if (rec){ if (oneShot){ stopRec(); return; } try { rec.stop(); } catch(e){} rec = null; } oneShot = true; wantOn = false; startRec(); }

const WAKE = /\b(?:hey |ok |okay )?(?:jarvis|jervis|jarvis's|travis|javis)\b[,.!]?\s*/i;
function onFinal(text){
  let cmd = text;
  if (wakeBox.checked && !oneShot){
    if (WAKE.test(text)) cmd = text.split(WAKE).slice(1).join(" ").trim();
    else if (Date.now() < awaitUntil) cmd = text;
    else return;
    if (!cmd){ awaitUntil = Date.now() + 8000; showHeard(text); say("Yes?"); return; }
  } else cmd = cmd.replace(WAKE, "").trim();
  awaitUntil = 0; showHeard(text); log(text, "u");
  handle(cmd);
  if (oneShot){ oneShot = false; try { rec && rec.stop(); } catch(e){} }
}

/* ------------------------------------------------------------ commands */
const SCREENS = [
  [/\b(desk|dashboard|home|main( screen)?|overview)\b/, "desk"],
  [/\b(street|social|people|twitter|moves|who'?s moving|voices)\b/, "street"],
  [/\b(markets?|stocks?|commodit\w*|charts?|heat ?map|curve|rates)\b/, "markets"],
  [/\b(events?|calendar|schedule|conferences?)\b/, "events"],
  [/\b(radar|traffic light|headlines|breaking|news)\b/, "radar"],
  [/\b(kit|tools?|toolkit|calculator|lexicon|glossary|notes?|watch ?list)\b/, "kit"],
];
const NAMES = {desk:"the desk", street:"The Street", markets:"markets", events:"events", radar:"the news radar", kit:"the kit"};
function findSymbol(s){
  const keys = Object.keys(CD.SYM).sort((a,b) => b.length - a.length);
  const k = keys.find(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`).test(s));
  if (k) return {sym: CD.SYM[k], name: k};
  const spelled = s.match(/\b(?:[a-z]\s){1,4}[a-z]\b/);           // "a a p l"
  if (spelled) { const t = spelled[0].replace(/\s/g,"").toUpperCase(); return {sym:t, name:t}; }
  const tick = s.match(/\b(?:ticker|symbol)\s+([a-z.]{1,6})\b/); if (tick) return {sym:tick[1].toUpperCase(), name:tick[1].toUpperCase()};
  return null;
}
function findMarket(s){ for (const [id, al] of Object.entries(CD.ALIASES)) if (al.some(a => s.includes(a))) return CD.MARKETS.find(m => m.id === id); return null; }
function eventsLine(list){
  if (!list.length) return "nothing on file";
  return list.slice(0,4).map(e => `${e.title}${e.ts ? " at " + CD.clock12(CD.NY, e.ts) : ""}`).join("; ");
}
function handle(raw){
  const s = raw.toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return;
  if (/^(stop|cancel|quiet|be quiet|shut up|enough|silence)\b/.test(s)){ speechSynthesis.cancel(); log("Okay."); return; }
  if (/\b(thank(s| you)|cheers)\b/.test(s)){ say("Anytime."); return; }
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(s) && s.split(" ").length < 4){ say(`Hello, ${CD.OWNER_NAME}. What do you need?`); return; }
  if (/\b(help|what can you do|commands)\b/.test(s)){ $("j-help").classList.add("on"); panel.hidden = false; say("You can switch screens, chart anything, ask what's on today, ask when a market opens, get a news briefing, define a term, or take a note."); return; }
  if (/\b(next|forward) (screen|page|tab)\b/.test(s) || s === "next"){ const i = CD.ORDER.indexOf(CD.current()); CD.go(CD.ORDER[(i+1) % CD.ORDER.length]); say(`Opening ${NAMES[CD.current()]}.`); return; }
  if (/\b(previous|back|last) (screen|page|tab)\b/.test(s) || s === "back"){ const i = CD.ORDER.indexOf(CD.current()); CD.go(CD.ORDER[(i-1+CD.ORDER.length) % CD.ORDER.length]); say(`Opening ${NAMES[CD.current()]}.`); return; }
  if (/\bfull ?screen\b/.test(s)){ try { document.documentElement.requestFullscreen(); say("Full screen."); } catch(e){ say("This browser won't go full screen from here.", {err:true}); } return; }

  // TV
  if (/\b(play|turn on|start|put on)\b.*\b(tv|television|bloomberg|stream)\b|\b(tv|bloomberg) on\b/.test(s)){ CD.tv(true); say("Bloomberg live, muted. Click the player for sound."); return; }
  if (/\b(stop|turn off|close|kill)\b.*\b(tv|television|stream|video)\b|\btv off\b/.test(s)){ CD.tv(false); say("TV off."); return; }

  // Notes & watchlist
  let m;
  if ((m = s.match(/^(?:take a |make a |add a )?note(?: that| down)?[: ]+(.+)$/)) || (m = s.match(/^remember(?: that)? (.+)$/)) || (m = s.match(/^remind me (?:to |about )?(.+)$/))){
    CD.addNote(raw.replace(/^.*?(note( that| down)?|remember( that)?|remind me( to| about)?)[: ]+/i, "")); say("Noted. It's in the kit.");
    return;
  }
  if ((m = s.match(/\badd (.+?) to (?:my |the )?watch ?list\b/))){
    const f = findSymbol(m[1]); const sym = CD.addWatch(f ? f.sym : m[1].replace(/\s/g,"")); say(`Added ${sym} to your watchlist.`); return;
  }

  // Alerts
  if (/\b(read|speak) (red )?alerts\b|\balerts on\b/.test(s)){ alertBox.checked = true; S.set("j-alerts", true); CD.setAlerts(true); say("I'll read red stories aloud as they break."); return; }
  if (/\balerts off\b|\bstop (reading )?alerts\b/.test(s)){ alertBox.checked = false; S.set("j-alerts", false); say("Alerts muted."); return; }

  // Briefing / radar
  if (/\b(brief( me)?|briefing|what'?s hot|what'?s happening|top stories|what did i miss|anything big|catch me up|morning brief)\b/.test(s)){
    const r = CD.radar(); const nxt = CD.upcoming(2); const ny = CD.status("nyse");
    let out = `Wall Street is ${ny.text.toLowerCase().replace(" ·", ",")}. `;
    if (!r.length) out += "The radar hasn't loaded yet. ";
    else {
      const reds = r.filter(c => c.light === "red");
      out += reds.length ? `${reds.length} red ${reds.length>1?"stories":"story"}. ` : "No red stories right now. ";
      out += r.slice(0,3).map((c,i) => `${i+1}: ${c.title}, ${c.outlets} outlets`).join(". ") + ". ";
    }
    if (nxt.length) out += `Next on the calendar: ${eventsLine(nxt)}.`;
    say(out); return;
  }

  // Calendar
  if (/\b(tomorrow)\b/.test(s) && /\b(what|events?|on|happening|calendar|schedule)\b/.test(s)){ CD.go("events"); say(`Tomorrow: ${eventsLine(CD.dayEvents(1))}.`); return; }
  if (/\b(today|this morning|this afternoon|tonight)\b/.test(s) && /\b(what|events?|on|happening|calendar|schedule|new york)\b/.test(s) || /\bwhat'?s on\b/.test(s) || /\bwhat'?s next\b/.test(s)){
    const now = Date.now(); const left = CD.dayEvents(0).filter(e => !e.ts || e.ts > now - 3600e3);
    CD.go("events"); say(left.length ? `Today: ${eventsLine(left)}.` : `Nothing else today. Next up: ${eventsLine(CD.upcoming(2))}.`); return;
  }

  // Market hours
  if (/\b(open|close|closing|opening|trading|hours)\b/.test(s) && (m = findMarket(s))){
    const st = CD.status(m.id); say(`${m.name} is ${st.text.toLowerCase().replace(" ·", ",")}.`); return;
  }
  if ((m = s.match(/\btime(?: is it)? in ([a-z ]+)$/))){
    const mk = findMarket(m[1]); if (mk){ say(`It's ${CD.clock12(mk.tz, Date.now())} in ${mk.name}.`); return; }
  }
  if (/\bwhat time is it\b|\bwhat'?s the time\b/.test(s)){ say(`It's ${CD.clock12(CD.NY, Date.now())} in New York.`); return; }

  // Definitions
  if ((m = s.match(/\b(?:define|definition of|what (?:is|are|does)|what'?s|explain|meaning of)\s+(?:an? |the )?(.+?)(?: mean)?$/))){
    const q = m[1].trim(); const hit = CD.G.find(([,t]) => t.toLowerCase() === q) || CD.G.find(([,t]) => t.toLowerCase().includes(q) || q.includes(t.toLowerCase().split(" ")[0]));
    if (hit){ say(`${hit[1]}: ${hit[2]}`); return; }
    const sym = findSymbol(q); if (sym){ CD.setChart(sym.sym); CD.go("markets"); say(`Charting ${sym.name}.`); return; }
    say(`${q} isn't in the lexicon yet.`, {err:true}); return;
  }

  // Charts
  if (/\b(chart|show|open|pull up|bring up|graph|plot|how'?s|how is|price of|look at)\b/.test(s)){
    const f = findSymbol(s);
    if (f){ CD.setChart(f.sym); CD.go("markets"); say(`Charting ${f.name}.`); return; }
  }

  // Screens
  for (const [re, name] of SCREENS) if (re.test(s)){ CD.go(name); say(`Opening ${NAMES[name]}.`); return; }

  // bare symbol name
  const f = findSymbol(s); if (f){ CD.setChart(f.sym); CD.go("markets"); say(`Charting ${f.name}.`); return; }

  say(`I didn't catch a command in “${raw}”. Say “commands” to see what I can do.`, {err:true});
}

/* ------------------------------------------------------------ UI wiring */
orb.addEventListener("click", () => {
  panel.hidden = false;
  if (wakeBox.checked){ if (rec) { stopRec(); wakeBox.checked = false; S.set("j-wake", false); say("Stopped listening."); } else { wantOn = true; startRec(); } }
  else listenOnce();
});
$("j-close").onclick = () => { panel.hidden = true; };
$("j-help-btn").onclick = () => $("j-help").classList.toggle("on");
wakeBox.onchange = () => { S.set("j-wake", wakeBox.checked); if (wakeBox.checked){ wantOn = true; oneShot = false; if (rec){ try{rec.stop()}catch(e){} rec = null; } startRec(); say("Listening. Say Jarvis, then a command."); } else stopRec(); };
speakBox.onchange = () => { S.set("j-speak", speakBox.checked); if (!speakBox.checked) speechSynthesis.cancel(); };
alertBox.onchange = () => { S.set("j-alerts", alertBox.checked); if (alertBox.checked) CD.setAlerts(true); };
$("j-form").addEventListener("submit", e => { e.preventDefault(); const v = $("j-in").value.trim(); if (!v) return; log(v, "u"); handle(v); $("j-in").value = ""; });
document.addEventListener("keydown", e => {
  if (e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "j" || e.key === "J"){ e.preventDefault(); panel.hidden = false; listenOnce(); }
  if (e.key === "/"){ e.preventDefault(); panel.hidden = false; $("j-in").focus(); }
  if (e.key === "Escape"){ panel.hidden = true; speechSynthesis.cancel(); }
});
window.addEventListener("cd:red", e => { if (alertBox.checked) say(`Breaking, ${e.detail.outlets} outlets: ${e.detail.title}`); });
// Browsers need a click before the mic can start, so "always listening" resumes on the first interaction.
if (wakeBox.checked) document.addEventListener("pointerdown", () => { if (wakeBox.checked && !rec){ wantOn = true; startRec(); } }, {once:true});
log(`Hi ${CD.OWNER_NAME}. Click me or press J and speak, or type below. Try “brief me”, “chart gold” or “when does London close”.`);
setState("idle");

/* ------------------------------------------------------------ orb animation */
const cv = $("orb-c"), cx = cv.getContext("2d");
let t0 = performance.now(), raf = 0;
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function draw(t){
  const dt = (t - t0) / 1000; t0 = t;
  const W = cv.width, H = cv.height, c = W/2;
  cx.clearRect(0,0,W,H);
  level = Math.max(0, level - dt * 1.6);
  const active = state === "listening" ? .55 + level*.45 : state === "speaking" ? .8 : .25;
  const time = t / 1000;
  for (let k = 0; k < 3; k++){
    const r = 30 + k*12 + Math.sin(time*(1.2+k*.4)) * (2 + active*4);
    cx.beginPath();
    for (let a = 0; a <= Math.PI*2 + .01; a += Math.PI/90){
      const wob = (state === "speaking" ? Math.sin(a*6 + time*8 + k) * 4 : Math.sin(a*3 + time*(1+k*.5)) * 2) * active;
      const x = c + Math.cos(a + time*(.3 + k*.15)*(k%2?-1:1)) * (r + wob), y = c + Math.sin(a + time*(.3 + k*.15)*(k%2?-1:1)) * (r + wob);
      a === 0 ? cx.moveTo(x,y) : cx.lineTo(x,y);
    }
    cx.strokeStyle = `rgba(214,176,98,${.25 + active*.55 - k*.12})`; cx.lineWidth = 2.2 - k*.4; cx.stroke();
  }
  // arc segments rotating
  cx.save(); cx.translate(c,c); cx.rotate(time * (state === "listening" ? 1.6 : .5));
  for (let i = 0; i < 3; i++){ cx.beginPath(); cx.arc(0,0,64,i*2.1,i*2.1+.8); cx.strokeStyle = `rgba(235,230,217,${.15+active*.4})`; cx.lineWidth = 3; cx.stroke(); }
  cx.restore();
  const g = cx.createRadialGradient(c,c,2,c,c,26); g.addColorStop(0,`rgba(214,176,98,${.55+active*.45})`); g.addColorStop(1,"rgba(214,176,98,0)");
  cx.fillStyle = g; cx.beginPath(); cx.arc(c,c,26,0,Math.PI*2); cx.fill();
  if (!reduce && !document.hidden) raf = requestAnimationFrame(draw);
}
raf = requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !reduce){ cancelAnimationFrame(raf); t0 = performance.now(); raf = requestAnimationFrame(draw); } });
})();
