let appConfig = null;
let chart = null;

const factSelect = document.getElementById("factSelect");
const timeLevel = document.getElementById("timeLevel");
const itemLevel = document.getElementById("itemLevel");
const thirdLevel = document.getElementById("thirdLevel");
const thirdLabel = document.getElementById("thirdLabel");
const mvName = document.getElementById("mvName");
const rowCount = document.getElementById("rowCount");
const primaryMetricLabel = document.getElementById("primaryMetricLabel");
const primaryMetricValue = document.getElementById("primaryMetricValue");
const dataTable = document.getElementById("dataTable");
const errorBox = document.getElementById("errorBox");

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat("en-US");

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
  const current = selectEl.value;
  const idx = values.indexOf(current);
  const next = idx + direction;
  if (next >= 0 && next < values.length) {
    selectEl.value = values[next];
  }
}

function buildFilters() {
  const names = [
    "year", "quarter", "month", "item_id",
    "customer_type", "customer_id", "state", "city_code", "store_id",
  ];
  const filters = {};
  names.forEach((name) => {
    const val = document.getElementById(`f_${name}`).value.trim();
    if (val !== "") {
      filters[name] = /^\d+$/.test(val) ? Number(val) : val;
    }
  });
  return filters;
}

function syncTimeLevelWithFilters() {
  const monthFilter = document.getElementById("f_month").value.trim();
  const quarterFilter = document.getElementById("f_quarter").value.trim();

  if (monthFilter !== "") {
    timeLevel.value = "yqm";
    return;
  }

  if (quarterFilter !== "") {
    if (timeLevel.value === "none" || timeLevel.value === "year") {
      timeLevel.value = "yq";
    }
  }
}

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCellValue(value) {
  if (isNumeric(value)) {
    return numberFormatter.format(value);
  }
  return value ?? "";
}

function formatCompactValue(value) {
  if (!isNumeric(value)) {
    return "-";
  }
  return compactFormatter.format(value);
}

function formatTimeLabel(row) {
  const parts = [];

  if (row.year !== undefined && row.year !== null && row.year !== "") {
    parts.push(String(row.year));
  }

  if (row.quarter !== undefined && row.quarter !== null && row.quarter !== "") {
    parts.push(`Q${row.quarter}`);
  }

  if (row.month !== undefined && row.month !== null && row.month !== "") {
    parts.push(`M${String(row.month).padStart(2, "0")}`);
  }

  return parts.join(" / ");
}

function buildChartLabel(row) {
  const parts = [];
  const timeLabel = formatTimeLabel(row);
  if (timeLabel) {
    parts.push(timeLabel);
  }

  if (itemLevel.value === "item") {
    const itemLabel = row.item_name || row.item_id;
    if (itemLabel !== undefined && itemLabel !== null && itemLabel !== "") {
      parts.push(String(itemLabel));
    }
  }

  if (factSelect.value === "sold") {
    if (thirdLevel.value === "custtype" || thirdLevel.value === "custtype_cust") {
      const customerLabel = row.customer_type || row.customer_name || row.customer_id;
      if (customerLabel !== undefined && customerLabel !== null && customerLabel !== "") {
        parts.push(String(customerLabel));
      }
    }
  } else {
    if (thirdLevel.value === "state" || thirdLevel.value === "state_city" || thirdLevel.value === "state_city_store") {
      const geoParts = [];
      if (row.state !== undefined && row.state !== null && row.state !== "") {
        geoParts.push(String(row.state));
      }
      if (row.city_name !== undefined && row.city_name !== null && row.city_name !== "") {
        geoParts.push(String(row.city_name));
      } else if (row.city_code !== undefined && row.city_code !== null && row.city_code !== "") {
        geoParts.push(`City ${row.city_code}`);
      }
      if (row.store_id !== undefined && row.store_id !== null && row.store_id !== "") {
        geoParts.push(`Store ${row.store_id}`);
      }
      if (geoParts.length) {
        parts.push(geoParts.join(" / "));
      }
    }
  }

  if (!parts.length) {
    const fallback = row.item_name || row.customer_name || row.state || row.city_name || row.store_id;
    return String(fallback ?? "-");
  }

  return parts.join(" | ");
}

function updateKpis(columns, rows, resolvedMv) {
  mvName.textContent = resolvedMv || "-";
  rowCount.textContent = numberFormatter.format(rows.length);

  const metrics = pickMetrics(columns);
  if (!metrics.length || !rows.length) {
    primaryMetricLabel.textContent = "Primary Metric";
    primaryMetricValue.textContent = "-";
    return;
  }

  const metric = metrics[0];
  const total = rows.reduce((sum, row) => {
    const val = Number(row[metric] ?? 0);
    return Number.isFinite(val) ? sum + val : sum;
  }, 0);

  primaryMetricLabel.textContent = metric;
  primaryMetricValue.textContent = formatCompactValue(total);
}

function applySliceFromRow(row) {
  const keys = [
    "year", "quarter", "month", "item_id",
    "customer_type", "customer_id", "state", "city_code", "store_id",
  ];
  keys.forEach((k) => {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") {
      document.getElementById(`f_${k}`).value = row[k];
    }
  });
}

function renderTable(columns, rows) {
  dataTable.innerHTML = "";
  if (!columns || columns.length === 0) {
    return;
  }

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
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
    tr.addEventListener("click", () => {
      applySliceFromRow(row);
      errorBox.textContent = "Slice loaded from selected row. Press Apply View.";
    });
    tbody.appendChild(tr);
  });

  dataTable.appendChild(thead);
  dataTable.appendChild(tbody);
}

