// =====================
//  Configuración
// =====================
const SUPABASE_URL = "https://kqggdbjwwiyzhhnblfmd.supabase.co";   // <-- CAMBIA
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZ2dkYmp3d2l5emhobmJsZm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwOTkyNTgsImV4cCI6MjA3MjY3NTI1OH0.nOcDOSNOhyN_CSboaAfuHvbRQic4NPWgpL78SBG7tT0";                  // <-- CAMBIA
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Rango de días a cargar inicialmente
const DEFAULT\_DAYS = 180;

// =====================
//  Estado
// =====================
let snaps = \[];      // snapshots
let deaths = \[];     // deaths
let gainsLog = \[];   // daily\_gains\_log

let levelLineChart, levelByVocChart, gainLineChart, barGainByVoc, barDeathsMonthly;

// =====================
//  Utils
// =====================
const sel = (id) => document.getElementById(id);
const uniq = (arr) => \[...new Set(arr)];
const byDateAsc = (a, b) => {
const da = (a.date ?? a.death\_time\_utc);
const db = (b.date ?? b.death\_time\_utc);
return String(da).localeCompare(String(db));
};

// === Formatos de fecha (CDMX) ===
const MX\_TZ = "America/Mexico\_City";
const fmtDate = new Intl.DateTimeFormat("es-MX", {
timeZone: MX\_TZ, day: "2-digit", month: "2-digit", year: "numeric"
});
const fmtDateTime = new Intl.DateTimeFormat("es-MX", {
timeZone: MX\_TZ, day: "2-digit", month: "2-digit", year: "numeric",
hour: "2-digit", minute: "2-digit", hour12: false
});
function fromYMD(ymd){ return ymd ? new Date(`${ymd}T12:00:00Z`) : null; }
function fromISO(iso){ return iso ? new Date(iso) : null; }
function toDDMMYYYY(ymd){ const d=fromYMD(ymd); return d?fmtDate.format(d):""; }
function toDDMMYYYY\_HHMM(iso){ const d=fromISO(iso); return d?fmtDateTime.format(d):""; }
function daysBetween(aIso,bIso){ const a=new Date(aIso).getTime(); const b=new Date(bIso).getTime(); return Math.floor((b-a)/86400000); }

function groupBy(arr, key) {
return arr.reduce((acc, cur) => {
const k = cur\[key];
(acc\[k] ||= \[]).push(cur);
return acc;
}, {});
}

function lastSnapshotByPlayerDate(data) {
const map = new Map(); // `${player}|${date}` -> row más reciente
for (const r of data) {
const key = `${r.player}|${r.date}`;
const prev = map.get(key);
if (!prev || (r.inserted\_at || "") > (prev.inserted\_at || "")) {
map.set(key, r);
}
}
return map;
}

// =====================
//  Carga de datos
// =====================
async function loadSnapshots(days = DEFAULT\_DAYS) {
const since = new Date(); since.setDate(since.getDate() - days);
const sinceStr = since.toISOString().slice(0, 10);
const { data, error } = await sb
.from("snapshots").select("\*")
.gte("date", sinceStr)
.order("date", { ascending: true });
if (error) { console.error(error); sel("status").textContent = "Error cargando snapshots"; return \[]; }
return data || \[];
}

async function loadDeaths(days = DEFAULT\_DAYS) {
const sinceIso = new Date(Date.now() - 1000*60*60*24*days).toISOString();
const { data, error } = await sb
.from("deaths").select("\*")
.gte("death\_time\_utc", sinceIso)
.order("death\_time\_utc", { ascending: false });
if (error) { console.error(error); sel("status").textContent = "Error cargando deaths"; return \[]; }
return data || \[];
}

async function loadGainsLog(days = DEFAULT\_DAYS) {
const since = new Date(); since.setDate(since.getDate() - days);
const sinceStr = since.toISOString().slice(0, 10);
const { data, error } = await sb
.from("daily\_gains\_log").select("\*")
.gte("date", sinceStr)
.order("date", { ascending: true });
if (error) { console.error(error); sel("status").textContent = "Error cargando daily gains"; return \[]; }
return data || \[];
}

