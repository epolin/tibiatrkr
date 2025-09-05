// =====================
//  Configuración
// =====================
const SUPABASE_URL = "https://kqggdbjwwiyzhhnblfmd.supabase.co";   // <-- CAMBIA
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZ2dkYmp3d2l5emhobmJsZm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwOTkyNTgsImV4cCI6MjA3MjY3NTI1OH0.nOcDOSNOhyN_CSboaAfuHvbRQic4NPWgpL78SBG7tT0";                  // <-- CAMBIA

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Rango de días a cargar inicialmente
const DEFAULT_DAYS = 60;

// =====================
//  Estado global
// =====================
let snaps = [];      // snapshots (últimos N días)
let deaths = [];     // deaths (últimos N días)
let gainsLog = [];   // daily_gains_log (últimos N días)

let lineChart, barChart;

// =====================
//  Helpers
// =====================
const sel = (id) => document.getElementById(id);
const uniq = (arr) => [...new Set(arr)];
const byDateAsc = (a, b) => {
  const da = (a.date ?? a.death_time_utc);
  const db = (b.date ?? b.death_time_utc);
  return String(da).localeCompare(String(db));
};
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "");

// Agrupar por key
function groupBy(arr, key) {
  return arr.reduce((acc, cur) => {
    const k = cur[key];
    (acc[k] ||= []).push(cur);
    return acc;
  }, {});
}

// Último snapshot por (player, date)
function lastSnapshotByPlayerDate(data) {
  const map = new Map(); // key: `${player}|${date}` -> row más reciente
  for (const r of data) {
    const key = `${r.player}|${r.date}`;
    const prev = map.get(key);
    // usamos inserted_at si existe para decidir el más reciente
    if (!prev || (r.inserted_at || "") > (prev.inserted_at || "")) {
      map.set(key, r);
    }
  }
  return map;
}

// =====================
//  Carga de datos
// =====================
async function loadSnapshots(days = DEFAULT_DAYS) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("snapshots")
    .select("*")
    .gte("date", sinceStr)
    .order("date", { ascending: true });
  if (error) {
    console.error("snapshots error", error);
    sel("status").textContent = "Error cargando snapshots";
    return [];
  }
  return data || [];
}

async function loadDeaths(days = DEFAULT_DAYS) {
  const sinceIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * days).toISOString();
  const { data, error } = await sb
    .from("deaths")
    .select("*")
    .gte("death_time_utc", sinceIso)
    .order("death_time_utc", { ascending: false });
  if (error) {
    console.error("deaths error", error);
    sel("status").textContent = "Error cargando deaths";
    return [];
  }
  return data || [];
}

async function loadGainsLog(days = DEFAULT_DAYS) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("daily_gains_log")
    .select("*")
    .gte("date", sinceStr)
    .order("date", { ascending: true });
  if (error) {
    console.error("gains_log error", error);
    sel("status").textContent = "Error cargando daily gains";
    return [];
  }
  return data || [];
}

async function loadData() {
  sel("status").textContent = "Cargando…";
  const [s, d, g] = await Promise.all([
    loadSnapshots(DEFAULT_DAYS),
    loadDeaths(DEFAULT_DAYS),
    loadGainsLog(DEFAULT_DAYS),
  ]);
  snaps = s;
  deaths = d;
  gainsLog = g;
  sel("status").textContent = `Cargados ${snaps.length} snapshots, ${gainsLog.length} daily gains y ${deaths.length} deaths (últimos ${DEFAULT_DAYS} días)`;
}

// =====================
//  Filtros
// =====================
function populateFilters() {
  const players = uniq(snaps.map((r) => r.player)).sort((a, b) => a.localeCompare(b));
  const vocs = uniq(snaps.map((r) => r.vocation).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b)
  );

  sel("playerSelect").innerHTML =
    `<option value="__ALL__">Todos</option>` + players.map((p) => `<option>${p}</option>`).join("");
  sel("vocationSelect").innerHTML =
    `<option value="__ALL__">Todas</option>` + vocs.map((v) => `<option>${v}</option>`).join("");

  sel("resetBtn").addEventListener("click", () => {
    sel("playerSelect").value = "__ALL__";
    sel("vocationSelect").value = "__ALL__";
    sel("startDate").value = "";
    sel("endDate").value = "";
    render();
  });

  ["playerSelect", "vocationSelect", "startDate", "endDate"].forEach((id) =>
    sel(id).addEventListener("change", render)
  );

  // Tabs
  sel("tabSnap").addEventListener("click", (e) => {
    e.preventDefault();
    showSnap();
  });
  sel("tabDeaths").addEventListener("click", (e) => {
    e.preventDefault();
    showDeaths();
  });
}

