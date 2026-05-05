let appConfig = null;
let chart = null;
// pivot mode flag
let pivotMode = false;

const factSelect  = document.getElementById("factSelect");
const timeLevel   = document.getElementById("timeLevel");
const itemLevel   = document.getElementById("itemLevel");
const thirdLevel  = document.getElementById("thirdLevel");
const thirdLabel  = document.getElementById("thirdLabel");
const mvName      = document.getElementById("mvName");
const rowCount    = document.getElementById("rowCount");
const primaryMetricLabel = document.getElementById("primaryMetricLabel");
const primaryMetricValue = document.getElementById("primaryMetricValue");
const dataTable   = document.getElementById("dataTable");
const errorBox    = document.getElementById("errorBox");

// Pivot UI elements (added in index.html)
const pivotToggle   = document.getElementById("pivotToggle");
const pivotPanel    = document.getElementById("pivotPanel");
const pivotColSel   = document.getElementById("pivotCol");
const pivotValSel   = document.getElementById("pivotVal");
const pivotRowSel   = document.getElementById("pivotRow");

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numberFormatter = new Intl.NumberFormat("en-US");

// ─── Helpers ────────────────────────────────────────────────────────────────

function setOptions(selectEl, values) {
  selectEl.innerHTML = "";
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function moveLevel(selectEl, direction) {
  const values = Array.from(selectEl.options).map((o) => o.value);
  const idx    = values.indexOf(selectEl.value);
  const next   = idx + direction;
  if (next >= 0 && next < values.length) selectEl.value = values[next];
}

function buildFilters() {
  const names = [
    "year", "quarter", "month", "item_id",
    "customer_type", "customer_id", "state", "city_code", "store_id",
  ];
  const filters = {};
  names.forEach((name) => {
    const val = document.getElementById(`f_${name}`).value.trim();
    if (val !== "") filters[name] = /^\d+$/.test(val) ? Number(val) : val;
  });
  return filters;
}

function syncTimeLevelWithFilters() {
  const monthFilter   = document.getElementById("f_month").value.trim();
  const quarterFilter = document.getElementById("f_quarter").value.trim();
  if (monthFilter !== "") { timeLevel.value = "yqm"; return; }
  if (quarterFilter !== "" && (timeLevel.value === "none" || timeLevel.value === "year")) {
    timeLevel.value = "yq";
  }
}

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCellValue(value) {
  if (isNumeric(value)) return numberFormatter.format(value);
  return value ?? "";
}

function formatCompactValue(value) {
  return isNumeric(value) ? compactFormatter.format(value) : "-";
}

function formatTimeLabel(row) {
  const parts = [];
  if (row.year    != null && row.year    !== "") parts.push(String(row.year));
  if (row.quarter != null && row.quarter !== "") parts.push(`Q${row.quarter}`);
  if (row.month   != null && row.month   !== "") parts.push(`M${String(row.month).padStart(2, "0")}`);
  return parts.join(" / ");
}

function buildChartLabel(row) {
  const parts = [];
  const timeLabel = formatTimeLabel(row);
  if (timeLabel) parts.push(timeLabel);

  if (itemLevel.value === "item") {
    const itemLabel = row.item_name || row.item_id;
    if (itemLabel != null && itemLabel !== "") parts.push(String(itemLabel));
  }

  if (factSelect.value === "sold") {
    if (thirdLevel.value === "custtype" || thirdLevel.value === "custtype_cust") {
      const lbl = row.customer_type || row.customer_name || row.customer_id;
      if (lbl != null && lbl !== "") parts.push(String(lbl));
    }
  } else {
    if (["state","state_city","state_city_store"].includes(thirdLevel.value)) {
      const geo = [];
      if (row.state     != null && row.state     !== "") geo.push(String(row.state));
      if (row.city_name != null && row.city_name !== "") geo.push(String(row.city_name));
      else if (row.city_code != null) geo.push(`City ${row.city_code}`);
      if (row.store_id  != null && row.store_id  !== "") geo.push(`Store ${row.store_id}`);
      if (geo.length) parts.push(geo.join(" / "));
    }
  }

  if (!parts.length) {
    const fallback = row.item_name || row.customer_name || row.state || row.city_name || row.store_id;
    return String(fallback ?? "-");
  }
  return parts.join(" | ");
}

function pickMetrics(columns) {
  const preferred = [
    "total_revenue","total_stock","total_quantity",
    "total_transactions","num_customers","num_items","num_stores",
  ];
  return preferred.filter((c) => columns.includes(c));
}

// ─── KPI / Table / Chart ────────────────────────────────────────────────────

function updateKpis(columns, rows, resolvedMv) {
  mvName.textContent   = resolvedMv || "-";
  rowCount.textContent = numberFormatter.format(rows.length);

  const metrics = pickMetrics(columns);
  if (!metrics.length || !rows.length) {
    primaryMetricLabel.textContent = "Primary Metric";
    primaryMetricValue.textContent = "-";
    return;
  }
  const metric = metrics[0];
  const total  = rows.reduce((sum, row) => {
    const val = Number(row[metric] ?? 0);
    return Number.isFinite(val) ? sum + val : sum;
  }, 0);
  primaryMetricLabel.textContent = metric;
  primaryMetricValue.textContent = formatCompactValue(total);
}

function applySliceFromRow(row) {
  ["year","quarter","month","item_id","customer_type","customer_id","state","city_code","store_id"]
    .forEach((k) => {
      if (row[k] != null && row[k] !== "") {
        document.getElementById(`f_${k}`).value = row[k];
      }
    });
}

function renderTable(columns, rows, allowSlice = true) {
  dataTable.innerHTML = "";
  if (!columns || !columns.length) return;

  const thead = document.createElement("thead");
  const trh   = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[c]);
      tr.appendChild(td);
    });
    if (allowSlice) {
      tr.addEventListener("click", () => {
        applySliceFromRow(row);
        errorBox.textContent = "Slice loaded from selected row. Press Apply View.";
      });
    }
    tbody.appendChild(tr);
  });

  dataTable.appendChild(thead);
  dataTable.appendChild(tbody);
}

