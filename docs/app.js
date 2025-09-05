// =====================
//  Configuración
// =====================
const SUPABASE_URL = "https://kqggdbjwwiyzhhnblfmd.supabase.co";   // <-- CAMBIA
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZ2dkYmp3d2l5emhobmJsZm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwOTkyNTgsImV4cCI6MjA3MjY3NTI1OH0.nOcDOSNOhyN_CSboaAfuHvbRQic4NPWgpL78SBG7tT0";                  // <-- CAMBIA

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Rango de días a cargar inicialmente
const DEFAULT_DAYS = 120;

// =====================
//  Estado
// =====================
let snaps = [];      // snapshots
let deaths = [];     // deaths
let gainsLog = [];   // daily_gains_log

let levelLineChart, gainLineChart, barGainByVoc, barDeathsMonthly;

// =====================
//  Utils
// =====================
const sel = (id) => document.getElementById(id);
const uniq = (arr) => [...new Set(arr)];
const byDateAsc = (a, b) => {
  const da = (a.date ?? a.death_time_utc);
  const db = (b.date ?? b.death_time_utc);
  return String(da).localeCompare(String(db));
};
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "");

function groupBy(arr, key) {
  return arr.reduce((acc, cur) => {
    const k = cur[key];
    (acc[k] ||= []).push(cur);
    return acc;
  }, {});
}

function lastSnapshotByPlayerDate(data) {
  const map = new Map(); // `${player}|${date}` -> row más reciente
  for (const r of data) {
    const key = `${r.player}|${r.date}`;
    const prev = map.get(key);
    if (!prev || (r.inserted_at || "") > (prev.inserted_at || "")) {
      map.set(key, r);
    }
  }
  return map;
}

function daysBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.floor((b - a) / 86400000);
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
    renderAll();
  });

  ["playerSelect", "vocationSelect", "startDate", "endDate"].forEach((id) =>
    sel(id).addEventListener("change", renderAll)
  );

  // Tabs
  sel("tabOverview").addEventListener("click", (e) => {
    e.preventDefault();
    showView("viewOverview");
  });
  sel("tabPlayers").addEventListener("click", (e) => {
    e.preventDefault();
    showView("viewPlayers");
  });
  sel("tabDeaths").addEventListener("click", (e) => {
    e.preventDefault();
    showView("viewDeaths");
  });
  sel("tabLeaders").addEventListener("click", (e) => {
    e.preventDefault();
    showView("viewLeaders");
  });
}

function currentFilters() {
  return {
    player: sel("playerSelect").value,
    vocation: sel("vocationSelect").value,
    start: sel("startDate").value || null,
    end: sel("endDate").value || null,
  };
}

function applyFiltersSnap(data) {
  const { player, vocation, start, end } = currentFilters();
  return data.filter((r) => {
    if (player !== "__ALL__" && r.player !== player) return false;
    if (vocation !== "__ALL__" && r.vocation !== vocation) return false;
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    return true;
  });
}

function applyFiltersDeaths(data) {
  const { player, start, end } = currentFilters();
  return data.filter((r) => {
    const d = String(r.death_time_utc);
    if (player !== "__ALL__" && r.player !== player) return false;
    if (start && d < start) return false;
    if (end && d > end + "T23:59:59Z") return false;
    return true;
  });
}

function applyFiltersGains(data) {
  const { player, start, end } = currentFilters();
  return data.filter((r) => {
    if (player !== "__ALL__" && r.player !== player) return false;
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    return true;
  });
}

