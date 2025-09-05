// === Configura con tus valores ===
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";     // <-- cambia
const SUPABASE_ANON_KEY = "TU_ANON_KEY";                     // <-- cambia
// =================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let snaps = [];
let deaths = [];
let lineChart, barChart;

const byDateAsc = (a,b) => (a.date || a.death_time_utc).localeCompare(b.date || b.death_time_utc);
const uniq = (arr) => [...new Set(arr)];
const fmt = (d) => d?.slice(0,10) || "";

function sel(id){ return document.getElementById(id); }

function groupBy(arr, key){
  return arr.reduce((acc, cur)=>{
    const k = cur[key];
    (acc[k] ||= []).push(cur);
    return acc;
  }, {});
}

// --------- Carga de datos desde Supabase ----------
async function loadData(days=60){
  const since = new Date(); since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0,10);

  // snapshots últimos N días
  const { data: s, error: e1 } = await sb.from("snapshots")
    .select("*")
    .gte("date", sinceStr)
    .order("date", { ascending: true });
  if (e1) { console.error(e1); sel("status").textContent = "Error cargando snapshots"; return; }

  // deaths últimos N días
  const { data: d, error: e2 } = await sb.from("deaths")
    .select("*")
    .gte("death_time_utc", new Date(Date.now()-1000*60*60*24*days).toISOString())
    .order("death_time_utc", { ascending: false });
  if (e2) { console.error(e2); sel("status").textContent = "Error cargando deaths"; return; }

  snaps = s || [];
  deaths = d || [];
  sel("status").textContent = `Cargados ${snaps.length} snapshots y ${deaths.length} deaths (últimos ${days} días)`;
}

// --------- Filtros ----------
function populateFilters(){
  const players = uniq(snaps.map(r=>r.player)).sort((a,b)=>a.localeCompare(b));
  const vocs = uniq(snaps.map(r=>r.vocation).filter(Boolean)).sort((a,b)=>a.localeCompare(b));

  sel("playerSelect").innerHTML = `<option value="__ALL__">Todos</option>` + players.map(p=>`<option>${p}</option>`).join("");
  sel("vocationSelect").innerHTML = `<option value="__ALL__">Todas</option>` + vocs.map(v=>`<option>${v}</option>`).join("");

  sel("resetBtn").addEventListener("click", ()=>{
    sel("playerSelect").value="__ALL__";
    sel("vocationSelect").value="__ALL__";
    sel("startDate").value="";
    sel("endDate").value="";
    render();
  });

  ["playerSelect","vocationSelect","startDate","endDate"].forEach(id=>{
    sel(id).addEventListener("change", render);
  });

  // tabs
  sel("tabSnap").addEventListener("click", (e)=>{ e.preventDefault(); showSnap(); });
  sel("tabDeaths").addEventListener("click", (e)=>{ e.preventDefault(); showDeaths(); });
}

function applyFiltersSnap(data){
  const p = sel("playerSelect").value;
  const v = sel("vocationSelect").value;
  const sd = sel("startDate").value;
  const ed = sel("endDate").value;

  return data.filter(r=>{
    if (p!=="__ALL__" && r.player !== p) return false;
    if (v!=="__ALL__" && r.vocation !== v) return false;
    if (sd && r.date < sd) return false;
    if (ed && r.date > ed) return false;
    return true;
  });
}

function applyFiltersDeaths(data){
  const p = sel("playerSelect").value;
  const sd = sel("startDate").value;
  const ed = sel("endDate").value;

  return data.filter(r=>{
    const d = r.death_time_utc;
    if (p!=="__ALL__" && r.player !== p) return false;
    if (sd && d < sd) return false;
    if (ed && d > (ed + "T23:59:59Z")) return false;
    return true;
  });
}

// --------- KPIs ----------
function computeKPIs(filtered){
  if (!filtered.length){ 
    sel("kpiPlayers").textContent="-";
    sel("kpiAvgGain").textContent="-";
    sel("kpiTop").textContent="-";
    sel("kpiTopGain").textContent="";
    sel("kpiLastUpdate").textContent="-";
    return;
  }

  const lastDate = filtered.map(r=>r.date).sort().at(-1);
  const prevDate = filtered.map(r=>r.date).filter(d=>d<lastDate).sort().at(-1);

  const latestByPlayer = Object.values(groupBy(filtered.filter(r=>r.date===lastDate), "player"))
    .map(rows => rows.sort((a,b)=>a.date.localeCompare(b.date)).at(-1));

  let deltas = [];
  if (prevDate){
    const prevByPlayer = Object.fromEntries(
      Object.values(groupBy(filtered.filter(r=>r.date===prevDate), "player"))
        .map(rows => [rows[0].player, rows.sort((a,b)=>a.date.localeCompare(b.date)).at(-1).level])
    );
    deltas = latestByPlayer.map(r => ({ player: r.player, gain: (r.level ?? 0) - (prevByPlayer[r.player] ?? (r.level ?? 0)) }));
  }

  const avgGain = deltas.length ? (deltas.reduce((s,x)=>s+x.gain,0)/deltas.length) : 0;
  const top = deltas.sort((a,b)=>b.gain-a.gain)[0] || {player:"-", gain:0};

  sel("kpiPlayers").textCo