function pickMetrics(columns) {
  const preferred = [
    "total_revenue", "total_stock", "total_quantity", "total_transactions", "num_customers", "num_items", "num_stores"
  ];
  return preferred.filter((c) => columns.includes(c));
}

function renderChart(columns, rows) {
  const metrics = pickMetrics(columns);
  if (!rows.length || !metrics.length) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }

  const labels = rows.slice(0, 20).map((r) => buildChartLabel(r));

  const chartTitle = timeLevel.value === "yqm"
    ? "Chart label: year / quarter / month"
    : timeLevel.value === "yq"
      ? "Chart label: year / quarter"
      : timeLevel.value === "year"
        ? "Chart label: year"
        : "Chart label: selected hierarchy";

  const datasets = metrics.slice(0, 2).map((m, i) => ({
    label: m,
    data: rows.slice(0, 20).map((r) => Number(r[m] ?? 0)),
    borderWidth: 2,
    borderColor: i === 0 ? "#0f766e" : "#155e75",
    backgroundColor: i === 0 ? "rgba(15,118,110,0.2)" : "rgba(21,94,117,0.2)",
  }));
  console.log("labels:", labels);
  console.log("datasets[0].data:", datasets[0]?.data);
  console.log("labels.length:", labels.length, "data.length:", datasets[0]?.data?.length);
  const ctx = document.getElementById("chart");
  if (chart) {
    chart.destroy();
  }
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,

      plugins: {
        legend: { position: "top" },
        title: {
          display: true,
          text: chartTitle,
        },
      },
      // Ensure category axis and bar alignment
      scales: {
        x: {

          ticks: { maxRotation: 45, minRotation: 0 },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => numberFormatter.format(value)
          },
        },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

async function loadData() {
  errorBox.textContent = "";
  syncTimeLevelWithFilters();
  const payload = {
    fact: factSelect.value,
    time_level: timeLevel.value,
    item_level: itemLevel.value,
    third_level: thirdLevel.value,
    filters: buildFilters(),
  };

  try {
    const resp = await fetch("/api/cuboid-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Request failed");

    // ── NEW: feed pivot module ──────────────────────────────────────
    if (window.PivotModule) {
      window.PivotModule.setData(data.columns, data.rows);
      window.PivotModule.refreshFieldList();
    }
    // ───────────────────────────────────────────────────────────────

    const pivotActive = document.getElementById("pivotContainer")?.style.display !== "none";

    if (!pivotActive) {
      // Original behavior when pivot is NOT open
      updateKpis(data.columns, data.rows, data.mv_name);
      renderTable(data.columns, data.rows);
      renderChart(data.columns, data.rows);
    } else {
      // Still update KPIs (they live outside pivot)
      updateKpis(data.columns, data.rows, data.mv_name);
    }

  } catch (err) {
    errorBox.textContent = err.message;
  }
}

function bindRollButtons(prefix, selectEl) {
  document.getElementById(`${prefix}Up`).addEventListener("click", () => {
    moveLevel(selectEl, -1);
  });
  document.getElementById(`${prefix}Down`).addEventListener("click", () => {
    moveLevel(selectEl, +1);
  });
}

function clearFilters() {
  [
    "year", "quarter", "month", "item_id",
    "customer_type", "customer_id", "state", "city_code", "store_id",
  ].forEach((x) => {
    document.getElementById(`f_${x}`).value = "";
  });
  errorBox.textContent = "";
}

function toggleFactSliceFields() {
  const fact = factSelect.value;
  const soldFields = document.querySelectorAll(".slice-sold");
  const stockFields = document.querySelectorAll(".slice-stock");

  soldFields.forEach((el) => {
    el.classList.toggle("hidden", fact !== "sold");
  });

  stockFields.forEach((el) => {
    el.classList.toggle("hidden", fact !== "stock");
  });
}

function refreshDimensionOptions() {
  const fact = factSelect.value;
  const cfg = appConfig[fact];
  setOptions(timeLevel, cfg.dimensions.time);
  setOptions(itemLevel, cfg.dimensions.item);
  setOptions(thirdLevel, cfg.dimensions.third);
  thirdLabel.textContent = `${cfg.third_label} level`;
  toggleFactSliceFields();
}

async function init() {
  const resp = await fetch("/api/config");
  appConfig = await resp.json();

  setOptions(factSelect, Object.keys(appConfig));
  refreshDimensionOptions();

  factSelect.addEventListener("change", () => {
    refreshDimensionOptions();
    clearFilters();
  });

  document.getElementById("loadBtn").addEventListener("click", loadData);
  document.getElementById("clearBtn").addEventListener("click", clearFilters);

  bindRollButtons("time", timeLevel);
  bindRollButtons("item", itemLevel);
  bindRollButtons("third", thirdLevel);

  // ── NEW: pivot toggle ─────────────────────────────────────────────
  const pivotToggleBtn = document.getElementById("pivotToggleBtn");
  const pivotContainer = document.getElementById("pivotContainer");

  if (pivotToggleBtn && pivotContainer && window.PivotModule) {
    let pivotInitialized = false;

    pivotToggleBtn.addEventListener("click", () => {
      const isHidden = pivotContainer.style.display === "none";
      pivotContainer.style.display = isHidden ? "block" : "none";
      pivotToggleBtn.textContent = isHidden ? "⬡ Close Pivot" : "⬡ Pivot View";

      if (isHidden && !pivotInitialized) {
        window.PivotModule.init(pivotContainer);
        pivotInitialized = true;
      }
    });
  }
  // ──────────────────────────────────────────────────────────────────

  await loadData();
}

init();
