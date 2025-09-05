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

  sel("kpiPlayers").textContent = uniq(latestByPlayer.map(r=>r.player)).length;
  sel("kpiAvgGain").textContent = avgGain.toFixed(2);
  sel("kpiTop").textContent = top.player;
  sel("kpiTopGain").textContent = top.player==="-" ? "" : `+${top.gain}`;
  sel("kpiLastUpdate").textContent = lastDate || "-";
}

// --------- Tablas ----------
function renderSnapTable(filtered){
  const tbody = sel("snapTable");
  const byPlayer = groupBy(filtered, "player");
  const rows = Object.values(byPlayer).map(list => list.sort(byDateAsc));

  const last7 = new Date(); last7.setDate(last7.getDate()-7);
  const last7s = last7.toISOString().slice(0,10);

  const html = rows.map(list=>{
    const latest = list.at(-1);
    const past = list.find(r=>r.date >= last7s) || list[0];
    const gain7 = (latest.level ?? 0) - (past.level ?? 0);
    return `
      <tr class="border-t border-slate-800">
        <td class="py-2">${latest.player}</td>
        <td class="py-2">${latest.vocation || "-"}</td>
        <td class="py-2 text-right">${latest.level ?? "-"}</td>
        <td class="py-2 text-right">${gain7 >= 0 ? "+"+gain7 : gain7}</td>
        <td class="py-2 text-right">${latest.date}</td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = html || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
}

function renderDeathTable(filtered){
  const tbody = sel("deathTable");
  const now = Date.now();

  const html = filtered.sort(byDateAsc).reverse().map(d=>{
    const diffDays = Math.floor((now - new Date(d.death_time_utc).getTime()) / 86400000);
    const killers = (d.killers || []).join("; ");
    const assists = (d.assists || []).join("; ");
    return `
      <tr class="border-t border-slate-800">
        <td class="py-2">${d.player}</td>
        <td class="py-2">${d.death_time_utc}</td>
        <td class="py-2 text-right">${d.level_at_death ?? "-"}</td>
        <td class="py-2">${d.reason || "-"}</td>
        <td class="py-2">${killers || "-"}</td>
        <td class="py-2">${assists || "-"}</td>
        <td class="py-2 text-right">${diffDays}</td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = html || `<tr><td class="py-3 text-slate-400">Sin deaths en el rango</td></tr>`;
}

// --------- Gráficas ----------
function renderLineChart(filtered){
  const ctx = sel("lineChart");
  if (lineChart) lineChart.destroy();

  const psel = sel("playerSelect").value;

  if (psel !== "__ALL__"){
    const series = filtered.filter(r=>r.player===psel).sort(byDateAsc);
    lineChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: series.map(r=>r.date),
        datasets: [{ label: psel, data: series.map(r=>r.level ?? 0) }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    return;
  }

  const byDate = groupBy(filtered, "date");
  const dates = Object.keys(byDate).sort();

  const vocSet = uniq(filtered.map(r=>r.vocation).filter(Boolean));
  const datasets = vocSet.map(voc=>{
    const arr = dates.map(d=>{
      const rows = byDate[d].filter(x=>x.vocation===voc);
      if (!rows.length) return null;
      const avg = rows.reduce((s,x)=>s+(x.level ?? 0), 0) / rows.length;
      return Math.round(avg*100)/100;
    });
    return { label: voc, data: arr };
  });

  lineChart = new Chart(ctx, {
    type: "line",
    data: { labels: dates, datasets },
    options: { responsive: true, maintainAspectRatio: false, spanGaps: true }
  });
}

function renderBarChart(filtered){
  const ctx = sel("barChart");
  if (barChart) barChart.destroy();

  const cut = new Date(); cut.setDate(cut.getDate()-7);
  const cutStr = cut.toISOString().slice(0,10);
  const recent = filtered.filter(r=>r.date >= cutStr);

  const byPlayer = groupBy(recent, "player");
  const gainsByVoc = {};

  for (const list of Object.values(byPlayer)){
    const sorted = list.sort(byDateAsc);
    if (sorted.length < 2) continue;
    const gain = (sorted.at(-1).level ?? 0) - (sorted[0].level ?? 0);
    const voc = sorted.at(-1).vocation || "Unknown";
    gainsByVoc[voc] = (gainsByVoc[voc] || 0) + gain;
  }

  const labels = Object.keys(gainsByVoc);
  const data = Object.values(gainsByVoc);

  barChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Ganancia 7 días", data }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// --------- Render principal ----------
function render(){
  // Sección activa (snapshots o deaths) usa mismos filtros de arriba
  const filteredSnap = applyFiltersSnap(snaps);
  const filteredDeath = applyFiltersDeaths(deaths);

  computeKPIs(filteredSnap);
  renderLineChart(filteredSnap);
  renderBarChart(filteredSnap);
  renderSnapTable(filteredSnap);
  renderDeathTable(filteredDeath);
}

function showSnap(){
  sel("deathTableSec").classList.add("hidden");
  sel("snapTableSec").classList.remove("hidden");
  sel("charts").classList.remove("hidden");
  sel("kpis").classList.remove("hidden");
}
function showDeaths(){
  sel("snapTableSec").classList.add("hidden");
  sel("charts").classList.add("hidden");
  sel("kpis").classList.add("hidden");
  sel("deathTableSec").classList.remove("hidden");
}

// --------- Init ----------
(async function init(){
  await loadData(60);
  populateFilters();
  showSnap();
  render();
})();