async function loadData() {
sel("status").textContent = "Cargando…";
const \[s, d, g] = await Promise.all(\[ loadSnapshots(), loadDeaths(), loadGainsLog() ]);
snaps = s; deaths = d; gainsLog = g;
sel("status").textContent = `Cargados ${snaps.length} snapshots, ${gainsLog.length} daily gains y ${deaths.length} deaths (últimos ${DEFAULT_DAYS} días)`;
}

// =====================
//  Filtros
// =====================
function populateFilters() {
const players = uniq(snaps.map(r=>r.player)).sort((a,b)=>a.localeCompare(b));
const vocs = uniq(snaps.map(r=>r.vocation).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
sel("playerSelect").innerHTML = `<option value="__ALL__">Todos</option>` + players.map(p=>`<option>${p}</option>`).join("");
sel("vocationSelect").innerHTML = `<option value="__ALL__">Todas</option>` + vocs.map(v=>`<option>${v}</option>`).join("");

sel("resetBtn").addEventListener("click", ()=>{
sel("playerSelect").value="**ALL**"; sel("vocationSelect").value="**ALL**";
sel("startDate").value=""; sel("endDate").value="";
renderAll();
});

let \_t; const onChangeDebounced=()=>{ clearTimeout(\_t); \_t=setTimeout(renderAll,60); };
\["playerSelect","vocationSelect","startDate","endDate"].forEach(id=> sel(id).addEventListener("change", onChangeDebounced));

// Tabs
sel("tabOverview").addEventListener("click",(e)=>{e.preventDefault(); showView("viewOverview");});
sel("tabPlayers").addEventListener("click",(e)=>{e.preventDefault(); showView("viewPlayers");});
sel("tabDeaths").addEventListener("click",(e)=>{e.preventDefault(); showView("viewDeaths");});
sel("tabLeaders").addEventListener("click",(e)=>{e.preventDefault(); showView("viewLeaders");});
}

function currentFilters(){
return {
player: sel("playerSelect").value,
vocation: sel("vocationSelect").value,
start: sel("startDate").value || null,
end: sel("endDate").value || null,
};
}

function applyFiltersSnap(data){
const {player,vocation,start,end}=currentFilters();
return data.filter(r=>{
if (player!=="**ALL**" && r.player!==player) return false;
if (vocation!=="**ALL**" && r.vocation!==vocation) return false;
if (start && r.date\<start) return false;
if (end && r.date>end) return false;
return true;
});
}
function applyFiltersDeaths(data){
const {player,start,end}=currentFilters();
return data.filter(r=>{
const d=String(r.death\_time\_utc);
if (player!=="**ALL**" && r.player!==player) return false;
if (start && d\<start) return false;
if (end && d>end+"T23:59:59Z") return false;
return true;
});
}
function applyFiltersGains(data){
const {player,start,end}=currentFilters();
return data.filter(r=>{
if (player!=="**ALL**" && r.player!==player) return false;
if (start && r.date\<start) return false;
if (end && r.date>end) return false;
return true;
});
}

// =====================
//  KPIs (sin streak; con card de accidentes)
// =====================
function computeKPIs(filteredSnaps, filteredGains, filteredDeaths) {
// Jugadores activos
const lastDateYMD = filteredSnaps.map(r=>r.date).sort().at(-1);
const latestByPlayer = Object.values(
groupBy(filteredSnaps.filter(r=>r.date===lastDateYMD), "player")
).map(rows=>rows.sort(byDateAsc).at(-1));
sel("kpiPlayers").textContent = uniq(latestByPlayer.map(r=>r.player)).length || "-";

// Promedios (ignora nulls)
const cut7=new Date(); cut7.setDate(cut7.getDate()-7); const cut7s=cut7.toISOString().slice(0,10);
const cut30=new Date(); cut30.setDate(cut30.getDate()-30); const cut30s=cut30.toISOString().slice(0,10);
const g7 = filteredGains.filter(g=>g.date>=cut7s && g.gain!=null);
const g30= filteredGains.filter(g=>g.date>=cut30s && g.gain!=null);
const avg7 = g7.length? g7.reduce((s,x)=>s+x.gain,0)/g7.length : 0;
const avg30= g30.length?g30.reduce((s,x)=>s+x.gain,0)/g30.length:0;
sel("kpiAvgGain7").textContent = avg7.toFixed(2);
sel("kpiAvgGain30").textContent = avg30.toFixed(2);

// Muertes últimos 30 días
const deaths30 = filteredDeaths.filter(d=> new Date(d.death\_time\_utc) >= new Date(cut30s));
sel("kpiDeaths30").textContent = deaths30.length;

// ===== DÍAS SIN ACCIDENTES (EQUIPO) =====
const lastDeathGlobal = filteredDeaths.sort(byDateAsc).at(-1)?.death\_time\_utc;

// referencias al card e ícono
const card = sel("kpiNoAccCard");
const icon = sel("kpiNoAccIcon");

// clases base del card (las reconstruimos siempre, y luego añadimos color)
const baseClasses = \[
"rounded-2xl","p-4","shadow","transition-colors","duration-300",
"border","bg-slate-900","border-slate-800"
];

if (lastDeathGlobal){
const days = daysBetween(lastDeathGlobal, new Date().toISOString());
sel("kpiDaysNoAcc").textContent = `${days}`;
sel("kpiLastDeathGlobal").textContent = `Último: ${toDDMMYYYY_HHMM(lastDeathGlobal)}`;

```
// semáforo de color y emoji
let colorClasses, emoji;
if (days <= 5) {          // 🔴 rojo
  colorClasses = ["bg-red-900/60","border-red-700","text-red-100"]; emoji = "🪖";
} else if (days <= 10) {  // 🟡 amarillo
  colorClasses = ["bg-yellow-900/50","border-yellow-700","text-yellow-100"]; emoji = "🪖";
} else {                  // 🟢 verde
  colorClasses = ["bg-emerald-900/50","border-emerald-700","text-emerald-100"]; emoji = "🪖";
}

card.className = [...baseClasses, ...colorClasses].join(" ");
icon.textContent = emoji;
```

} else {
// Sin deaths registradas
sel("kpiDaysNoAcc").textContent = "—";
sel("kpiLastDeathGlobal").textContent = "Sin deaths registradas";
card.className = baseClasses.join(" ");
icon.textContent = "🪖";
}
}

// =====================
//  Tablas
// =====================
function renderSnapTable(filteredSnaps, filteredGains) {
const tbody = sel("snapTable");
if (!tbody) return;
if (!filteredSnaps.length) { tbody.innerHTML = `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`; return; }

const byPlayer = groupBy(filteredSnaps, "player");
const last7 = new Date(); last7.setDate(last7.getDate()-7); const last7Str=last7.toISOString().slice(0,10);

const html = Object.values(byPlayer).map(list=>{
const srt=list.sort(byDateAsc);
const latest=srt.at(-1);
const g7 = applyFiltersGains(gainsLog)
.filter(g=>g.player===latest.player && g.date>=last7Str && g.gain!=null)
.reduce((s,x)=>s+x.gain,0);

```
return `
  <tr class="border-t border-slate-800">
    <td class="py-2">${latest.player}</td>
    <td class="py-2">${latest.vocation || "-"}</td>
    <td class="py-2 text-right">${latest.level ?? "-"}</td>
    <td class="py-2 text-right">${g7>=0?`+${g7}`:g7}</td>
    <td class="py-2 text-right">${toDDMMYYYY(latest.date)}</td>
  </tr>
`;
```

}).join("");
tbody.innerHTML = html;
}

function renderDeathTable(filteredDeaths) {
const tbody = sel("deathTable");
if (!tbody) return;
if (!filteredDeaths.length) { tbody.innerHTML = `<tr><td class="py-3 px-2 text-slate-400">Sin deaths en el rango</td></tr>`; return; }

const now = Date.now();
const html = filteredDeaths.sort(byDateAsc).reverse().map(d=>{
const diffDays = Math.floor((now - new Date(d.death\_time\_utc).getTime())/86400000);
const killers=(d.killers||\[]).join("; ");
const assists=(d.assists||\[]).join("; ");
return `       <tr class="border-t border-slate-800 align-top">         <td class="py-2 px-2">${d.player}</td>         <td class="py-2 px-2">${toDDMMYYYY_HHMM(d.death_time_utc)}</td>         <td class="py-2 pr-4 pl-2 text-right tabular-nums">${d.level_at_death ?? "-"}</td>         <td class="py-2 pl-4 pr-2 whitespace-normal break-words">${d.reason || "-"}</td>         <td class="py-2 px-2 whitespace-normal break-words">${killers || "-"}</td>         <td class="py-2 px-2 whitespace-normal break-words">${assists || "-"}</td>         <td class="py-2 px-2 text-right tabular-nums">${diffDays}</td>       </tr>
    `;
}).join("");
tbody.innerHTML = html;
}

// =====================
//  Leaderboards
// =====================
function renderLeaderboards(filteredGains, filteredDeaths) {
const cut7=new Date(); cut7.setDate(cut7.getDate()-7); const cut7s=cut7.toISOString().slice(0,10);
const cut30=new Date(); cut30.setDate(cut30.getDate()-30); const cut30s=cut30.toISOString().slice(0,10);
const map7={}; applyFiltersGains(filteredGains).filter(g=>g.date>=cut7s && g.gain!=null).forEach(g=>{ map7\[g.player]=(map7\[g.player]||0)+g.gain; });
const map30={}; applyFiltersGains(filteredGains).filter(g=>g.date>=cut30s && g.gain!=null).forEach(g=>{ map30\[g.player]=(map30\[g.player]||0)+g.gain; });
const dmap={}; applyFiltersDeaths(filteredDeaths).filter(d=> new Date(d.death\_time\_utc)>= new Date(cut30s)).forEach(d=>{ dmap\[d.player]=(dmap\[d.player]||0)+1; });

const lb7 = sel("lb7"), lb30=sel("lb30"), lbDeaths=sel("lbDeaths");
if (lb7) lb7.innerHTML = Object.entries(map7).sort((a,b)=>b\[1]-a\[1]).slice(0,20).map((\[p,g])=>`<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">+${g}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
if (lb30) lb30.innerHTML= Object.entries(map30).sort((a,b)=>b\[1]-a\[1]).slice(0,20).map((\[p,g])=>`<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">+${g}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
if (lbDeaths) lbDeaths.innerHTML= Object.entries(dmap).sort((a,b)=>b\[1]-a\[1]).slice(0,20).map((\[p,c])=>`<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">${c}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
}

// =====================
//  Gráficas
// =====================
// 1) Historial de level por JUGADOR (serie = player)
function renderLevelLine(filteredSnaps) {
const ctx = sel("levelLineChart"); if (!ctx) return;
if (levelLineChart) levelLineChart.destroy();

const dates = uniq(filteredSnaps.map(r=>r.date)).sort();
const byPD = lastSnapshotByPlayerDate(filteredSnaps);
const players = uniq(filteredSnaps.map(r=>r.player)).sort((a,b)=>a.localeCompare(b));

const datasets = players.map(player=>{
const data = dates.map(d=>{
const snap = byPD.get(`${player}|${d}`);
return snap ? (snap.level ?? null) : null;
});
return { label: player, data };
});

levelLineChart = new Chart(ctx, {
type: "line",
data: { labels: dates.map(toDDMMYYYY), datasets },
options: { responsive\:true, maintainAspectRatio\:false, spanGaps\:true }
});
}

// 2) Historial de level promedio por VOCACIÓN (serie = vocación)
function renderLevelByVocation(filteredSnaps) {
const ctx = sel("levelByVocChart"); if (!ctx) return;
if (levelByVocChart) levelByVocChart.destroy();

const dates = uniq(filteredSnaps.map(r=>r.date)).sort();
const vocs = uniq(filteredSnaps.map(r=>r.vocation).filter(Boolean)).sort();

const datasets = vocs.map(voc=>{
const arr = dates.map(d=>{
const rows = filteredSnaps.filter(r=>r.date===d && r.vocation===voc);
if (!rows.length) return null;
const avg = rows.reduce((s,x)=>s+(x.level??0),0)/rows.length;
return Math.round(avg\*100)/100;
});
return { label: voc, data: arr };
});

levelByVocChart = new Chart(ctx, {
type: "line",
data: { labels: dates.map(toDDMMYYYY), datasets },
options: { responsive\:true, maintainAspectRatio\:false, spanGaps\:true }
});
}

function renderGainLine(filteredGains) {
const ctx = sel("gainLineChart"); if (!ctx) return;
if (gainLineChart) gainLineChart.destroy();

const pSel = sel("playerSelect").value;
const series = pSel==="**ALL**" ? \[] :
applyFiltersGains(filteredGains).filter(g=>g.player===pSel).sort((a,b)=> String(a.date).localeCompare(String(b.date)));

gainLineChart = new Chart(ctx, {
type:"line",
data:{ labels: series.map(r=>toDDMMYYYY(r.date)),
datasets:\[{ label:`Ganancia diaria - ${pSel==="__ALL__"?"Selecciona un jugador":pSel}`, data: series.map(r=>r.gain) }] },
options:{ responsive\:true, maintainAspectRatio\:false, spanGaps\:true }
});
}

function renderBarGainByVoc(filteredSnaps, filteredGains) {
const ctx = sel("barGainByVoc"); if (!ctx) return;
if (barGainByVoc) barGainByVoc.destroy();

const cut=new Date(); cut.setDate(cut.getDate()-7); const cutStr=cut.toISOString().slice(0,10);
const gainsRecent = applyFiltersGains(filteredGains).filter(g=>g.date>=cutStr && g.gain!=null);
const lastByPD = lastSnapshotByPlayerDate(filteredSnaps);
const sums = {};
for (const g of gainsRecent){
const snap = lastByPD.get(`${g.player}|${g.date}`);
const voc = (snap && snap.vocation) || "Unknown";
sums\[voc] = (sums\[voc]||0) + g.gain;
}
const labels=Object.keys(sums).sort();
const data=labels.map(k=>sums\[k]);

barGainByVoc = new Chart(ctx, {
type:"bar",
data:{ labels, datasets:\[{ label:"Ganancia 7 días", data }] },
options:{ responsive\:true, maintainAspectRatio\:false }
});
}

function renderBarDeathsMonthly(filteredDeaths) {
const ctx = sel("barDeathsMonthly"); if (!ctx) return;
if (barDeathsMonthly) barDeathsMonthly.destroy();

const now=new Date();
const sixAgo=new Date(now\.getFullYear(), now\.getMonth()-5, 1);
const buckets={}; const labels=\[];
for(let i=0;i<6;i++){
const dt=new Date(sixAgo.getFullYear(), sixAgo.getMonth()+i, 1);
const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
buckets\[key]=0;
labels.push(fmtDate.format(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), 1))));
}
applyFiltersDeaths(filteredDeaths).forEach(d=>{
const m=d.death\_time\_utc.slice(0,7);
if (m in buckets) buckets\[m]+=1;
});
const data=Object.keys(buckets).map(k=>buckets\[k]);

barDeathsMonthly = new Chart(ctx, {
type:"bar",
data:{ labels, datasets:\[{ label:"Muertes por mes", data }] },
options:{ responsive\:true, maintainAspectRatio\:false }
});
}

// =====================
//  Render de vistas
// =====================
function renderOverview() {
const fSnaps = applyFiltersSnap(snaps);
const fDeaths = applyFiltersDeaths(deaths);
const fGains  = applyFiltersGains(gainsLog);

computeKPIs(fSnaps, fGains, fDeaths);
renderLevelLine(fSnaps);          // por jugador
renderLevelByVocation(fSnaps);    // por vocación (promedio)
renderGainLine(fGains);
renderBarGainByVoc(fSnaps, fGains);
renderBarDeathsMonthly(fDeaths);
}
function renderPlayers(){ renderSnapTable(applyFiltersSnap(snaps), applyFiltersGains(gainsLog)); }
function renderDeathsView(){ renderDeathTable(applyFiltersDeaths(deaths)); }
function renderLeaders(){ renderLeaderboards(gainsLog, deaths); }

function renderAll(){
const current = document.querySelector("section\:not(.hidden)\[id^='view']");
if (!current) return;
switch(current.id){
case "viewOverview": renderOverview(); break;
case "viewPlayers":  renderPlayers(); break;
case "viewDeaths":   renderDeathsView(); break;
case "viewLeaders":  renderLeaders(); break;
}
}
function showView(viewId){
\["viewOverview","viewPlayers","viewDeaths","viewLeaders"].forEach(id=> sel(id).classList.toggle("hidden", id!==viewId));
renderAll();
}

// =====================
//  Init
// =====================
(async function init(){
await loadData();
populateFilters();
showView("viewOverview");
renderAll();
})();