function applyFiltersSnap(data) {
  const p = sel("playerSelect").value;
  const v = sel("vocationSelect").value;
  const sd = sel("startDate").value;
  const ed = sel("endDate").value;

  return data.filter((r) => {
    if (p !== "__ALL__" && r.player !== p) return false;
    if (v !== "__ALL__" && r.vocation !== v) return false;
    if (sd && r.date < sd) return false;
    if (ed && r.date > ed) return false;
    return true;
  });
}

function applyFiltersDeaths(data) {
  const p = sel("playerSelect").value;
  const sd = sel("startDate").value;
  const ed = sel("endDate").value;

  return data.filter((r) => {
    const d = String(r.death_time_utc);
    if (p !== "__ALL__" && r.player !== p) return false;
    if (sd && d < sd) return false;
    if (ed && d > ed + "T23:59:59Z") return false;
    return true;
  });
}

function applyFiltersGains(data) {
  const p = sel("playerSelect").value;
  const sd = sel("startDate").value;
  const ed = sel("endDate").value;

  return data.filter((r) => {
    if (p !== "__ALL__" && r.player !== p) return false;
    if (sd && r.date < sd) return false;
    if (ed && r.date > ed) return false;
    return true;
  });
}

// =====================
//  KPIs
// =====================
function computeKPIs(filteredSnaps, filteredGains) {
  // Jugadores con snapshot más reciente
  const lastDate = filteredSnaps.map((r) => r.date).sort().at(-1);
  const latestByPlayer = Object.values(groupBy(filteredSnaps.filter((r) => r.date === lastDate), "player"))
    .map((rows) => rows.sort(byDateAsc).at(-1));

  // Avg gain / Top gainer del último día con gains
  const lastGainDate = filteredGains.map((g) => g.date).sort().at(-1);
  const gainsLast = filteredGains.filter((g) => g.date === lastGainDate);

  const avgGain =
    gainsLast.length ? gainsLast.reduce((s, x) => s + (x.gain || 0), 0) / gainsLast.length : 0;
  const top = gainsLast.sort((a, b) => (b.gain || 0) - (a.gain || 0))[0] || { player: "-", gain: 0 };

  sel("kpiPlayers").textContent = uniq(latestByPlayer.map((r) => r.player)).length || "-";
  sel("kpiAvgGain").textContent = avgGain.toFixed(2);
  sel("kpiTop").textContent = top.player || "-";
  sel("kpiTopGain").textContent = top.player === "-" ? "" : `+${top.gain}`;
  sel("kpiLastUpdate").textContent = lastDate || "-";
}