function renderChart(columns, rows) {
  const metrics = pickMetrics(columns);
  if (!rows.length || !metrics.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const labels = rows.slice(0, 20).map((r) => buildChartLabel(r));
  const datasets = metrics.slice(0, 2).map((m, i) => ({
    label:           m,
    data:            rows.slice(0, 20).map((r) => Number(r[m] ?? 0)),
    borderWidth:     2,
    borderColor:     i === 0 ? "#0f766e" : "#155e75",
    backgroundColor: i === 0 ? "rgba(15,118,110,0.2)" : "rgba(21,94,117,0.2)",
  }));

  const ctx = document.getElementById("chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        title: { display: false },
      },
      scales: { x: { ticks: { maxRotation: 45, minRotation: 0 } } },
    },
  });
}

// ─── Pivot chart: stacked bar, mỗi series = 1 giá trị của pivot_col ─────────

function renderPivotChart(columns, rows, rowDim) {
  const pivotCols = columns.filter((c) => c !== rowDim);
  if (!rows.length || !pivotCols.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const labels   = rows.slice(0, 20).map((r) => String(r[rowDim]));
  const palette  = [
    "#0f766e","#155e75","#0369a1","#6d28d9","#b45309",
    "#be185d","#15803d","#b91c1c","#0e7490","#7c3aed",
  ];
  const datasets = pivotCols.map((col, i) => ({
    label:           col,
    data:            rows.slice(0, 20).map((r) => Number(r[col] ?? 0)),
    backgroundColor: palette[i % palette.length] + "cc",
    borderColor:     palette[i % palette.length],
    borderWidth:     1,
  }));

  const ctx = document.getElementById("chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        title: {
          display: true,
          text: `Pivot: ${rowDim} × ${pivotCols.join(", ")}`,
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 0 } },
        y: { stacked: true },
      },
    },
  });
}

// ─── Populate pivot dropdowns based on active MV columns ────────────────────

function refreshPivotDropdowns(columns) {
  const numericCols = columns; // let user choose; backend validates
  const ALL = columns;

  setOptions(pivotColSel, ALL);
  setOptions(pivotValSel, ALL);
  setOptions(pivotRowSel, ALL);

  // Sensible defaults
  const defaultPivotCol = ALL.find((c) => ["year","quarter","month","state","customer_type"].includes(c)) || ALL[0];
  const defaultPivotVal = ALL.find((c) => ["total_price","quantity","total_revenue","total_stock"].includes(c)) || ALL[1] || ALL[0];
  const defaultRowDim   = ALL.find((c) => ["item_id","customer_id","store_id"].includes(c)) || ALL[0];

  if (defaultPivotCol) pivotColSel.value = defaultPivotCol;
  if (defaultPivotVal) pivotValSel.value = defaultPivotVal;
  if (defaultRowDim)   pivotRowSel.value = defaultRowDim;
}

