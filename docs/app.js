/* global Papa, Chart, dayjs */
const CSV_URL = "data/levels.csv";

let raw = [];        // {date, player, vocation, level}
let players = [];
let vocations = [];
let lineChart, barChart;

// Utilidades
const byDateAsc = (a, b) => a.date.localeCompare(b.date);
const parseRow = (r) => ({
  date: r.date,
  player: r.player,
  vocation: r.vocation || "",
  level: Number(r.level || 0),
});
const uniq = (arr) => [...new Set(arr)];
const fmtDate = (d) => dayjs(d).format("YYYY-MM-DD");

async function loadCSV() {
  return new Promise((resolve, reject) => {
    Papa.parse(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.map(parseRow)),
      error: reject,
    });
  });
}

function buildFilters() {
  players = uniq(raw.map((r) => r.player)).sort((a, b) => a.localeCompare(b));
  vocations = uniq(raw.map((r) => r.vocation)).filter(Boolean).sort((a,b)=>a.localeCompare(b));

  const playerSel = document.getElementById("playerSelect");
  const vocSel = document.getElementById("vocationSelect");

  playerSel.innerHTML = `<option value="__ALL__">Todos</option>` + players.map(p => `<option>${p}</option>`).join("");
  vocSel.innerHTML = `<option value="__ALL__">Todas</option>` + vocations.map(v => `<option>${v}</option>`).join("");

  document.getElementById("resetBtn").addEventListener("click", () => {
    playerSel.value = "__ALL__";
    vocSel.value = "__ALL__";
    document.getElementById("startDate").value = "";
    document.getElementById("endDate").value = "";
    render();
  });

  playerSel.addEventListener("change", render);
  vocSel.addEventListener("change", render);
  document.getElementById("startDate").addEventListener("change", render);
  document.getElementById("endDate").addEventListener("change", render);
}

function applyFilters(data) {
  const p = document.getElementById("playerSelect").value;
  const v = document.getElementById("vocationSelect").value;
  const sd = document.getElementById("startDate").value;
  const ed = document.getElementById("endDate").value;

  return data.filter(r => {
    if (p !== "__ALL__" && r.player !== p) return false;
    if (v !== "__ALL__" && r.vocation !== v) return false;
    if (sd && r.date < sd) return false;
    if (ed && r.date > ed) return false;
    return true;
  });
}

function groupBy(arr, key) {
  return arr.reduce((acc, cur) => {
    const k = cur[key];
    (acc[k] ||= []).push(cur);
    return acc;
  }, {});
}

function computeKPIs(filtered) {
  if (!filtered.length) return;

  // Último día disponible
  const lastDate = filtered.map(r => r.date).sort().at(-1);
  const prevDate = filtered.map(r => r.date).filter(d => d < lastDate).sort().at(-1);

  const latestByPlayer = Object.values(groupBy(filtered.filter(r => r.date === lastDate), "player"))
    .map(rows => rows.sort(byDateAsc).at(-1));

  // Δ vs día anterior (si existe)
  let deltas = [];
  if (prevDate) {
    const prevByPlayer = Object.fromEntries(
      Object.values(groupBy(filtered.filter(r => r.date === prevDate), "player"))
      .map(rows => [rows[0].player, rows.sort(byDateAsc).at(-1).level])
    );
    deltas = latestByPlayer.map(r => ({ player: r.player, gain: r.level - (prevByPlayer[r.player] ?? r.level) }));
  }

  const avgGain = deltas.length ? (deltas.reduce((s, x) => s + x.gain, 0) / deltas.length) : 0;
  const top = deltas.sort((a,b)=>b.gain-a.gain)[0] || {player:"-", gain:0};

  document.getElementById("kpiPlayers").textContent = uniq(latestByPlayer.map(r => r.player)).length;
  document.getElementById("kpiAvgGain").textContent = avgGain.toFixed(2);
  document.getElementById("kpiTop").textContent = top.player;
  document.getElementById("kpiTopGain").textContent = top.player === "-" ? "" : `+${top.gain}`;
  document.getElementById("kpiLastUpdate").textContent = lastDate || "-";
}

function renderTable(filtered) {
  const byPlayer = groupBy(filtered, "player");
  const rows = Object.values(byPlayer).map(list => list.sort(byDateAsc));

  const last7 = dayjs().subtract(7, "day").format("YYYY-MM-DD");

  const html = rows.map(list => {
    const latest = list.at(-1);
    const past = list.filter(r => r.date >= last7)[0] || list[0];
    const gain7 = latest.level - past.level;
    return `
      <tr class="border-t border-slate-800">
        <td class="py-2">${latest.player}</td>
        <td class="py-2">${latest.vocation || "-"}</td>
        <td class="py-2 text-right">${latest.level}</td>
        <td class="py-2 text-right">${gain7 >= 0 ? "+"+gain7 : gain7}</td>
        <td class="py-2 text-right">${latest.date}</td>
      </tr>`;
  }).join("");

  document.getElementById("dataTable").innerHTML = html || `<tr><td class="py-3 text-slate-400">Sin datos con los filtros actuales</td></tr>`;
}

function renderLineChart(filtered) {
  const ctx = document.getElementById("lineChart");
  if (lineChart) lineChart.destroy();

  const playerSel = document.getElementById("playerSelect").value;

  if (playerSel !== "__ALL__") {
    // Serie única del jugador
    const series = filtered.filter(r => r.player === playerSel).sort(byDateAsc);
    lineChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: series.map(r => r.date),
        datasets: [{ label: playerSel, data: series.map(r => r.level) }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    return;
  }

  // Promedio por vocation por día
  const byDate = groupBy(filtered, "date");
  const dates = Object.keys(byDate).sort();

  const vocSet = uniq(filtered.map(r => r.vocation).filter(Boolean));
  const datasets = vocSet.map(voc => {
    const arr = dates.map(d => {
      const rows = byDate[d].filter(x => x.vocation === voc);
      if (!rows.length) return null;
      const avg = rows.reduce((s, x) => s + x.level, 0) / rows.length;
      return Math.round(avg * 100) / 100;
    });
    return { label: voc, data: arr };
  });

  lineChart = new Chart(ctx, {
    type: "line",
    data: { labels: dates, datasets },
    options: { responsive: true, maintainAspectRatio: false, spanGaps: true }
  });
}

function renderBarChart(filtered) {
  const ctx = document.getElementById("barChart");
  if (barChart) barChart.destroy();

  const cut = dayjs().subtract(7, "day").format("YYYY-MM-DD");
  const recent = filtered.filter(r => r.date >= cut);

  const byPlayer = groupBy(recent, "player");
  const gainsByVoc = {};

  for (const list of Object.values(byPlayer)) {
    const sorted = list.sort(byDateAsc);
    if (sorted.length < 2) continue;
    const gain = sorted.at(-1).level - sorted[0].level;
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

function render() {
  const filtered = applyFilters(raw);
  computeKPIs(filtered);
  renderLineChart(filtered);
  renderBarChart(filtered);
  renderTable(filtered);
}

(async function init() {
  raw = (await loadCSV()).sort(byDateAsc);
  buildFilters();
  render();
})();