// =====================
//  Tablas
// =====================
function renderSnapTable(filteredSnaps, filteredGains) {
  const tbody = sel("snapTable");
  if (!filteredSnaps.length) {
    tbody.innerHTML = `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
    return;
  }

  const byPlayer = groupBy(filteredSnaps, "player");
  const last7 = new Date();
  last7.setDate(last7.getDate() - 7);
  const last7Str = last7.toISOString().slice(0, 10);

  const gainsByKey = new Map(); // key: `${player}|${date}` -> gain
  for (const g of filteredGains) {
    gainsByKey.set(`${g.player}|${g.date}`, g.gain ?? 0);
  }

  const html = Object.values(byPlayer)
    .map((list) => list.sort(byDateAsc))
    .map((list) => {
      const latest = list.at(-1);
      // Ganancia 7d = suma de gains últimos 7 días de ese player
      const g7 = filteredGains
        .filter((g) => g.player === latest.player && g.date >= last7Str)
        .reduce((s, x) => s + (x.gain || 0), 0);

      return `
        <tr class="border-t border-slate-800">
          <td class="py-2">${latest.player}</td>
          <td class="py-2">${latest.vocation || "-"}</td>
          <td class="py-2 text-right">${latest.level ?? "-"}</td>
          <td class="py-2 text-right">${g7 >= 0 ? "+" + g7 : g7}</td>
          <td class="py-2 text-right">${latest.date}</td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

function renderDeathTable(filteredDeaths) {
  const tbody = sel("deathTable");
  if (!filteredDeaths.length) {
    tbody.innerHTML = `<tr><td class="py-3 text-slate-400">Sin deaths en el rango</td></tr>`;
    return;
  }

  const now = Date.now();
  const html = filteredDeaths
    .sort(byDateAsc)
    .reverse()
    .map((d) => {
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
    })
    .join("");

  tbody.innerHTML = html;
}

// =====================
//  Gráficas
// =====================

// LineChart:
// - Si hay player seleccionado -> serie de "gain por día" (daily_gains_log)
// - Si está "Todos" -> promedio de level por vocación por día (desde snapshots)
function renderLineChart(filteredSnaps, filteredGains) {
  const ctx = sel("lineChart");
  if (lineChart) lineChart.destroy();

  const playerSel = sel("playerSelect").value;

  if (playerSel !== "__ALL__") {
    // Serie de gains por día del jugador
    const series = filteredGains
      .filter((g) => g.player === playerSel)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    lineChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: series.map((r) => r.date),
        datasets: [
          {
            label: `Ganancia diaria - ${playerSel}`,
            data: series.map((r) => r.gain ?? 0),
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, spanGaps: true },
    });
    return;
  }

  // Promedio de level por vocación por día
  const byDate = groupBy(filteredSnaps, "date");
  const dates = Object.keys(byDate).sort();

  const vocs = uniq(filteredSnaps.map((r) => r.vocation).filter(Boolean)).sort();
  const datasets = vocs.map((voc) => {
    const arr = dates.map((d) => {
      const rows = byDate[d].filter((x) => x.vocation === voc);
      if (!rows.length) return null;
      const avg = rows.reduce((s, x) => s + (x.level ?? 0), 0) / rows.length;
      return Math.round(avg * 100) / 100;
    });
    return { label: voc, data: arr };
  });

  lineChart = new Chart(ctx, {
    type: "line",
    data: { labels: dates, datasets },
    options: { responsive: true, maintainAspectRatio: false, spanGaps: true },
  });
}

// BarChart: Ganancia acumulada por vocación en últimos 7 días
// Para asignar vocación por (player, date), usamos el último snapshot de ese día.
function renderBarChart(filteredSnaps, filteredGains) {
  const ctx = sel("barChart");
  if (barChart) barChart.destroy();

  const cut = new Date();
  cut.setDate(cut.getDate() - 7);
  const cutStr = cut.toISOString().slice(0, 10);

  const gainsRecent = filteredGains.filter((g) => g.date >= cutStr);

  // Mapa (player|date) -> snapshot del día (para conocer vocación del día)
  const lastByPD = lastSnapshotByPlayerDate(filteredSnaps);

  const gainsByVoc = {};
  for (const g of gainsRecent) {
    const key = `${g.player}|${g.date}`;
    const snap = lastByPD.get(key);
    const voc = (snap && snap.vocation) || "Unknown";
    gainsByVoc[voc] = (gainsByVoc[voc] || 0) + (g.gain || 0);
  }

  const labels = Object.keys(gainsByVoc).sort();
  const data = labels.map((k) => gainsByVoc[k]);

  barChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Ganancia 7 días", data }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// =====================
//  Render principal
// =====================
function render() {
  // Filtro base
  const fSnaps = applyFiltersSnap(snaps);
  const fDeaths = applyFiltersDeaths(deaths);
  const fGains = applyFiltersGains(gainsLog);

  computeKPIs(fSnaps, fGains);
  renderLineChart(fSnaps, fGains);
  renderBarChart(fSnaps, fGains);
  renderSnapTable(fSnaps, fGains);
  renderDeathTable(fDeaths);
}

function showSnap() {
  sel("deathTableSec").classList.add("hidden");
  sel("snapTableSec").classList.remove("hidden");
  sel("charts").classList.remove("hidden");
  sel("kpis").classList.remove("hidden");
}
function showDeaths() {
  sel("snapTableSec").classList.add("hidden");
  sel("charts").classList.add("hidden");
  sel("kpis").classList.add("hidden");
  sel("deathTableSec").classList.remove("hidden");
}

// =====================
//  Init
// =====================
(async function init() {
  await loadData();
  populateFilters();
  showSnap();
  render();
})();