// =====================
//  KPIs
// =====================
function computeKPIs(filteredSnaps, filteredGains, filteredDeaths) {
  // Jugadores activos = con snapshot más reciente
  const lastDate = filteredSnaps.map((r) => r.date).sort().at(-1);
  const latestByPlayer = Object.values(groupBy(filteredSnaps.filter((r) => r.date === lastDate), "player"))
    .map((rows) => rows.sort(byDateAsc).at(-1));
  sel("kpiPlayers").textContent = uniq(latestByPlayer.map((r) => r.player)).length || "-";

  // Avg gain 7d / 30d
  const cut7 = new Date(); cut7.setDate(cut7.getDate() - 7); const cut7s = cut7.toISOString().slice(0, 10);
  const cut30 = new Date(); cut30.setDate(cut30.getDate() - 30); const cut30s = cut30.toISOString().slice(0, 10);

  const g7 = filteredGains.filter((g) => g.date >= cut7s);
  const g30 = filteredGains.filter((g) => g.date >= cut30s);

  const avg7 = g7.length ? g7.reduce((s, x) => s + (x.gain || 0), 0) / g7.length : 0;
  const avg30 = g30.length ? g30.reduce((s, x) => s + (x.gain || 0), 0) / g30.length : 0;

  sel("kpiAvgGain7").textContent = avg7.toFixed(2);
  sel("kpiAvgGain30").textContent = avg30.toFixed(2);

  // Muertes últimos 30 días
  const deaths30 = filteredDeaths.filter((d) => new Date(d.death_time_utc) >= cut30);
  sel("kpiDeaths30").textContent = deaths30.length;

  // Streak sin morir (jugador seleccionado)
  const pSel = sel("playerSelect").value;
  if (pSel !== "__ALL__") {
    const pDeaths = filteredDeaths.filter((d) => d.player === pSel).sort(byDateAsc);
    const lastDeath = pDeaths.at(-1)?.death_time_utc;
    if (lastDeath) {
      const days = daysBetween(lastDeath, new Date().toISOString());
      sel("kpiStreakPlayer").textContent = pSel;
      sel("kpiStreakDays").textContent = `${days} días sin morir`;
    } else {
      sel("kpiStreakPlayer").textContent = pSel;
      sel("kpiStreakDays").textContent = `sin deaths registradas`;
    }
  } else {
    sel("kpiStreakPlayer").textContent = "—";
    sel("kpiStreakDays").textContent = "";
  }
}