// ─── Load handlers ───────────────────────────────────────────────────────────

async function loadData() {
  errorBox.textContent = "";
  syncTimeLevelWithFilters();

  const payload = {
    fact:        factSelect.value,
    time_level:  timeLevel.value,
    item_level:  itemLevel.value,
    third_level: thirdLevel.value,
    filters:     buildFilters(),
  };

  try {
    const resp = await fetch("/api/cuboid-data", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Request failed");

    updateKpis(data.columns, data.rows, data.mv_name);
    renderTable(data.columns, data.rows, true);
    renderChart(data.columns, data.rows);

    // Update pivot dropdowns with the real columns from this MV
    refreshPivotDropdowns(data.columns);
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

async function loadPivot() {
  errorBox.textContent = "";
  syncTimeLevelWithFilters();

  const payload = {
    fact:        factSelect.value,
    time_level:  timeLevel.value,
    item_level:  itemLevel.value,
    third_level: thirdLevel.value,
    filters:     buildFilters(),
    pivot_col:   pivotColSel.value,
    pivot_val:   pivotValSel.value,
    row_dim:     pivotRowSel.value,
  };

  try {
    const resp = await fetch("/api/pivot-data", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Pivot request failed");

    // KPI
    mvName.textContent   = data.mv_name + "  [PIVOT]";
    rowCount.textContent = numberFormatter.format(data.row_count);
    primaryMetricLabel.textContent = data.pivot_val;

    const total = data.rows.reduce((sum, row) => {
      const pivotCols = data.columns.filter((c) => c !== data.row_dim);
      const rowTotal  = pivotCols.reduce((s, c) => s + Number(row[c] ?? 0), 0);
      return sum + rowTotal;
    }, 0);
    primaryMetricValue.textContent = formatCompactValue(total);

    // Table — no slice for pivot
    renderTable(data.columns, data.rows, false);

    // Stacked bar chart
    renderPivotChart(data.columns, data.rows, data.row_dim);
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

// ─── Apply View button: route to correct loader ──────────────────────────────

function handleApply() {
  if (pivotMode) loadPivot();
  else            loadData();
}

// ─── Pivot toggle ────────────────────────────────────────────────────────────

function togglePivot() {
  pivotMode = !pivotMode;
  pivotPanel.classList.toggle("hidden", !pivotMode);
  pivotToggle.classList.toggle("active", pivotMode);
  pivotToggle.textContent = pivotMode ? "✕ Pivot ON" : "⊞ Pivot";
  errorBox.textContent = "";
  if (!pivotMode) loadData();
}

// ─── Misc ────────────────────────────────────────────────────────────────────

function clearFilters() {
  ["year","quarter","month","item_id","customer_type","customer_id","state","city_code","store_id"]
    .forEach((x) => { document.getElementById(`f_${x}`).value = ""; });
  errorBox.textContent = "";
}

function toggleFactSliceFields() {
  const fact = factSelect.value;
  document.querySelectorAll(".slice-sold").forEach((el) => el.classList.toggle("hidden", fact !== "sold"));
  document.querySelectorAll(".slice-stock").forEach((el) => el.classList.toggle("hidden", fact !== "stock"));
}

function refreshDimensionOptions() {
  const fact = factSelect.value;
  const cfg  = appConfig[fact];
  setOptions(timeLevel,  cfg.dimensions.time);
  setOptions(itemLevel,  cfg.dimensions.item);
  setOptions(thirdLevel, cfg.dimensions.third);
  thirdLabel.textContent = `${cfg.third_label} level`;
  toggleFactSliceFields();
}

function bindRollButtons(prefix, selectEl) {
  document.getElementById(`${prefix}Up`).addEventListener("click",   () => moveLevel(selectEl, -1));
  document.getElementById(`${prefix}Down`).addEventListener("click", () => moveLevel(selectEl, +1));
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const resp = await fetch("/api/config");
  appConfig  = await resp.json();

  setOptions(factSelect, Object.keys(appConfig));
  refreshDimensionOptions();

  factSelect.addEventListener("change", () => {
    refreshDimensionOptions();
    clearFilters();
  });

  document.getElementById("loadBtn").addEventListener("click", handleApply);
  document.getElementById("clearBtn").addEventListener("click", clearFilters);
  pivotToggle.addEventListener("click", togglePivot);

  bindRollButtons("time",  timeLevel);
  bindRollButtons("item",  itemLevel);
  bindRollButtons("third", thirdLevel);

  await loadData();
}

init();