// =====================
//  Tablas
// =====================
function renderSnapTable(filteredSnaps, filteredGains) {
  const tbody = sel("snapTable");
  if (!tbody) return;
  if (!filteredSnaps.length) {
    tbody.innerHTML = `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
    return;
  }

  const byPlayer = groupBy(filteredSnaps, "player");
  const last7 = new Date(); last7.setDate(last7.getDate() - 7);
  const last7Str = last7.toISOString().slice(0, 10);

  const html = Object.values(byPlayer).map((list) => {
    const srt = list.sort(byDateAsc);
    const latest = srt.at(-1);
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
  }).join("");

  tbody.innerHTML = html;
}

function renderDeathTable(filteredDeaths) {
  const tbody = sel("deathTable");
  if (!tbody) return;
  if (!filteredDeaths.length) {
    tbody.innerHTML = `<tr><td class="py-3 text-slate-400">Sin deaths en el rango</td></tr>`;
    return;
  }

  const now = Date.now();
  const html = filteredDeaths.sort(byDateAsc).reverse().map((d) => {
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

  tbody.innerHTML = html;
}

// =====================
//  Leaderboards
// =====================
function renderLeaderboards(filteredGains, filteredDeaths) {
  const cut7 = new Date(); cut7.setDate(cut7.getDate() - 7); const cut7s = cut7.toISOString().slice(0, 10);
  const cut30 = new Date(); cut30.setDate(cut30.getDate() - 30); const cut30s = cut30.toISOString().slice(0, 10);

  // Top gainers 7d
  const map7 = {};
  filteredGains.filter((g) => g.date >= cut7s).forEach((g) => {
    map7[g.player] = (map7[g.player] || 0) + (g.gain || 0);
  });
  const top7 = Object.entries(map7).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Top gainers 30d
  const map30 = {};
  filteredGains.filter((g) => g.date >= cut30s).forEach((g) => {
    map30[g.player] = (map30[g.player] || 0) + (g.gain || 0);
  });
  const top30 = Object.entries(map30).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Más muertes 30d
  const deaths30 = filteredDeaths.filter((d) => new Date(d.death_time_utc) >= cut30);
  const dmap = {};
  deaths30.forEach((d) => { dmap[d.player] = (dmap[d.player] || 0) + 1; });
  const dtop = Object.entries(dmap).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const lb7 = sel("lb7"), lb30 = sel("lb30"), lbDeaths = sel("lbDeaths");
  if (lb7) lb7.innerHTML = top7.map(([p, g]) => `<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">+${g}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
  if (lb30) lb30.innerHTML = top30.map(([p, g]) => `<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">+${g}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
  if (lbDeaths) lbDeaths.innerHTML = dtop.map(([p, c]) => `<tr class="border-t border-slate-800"><td class="py-2">${p}</td><td class="py-2 text-right">${c}</td></tr>`).join("") || `<tr><td class="py-3 text-slate-400">Sin datos</td></tr>`;
}

// =====================
//  Gráficas
// =====================
function renderLevelLine(filteredSnaps) {
  const ctx = sel("levelLineChart");
  if (!ctx) return;
  if (levelLineChart) levelLineChart.destroy();

  const pSel = sel("playerSelect").value;
  const byDate = groupBy(filteredSnaps, "date");

  if (pSel !== "__ALL__") {
    const series = filteredSnaps.filter((r) => r.player === pSel).sort(byDateAsc);
    levelLineChart = new Chart(ctx, {
      type: "line",
      data: { labels: series.map((r) => r.date), datasets: [{ label: `Level - ${pSel}`, data: series.map((r) => r.level ?? 0) }] },
      options: { responsive: true, maintainAspectRatio: false, spanGaps: true },
    });
  } else {
    // Promedio de level por vocación por día
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
    levelLineChart = new Chart(ctx, {
      type: "line",
      data: { labels: dates, datasets },
      options: { responsive: true, maintainAspectRatio: false, spanGaps: true },
    });
  }
}

function renderGainLine(filteredGains) {
  const ctx = sel("gainLineChart");
  if (!ctx) return;
  if (gainLineChart) gainLineChart.destroy();

  const pSel = sel("playerSelect").value;
  const series = pSel === "__ALL__"
    ? []
    : filteredGains.filter((g) => g.player === pSel).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  gainLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: series.map((r) => r.date),
      datasets: [{ label: `Ganancia diaria - ${pSel === "__ALL__" ? "Selecciona un jugador" : pSel}`, data: series.map((r) => r.gain ?? 0) }],
    },
    options: { responsive: true, maintainAspectRatio: false, spanGaps: true },
  });
}

function renderBarGainByVoc(filteredSnaps, filteredGains) {
  const ctx = sel("barGainByVoc");
  if (!ctx) return;
  if (barGainByVoc) barGainByVoc.destroy();

  const cut = new Date(); cut.setDate(cut.getDate() - 7); const cutStr = cut.toISOString().slice(0, 10);
  const gainsRecent = filteredGains.filter((g) => g.date >= cutStr);
  const lastByPD = lastSnapshotByPlayerDate(filteredSnaps);
  const sums = {};

  for (const g of gainsRecent) {
    const key = `${g.player}|${g.date}`;
    const snap = lastByPD.get(key);
    const voc = (snap && snap.vocation) || "Unknown";
    sums[voc] = (sums[voc] || 0) + (g.gain || 0);
  }

  const labels = Object.keys(sums).sort();
  const data = labels.map((k) => sums[k]);

  barGainByVoc = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Ganancia 7 días", data }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function renderBarDeathsMonthly(filteredDeaths) {
  const ctx = sel("barDeathsMonthly");
  if (!ctx) return;
  if (barDeathsMonthly) barDeathsMonthly.destroy();

  // Agrupa por YYYY-MM (últimos 6 meses)
  const now = new Date();
  const sixAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const buckets = {};
  for (let i = 0; i < 6; i++) {
    const dt = new Date(sixAgo.getFullYear(), sixAgo.getMonth() + i, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = 0;
  }
  filteredDeaths.forEach((d) => {
    const m = d.death_time_utc.slice(0, 7);
    if (m in buckets) buckets[m] += 1;
  });

  const labels = Object.keys(buckets);
  const data = labels.map((k) => buckets[k]);

  barDeathsMonthly = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Muertes por mes", data }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

// =====================
//  Render de cada vista
// =====================
function renderOverview() {
  const fSnaps = applyFiltersSnap(snaps);
  const fDeaths = applyFiltersDeaths(deaths);
  const fGains = applyFiltersGains(gainsLog);

  computeKPIs(fSnaps, fGains, fDeaths);
  renderLevelLine(fSnaps);
  renderGainLine(fGains);
  renderBarGainByVoc(fSnaps, fGains);
  renderBarDeathsMonthly(fDeaths);
}

function renderPlayers() {
  const fSnaps = applyFiltersSnap(snaps);
  const fGains = applyFiltersGains(gainsLog);
  renderSnapTable(fSnaps, fGains);
}

function renderDeathsView() {
  const fDeaths = applyFiltersDeaths(deaths);
  renderDeathTable(fDeaths);
}

function renderLeaders() {
  const fGains = applyFiltersGains(gainsLog);
  const fDeaths = applyFiltersDeaths(deaths);
  renderLeaderboards(fGains, fDeaths);
}

function renderAll() {
  const current = document.querySelector("section:not(.hidden)[id^='view']");
  if (!current) return;
  switch (current.id) {
    case "viewOverview":   renderOverview(); break;
    case "viewPlayers":    renderPlayers(); break;
    case "viewDeaths":     renderDeathsView(); break;
    case "viewLeaders":    renderLeaders(); break;
  }
}

function showView(viewId) {
  ["viewOverview","viewPlayers","viewDeaths","viewLeaders"].forEach(id=>{
    sel(id).classList.toggle("hidden", id !== viewId);
  });
  renderAll();
}

// =====================
//  Init
// =====================
(async function init() {
  await loadData();
  populateFilters();
  showView("viewOverview");
  renderAll();
})();
