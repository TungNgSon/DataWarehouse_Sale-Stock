/**
 * pivot-module.js
 * Interactive PivotTable module for Data Warehouse UI
 * Integrates with existing app: reuses lastFetched.columns / lastFetched.rows
 * Depends on Chart.js (already loaded by host page)
 */

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
const pivotState = {
  rowFields: [],
  columnFields: [],
  valueFields: [],   // [{ field, aggFunc }]
  filterFields: [],  // [{ field, value }]
  chartType: "bar",  // "bar" | "stacked"
  _cache: null,      // { key, result }
  _chart: null,
};

/** Shared reference to the host app's last-fetched data */
let lastFetched = { columns: [], rows: [] };

/** Called by host app after every successful /api/cuboid-data response */
function setPivotData(columns, rows) {
  lastFetched = { columns, rows };
  pivotState._cache = null;
  if (document.getElementById("pivotContainer")?.style.display !== "none") {
    rebuildPivot();
  }
}

// ─────────────────────────────────────────────
// AGGREGATION HELPERS
// ─────────────────────────────────────────────
const AGG_FUNCS = {
  sum:   (vals) => vals.reduce((a, b) => a + b, 0),
  count: (vals) => vals.length,
  avg:   (vals) => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
};

function aggregate(values, aggFunc) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return AGG_FUNCS[aggFunc]?.(nums) ?? null;
}

// ─────────────────────────────────────────────
// PIVOT DATA ENGINE
// ─────────────────────────────────────────────

/**
 * pivotData(rows, rowFields, columnFields, valueFields, filterFields)
 *
 * Returns:
 * {
 *   rowKeys:    string[][]   – unique row tuples
 *   colKeys:    string[][]   – unique col tuples
 *   cells:      Map<rowKey, Map<colKey, Map<valueField, number|null>>>
 *   rowFields, colFields, valueFields
 * }
 */
function pivotData(rows, rowFields, columnFields, valueFields, filterFields) {
  // 1. Apply filters
  let filtered = rows;
  for (const { field, value } of filterFields) {
    if (value === "" || value === null || value === undefined) continue;
    filtered = filtered.filter((r) => String(r[field]) === String(value));
  }

  // 2. Group into a nested Map: rowKey → colKey → valueField → raw[]
  const rowKeySet   = new Map(); // rowKey string → tuple
  const colKeySet   = new Map();
  const accumulator = new Map(); // "rowKey|colKey" → { fieldName → number[] }

  for (const row of filtered) {
    const rowTuple = rowFields.map((f) => row[f] ?? "");
    const colTuple = columnFields.length ? columnFields.map((f) => row[f] ?? "") : ["(total)"];
    const rk = JSON.stringify(rowTuple);
    const ck = JSON.stringify(colTuple);

    if (!rowKeySet.has(rk)) rowKeySet.set(rk, rowTuple);
    if (!colKeySet.has(ck)) colKeySet.set(ck, colTuple);

    const cellKey = `${rk}||${ck}`;
    if (!accumulator.has(cellKey)) {
      accumulator.set(cellKey, Object.fromEntries(valueFields.map(({ field }) => [field, []])));
    }
    const cell = accumulator.get(cellKey);
    for (const { field } of valueFields) {
      const v = Number(row[field]);
      if (Number.isFinite(v)) cell[field].push(v);
    }
  }

  // 3. Build sorted row/col key lists
  const rowKeys = [...rowKeySet.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, t]) => t);
  const colKeys = [...colKeySet.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, t]) => t);

  // 4. Build cells map: rowKey → colKey → field → aggregated value
  const cells = new Map();
  for (const rowTuple of rowKeys) {
    const rk = JSON.stringify(rowTuple);
    const colMap = new Map();
    for (const colTuple of colKeys) {
      const ck = JSON.stringify(colTuple);
      const cellKey = `${rk}||${ck}`;
      const raw = accumulator.get(cellKey);
      const fieldMap = new Map();
      for (const { field, aggFunc } of valueFields) {
        fieldMap.set(field, raw ? aggregate(raw[field], aggFunc) : null);
      }
      colMap.set(ck, fieldMap);
    }
    cells.set(rk, colMap);
  }

  return { rowKeys, colKeys, cells, rowFields, columnFields, valueFields };
}

// ─────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────
function getCachedPivot() {
  const key = JSON.stringify({
    rowFields:    pivotState.rowFields,
    columnFields: pivotState.columnFields,
    valueFields:  pivotState.valueFields,
    filterFields: pivotState.filterFields,
    rowCount:     lastFetched.rows.length,
  });
  if (pivotState._cache?.key === key) return pivotState._cache.result;
  const result = pivotData(
    lastFetched.rows,
    pivotState.rowFields,
    pivotState.columnFields,
    pivotState.valueFields,
    pivotState.filterFields
  );
  pivotState._cache = { key, result };
  return result;
}

// ─────────────────────────────────────────────
// RENDER PIVOT TABLE
// ─────────────────────────────────────────────
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function renderPivotTable(result, containerEl) {
  const { rowKeys, colKeys, cells, rowFields, columnFields, valueFields } = result;

  if (!valueFields.length) {
    containerEl.innerHTML = `<p class="pv-empty">Add at least one Value field to see results.</p>`;
    return;
  }
  if (!rowFields.length) {
    containerEl.innerHTML = `<p class="pv-empty">Add at least one Row field to see results.</p>`;
    return;
  }

  // Try to reuse an existing table if present to avoid creating multiple DOM nodes
  let table = containerEl.querySelector("table.pv-table");
  const reuse = !!table;
  if (!reuse) {
    table = document.createElement("table");
    table.className = "pv-table";
  }

  // ── Header ──
  const thead = document.createElement("thead");

  // row 1: col group headers
  const tr1 = document.createElement("tr");
  // empty cells for row dimensions
  rowFields.forEach(() => tr1.appendChild(Object.assign(document.createElement("th"), { className: "pv-th pv-th-corner" })));

  for (const colTuple of colKeys) {
    const label = colTuple.join(" / ") || "(total)";
    const th = document.createElement("th");
    th.className = "pv-th pv-th-col";
    th.colSpan  = valueFields.length;
    th.textContent = label;
    tr1.appendChild(th);
  }
  thead.appendChild(tr1);

  // row 2: value sub-headers
  const tr2 = document.createElement("tr");
  rowFields.forEach((f) => {
    const th = document.createElement("th");
    th.className = "pv-th pv-th-rowdim";
    th.textContent = f;
    tr2.appendChild(th);
  });
  for (let c = 0; c < colKeys.length; c++) {
    for (const { field, aggFunc } of valueFields) {
      const th = document.createElement("th");
      th.className = "pv-th pv-th-metric";
      th.textContent = `${field} (${aggFunc})`;
      tr2.appendChild(th);
    }
  }
  thead.appendChild(tr2);
  // Replace or append thead
  const existingThead = table.querySelector("thead");
  if (existingThead) table.replaceChild(thead, existingThead); else table.appendChild(thead);

  // ── Body ──
  const tbody = document.createElement("tbody");
  for (const rowTuple of rowKeys) {
    const rk = JSON.stringify(rowTuple);
    const tr = document.createElement("tr");

    rowTuple.forEach((val) => {
      const td = document.createElement("td");
      td.className = "pv-td pv-td-rowdim";
      td.textContent = val ?? "";
      tr.appendChild(td);
    });

    const colMap = cells.get(rk);
    for (const colTuple of colKeys) {
      const ck = JSON.stringify(colTuple);
      const fieldMap = colMap?.get(ck);
      for (const { field } of valueFields) {
        const td = document.createElement("td");
        td.className = "pv-td pv-td-value";
        const v = fieldMap?.get(field);
        td.textContent = v !== null && v !== undefined ? fmt.format(v) : "–";
        tr.appendChild(td);
      }
    }
    tbody.appendChild(tr);
  }

  // ── Grand Total row ──
  const trTotal = document.createElement("tr");
  trTotal.className = "pv-tr-total";
  const tdLabel = document.createElement("td");
  tdLabel.colSpan  = rowFields.length;
  tdLabel.className = "pv-td pv-td-total-label";
  tdLabel.textContent = "Grand Total";
  trTotal.appendChild(tdLabel);

  for (const colTuple of colKeys) {
    const ck = JSON.stringify(colTuple);
    for (const { field, aggFunc } of valueFields) {
      const allVals = [];
      for (const rowTuple of rowKeys) {
        const rk = JSON.stringify(rowTuple);
        const fieldMap = cells.get(rk)?.get(ck);
        const v = fieldMap?.get(field);
        if (v !== null && v !== undefined) allVals.push(v);
      }
      const td = document.createElement("td");
      td.className = "pv-td pv-td-total";
      td.textContent = allVals.length ? fmt.format(AGG_FUNCS[aggFunc](allVals)) : "–";
      trTotal.appendChild(td);
    }
  }
  tbody.appendChild(trTotal);
  // Replace or append tbody
  const existingTbody = table.querySelector("tbody");
  if (existingTbody) table.replaceChild(tbody, existingTbody); else table.appendChild(tbody);

  // Ensure the container contains the (possibly reused) table
  if (!reuse) {
    // clear only when adding the initial table
    containerEl.innerHTML = "";
    containerEl.appendChild(table);
  }
}

// ─────────────────────────────────────────────
// RENDER PIVOT CHART
// ─────────────────────────────────────────────
const PALETTE = [
  "#0f766e","#0369a1","#7c3aed","#b45309","#be123c",
  "#166534","#1e3a5f","#4a044e","#7c2d12","#064e3b",
];

function renderPivotChart(result, canvasEl) {
  const { rowKeys, colKeys, cells, rowFields, columnFields, valueFields } = result;
  if (!valueFields.length || !rowKeys.length) {
    // if chart exists but there's nothing to show, clear it
    if (pivotState._chart) {
      pivotState._chart.data.labels = [];
      pivotState._chart.data.datasets = [];
      pivotState._chart.update();
    }
    return;
  }

  const firstValue = valueFields[0];
  const labels = rowKeys.map((t) => t.join(" / ") || "(all)");

  let datasets = [];
  if (columnFields.length && colKeys.length > 0) {
    // One series per colKey
    datasets = colKeys.map((colTuple, ci) => {
      const ck = JSON.stringify(colTuple);
      return {
        label: colTuple.join(" / ") || "(total)",
        data: rowKeys.map((rowTuple) => {
          const rk = JSON.stringify(rowTuple);
          const v  = cells.get(rk)?.get(ck)?.get(firstValue.field);
          return v ?? 0;
        }),
        backgroundColor: PALETTE[ci % PALETTE.length] + (pivotState.chartType === "stacked" ? "cc" : "55"),
        borderColor:     PALETTE[ci % PALETTE.length],
        borderWidth: 2,
      };
    });
  } else {
    const ck = JSON.stringify(["(total)"]);
    datasets = [{
      label: `${firstValue.field} (${firstValue.aggFunc})`,
      data: rowKeys.map((rowTuple) => {
        const rk = JSON.stringify(rowTuple);
        return cells.get(rk)?.get(ck)?.get(firstValue.field) ?? 0;
      }),
      backgroundColor: PALETTE[0] + "55",
      borderColor:     PALETTE[0],
      borderWidth: 2,
    }];
  }

  // If a Chart instance exists, update its data/options and call update()
  if (pivotState._chart) {
    pivotState._chart.data.labels = labels;
    pivotState._chart.data.datasets = datasets;
    // update title and stacked option
    if (pivotState._chart.options.plugins && pivotState._chart.options.plugins.title) {
      pivotState._chart.options.plugins.title.text = `${firstValue.field} (${firstValue.aggFunc}) by ${rowFields.join(", ")}`;
    }
    pivotState._chart.options.scales = pivotState._chart.options.scales || {};
    pivotState._chart.options.scales.x = pivotState._chart.options.scales.x || {};
    pivotState._chart.options.scales.y = pivotState._chart.options.scales.y || {};
    pivotState._chart.options.scales.x.stacked = pivotState.chartType === "stacked";
    pivotState._chart.options.scales.y.stacked = pivotState.chartType === "stacked";
    pivotState._chart.update();
    return;
  }

  // Otherwise create a new Chart
  pivotState._chart = new Chart(canvasEl, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        title:  { display: true, text: `${firstValue.field} (${firstValue.aggFunc}) by ${rowFields.join(", ")}` },
      },
      scales: {
        x: { stacked: pivotState.chartType === "stacked", ticks: { maxRotation: 45 } },
        y: { stacked: pivotState.chartType === "stacked", beginAtZero: true },
      },
    },
  });
}

// ─────────────────────────────────────────────
// FIELD LIST UI
// ─────────────────────────────────────────────
function createFieldList(columns, containerEl) {
  containerEl.innerHTML = "";
  const numericCols = columns.filter((c) => lastFetched.rows.some((r) => Number.isFinite(Number(r[c]))));
  const allCols = [...new Set(columns)];

  allCols.forEach((col) => {
    const tag = document.createElement("div");
    tag.className   = "pv-field-tag";
    tag.draggable   = true;
    tag.dataset.field = col;
    tag.dataset.isNumeric = numericCols.includes(col) ? "1" : "0";
    tag.innerHTML   = `<span class="pv-field-icon">${numericCols.includes(col) ? "∑" : "≡"}</span>${col}`;

    tag.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ field: col, isNumeric: numericCols.includes(col), source: "list" }));
      tag.classList.add("pv-dragging");
    });
    tag.addEventListener("dragend", () => tag.classList.remove("pv-dragging"));
    containerEl.appendChild(tag);
  });
}

// ─────────────────────────────────────────────
// DROP ZONES
// ─────────────────────────────────────────────
function makeZoneTag(field, zone, aggFunc) {
  const wrap = document.createElement("div");
  wrap.className       = "pv-zone-tag";
  wrap.draggable       = true;
  wrap.dataset.field   = field;
  wrap.dataset.zone    = zone;
  if (aggFunc) wrap.dataset.aggFunc = aggFunc;

  const label = document.createElement("span");
  label.className   = "pv-zone-tag-label";
  label.textContent = aggFunc ? `${field} (${aggFunc})` : field;
  wrap.appendChild(label);

  // Aggregation selector for value fields
  if (zone === "valueFields") {
    const sel = document.createElement("select");
    sel.className = "pv-agg-sel";
    ["sum","count","avg"].forEach((fn) => {
      const opt = document.createElement("option");
      opt.value = fn; opt.textContent = fn;
      if (fn === aggFunc) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      const entry = pivotState.valueFields.find((v) => v.field === field);
      if (entry) { entry.aggFunc = sel.value; wrap.dataset.aggFunc = sel.value; }
      scheduleRebuild();
    });
    wrap.appendChild(sel);
  }

  // Filter input
  if (zone === "filterFields") {
    const inp = document.createElement("input");
    inp.className   = "pv-filter-inp";
    inp.placeholder = "value…";
    const entry = pivotState.filterFields.find((f) => f.field === field);
    if (entry) inp.value = entry.value ?? "";
    inp.addEventListener("input", () => {
      const fe = pivotState.filterFields.find((f) => f.field === field);
      if (fe) { fe.value = inp.value; scheduleRebuild(); }
    });
    wrap.appendChild(inp);
  }

  // Remove button
  const btn = document.createElement("button");
  btn.className   = "pv-remove-btn";
  btn.textContent = "×";
  btn.title       = "Remove";
  btn.addEventListener("click", () => {
    removeFromZone(field, zone);
    renderZones();
    scheduleRebuild();
  });
  wrap.appendChild(btn);

  // Drag-within-zone reorder
  wrap.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ field, isNumeric: zone === "valueFields", source: zone, aggFunc }));
    wrap.classList.add("pv-dragging");
  });
  wrap.addEventListener("dragend", () => wrap.classList.remove("pv-dragging"));

  return wrap;
}

function removeFromZone(field, zone) {
  if (zone === "valueFields") {
    pivotState.valueFields = pivotState.valueFields.filter((v) => v.field !== field);
  } else if (zone === "filterFields") {
    pivotState.filterFields = pivotState.filterFields.filter((v) => v.field !== field);
  } else if (zone === "rowFields") {
    pivotState.rowFields = pivotState.rowFields.filter((v) => v !== field);
  } else if (zone === "columnFields") {
    pivotState.columnFields = pivotState.columnFields.filter((v) => v !== field);
  }
}

function addToZone(field, zone, aggFunc, isNumeric) {
  removeFromZone(field, "rowFields");
  removeFromZone(field, "columnFields");
  removeFromZone(field, "valueFields");
  removeFromZone(field, "filterFields");

  if (zone === "valueFields") {
    pivotState.valueFields.push({ field, aggFunc: aggFunc || (isNumeric ? "sum" : "count") });
  } else if (zone === "filterFields") {
    pivotState.filterFields.push({ field, value: "" });
  } else if (zone === "rowFields") {
    pivotState.rowFields.push(field);
  } else if (zone === "columnFields") {
    pivotState.columnFields.push(field);
  }
}

function renderZones() {
  ["rowFields","columnFields","valueFields","filterFields"].forEach((zone) => {
    const el = document.getElementById(`pv-zone-${zone}`);
    if (!el) return;
    const body = el.querySelector(".pv-zone-body");
    body.innerHTML = "";
    const list = zone === "valueFields"
      ? pivotState.valueFields.map((v) => ({ field: v.field, aggFunc: v.aggFunc }))
      : zone === "filterFields"
        ? pivotState.filterFields.map((v) => ({ field: v.field }))
        : pivotState[zone].map((f) => ({ field: f }));

    list.forEach(({ field, aggFunc }) => {
      body.appendChild(makeZoneTag(field, zone, aggFunc));
    });
  });
}

// ─────────────────────────────────────────────
// DRAG-AND-DROP SETUP
// ─────────────────────────────────────────────
function setupDragAndDrop() {
  const zones = ["rowFields","columnFields","valueFields","filterFields"];
  zones.forEach((zone) => {
    const el = document.getElementById(`pv-zone-${zone}`)?.querySelector(".pv-zone-body");
    if (!el) return;

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("pv-zone-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("pv-zone-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("pv-zone-over");
      try {
        const { field, isNumeric, aggFunc } = JSON.parse(e.dataTransfer.getData("text/plain"));
        addToZone(field, zone, aggFunc, isNumeric);
        renderZones();
        scheduleRebuild();
      } catch (_) {}
    });
  });
}

// ─────────────────────────────────────────────
// REBUILD SCHEDULER (debounce)
// ─────────────────────────────────────────────
let _rebuildTimer = null;
function scheduleRebuild() {
  clearTimeout(_rebuildTimer);
  _rebuildTimer = setTimeout(rebuildPivot, 80);
}

function rebuildPivot() {
  pivotState._cache = null;
  const result = getCachedPivot();
  const tableContainer = document.getElementById("pv-table-container");
  const chartCanvas    = document.getElementById("pv-chart");
  if (tableContainer) renderPivotTable(result, tableContainer);
  if (chartCanvas)    renderPivotChart(result, chartCanvas);
}

// ─────────────────────────────────────────────
// MOUNT / INIT
// ─────────────────────────────────────────────

/**
 * initPivotModule(hostEl)
 *
 * Call once. Injects the full pivot UI into hostEl.
 * hostEl should be a container <div> already in the DOM.
 *
 * Example:
 *   const host = document.getElementById("pivotContainer");
 *   initPivotModule(host);
 */
function initPivotModule(hostEl) {
  hostEl.innerHTML = `
    <div id="pivotModule">
      <div class="pv-toolbar">
        <span class="pv-toolbar-title">⬡ Pivot Table</span>
        <div class="pv-toolbar-right">
          <label class="pv-label">Chart:</label>
          <select id="pv-chart-type" class="pv-select">
            <option value="bar">Bar</option>
            <option value="stacked">Stacked Bar</option>
          </select>
          <button id="pv-refresh-btn" class="pv-btn">⟳ Refresh</button>
          <button id="pv-clear-btn" class="pv-btn pv-btn-ghost">✕ Clear All</button>
        </div>
      </div>

      <div class="pv-layout">
        <!-- Left: field list -->
        <div class="pv-panel pv-panel-fields">
          <div class="pv-panel-header">Fields</div>
          <div id="pv-field-list" class="pv-field-list"></div>
        </div>

        <!-- Middle: drop zones -->
        <div class="pv-zones">
          <div class="pv-zones-row">
            <div class="pv-zone" id="pv-zone-rowFields">
              <div class="pv-zone-header"><span class="pv-zone-icon">↕</span> Rows</div>
              <div class="pv-zone-body pv-zone-drop"></div>
            </div>
            <div class="pv-zone" id="pv-zone-columnFields">
              <div class="pv-zone-header"><span class="pv-zone-icon">↔</span> Columns</div>
              <div class="pv-zone-body pv-zone-drop"></div>
            </div>
          </div>
          <div class="pv-zones-row">
            <div class="pv-zone" id="pv-zone-valueFields">
              <div class="pv-zone-header"><span class="pv-zone-icon">∑</span> Values</div>
              <div class="pv-zone-body pv-zone-drop"></div>
            </div>
            <div class="pv-zone" id="pv-zone-filterFields">
              <div class="pv-zone-header"><span class="pv-zone-icon">▽</span> Filters</div>
              <div class="pv-zone-body pv-zone-drop"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Results -->
      <div class="pv-results">
        <div class="pv-results-header">Result</div>
        <div id="pv-table-container" class="pv-table-wrap"></div>
      </div>
      <div class="pv-chart-wrap">
        <canvas id="pv-chart"></canvas>
      </div>
    </div>
  `;

  // Wire events
  document.getElementById("pv-chart-type").addEventListener("change", (e) => {
    pivotState.chartType = e.target.value;
    scheduleRebuild();
  });
  document.getElementById("pv-refresh-btn").addEventListener("click", () => {
    pivotState._cache = null;
    rebuildPivot();
  });
  document.getElementById("pv-clear-btn").addEventListener("click", () => {
    pivotState.rowFields    = [];
    pivotState.columnFields = [];
    pivotState.valueFields  = [];
    pivotState.filterFields = [];
    renderZones();
    scheduleRebuild();
  });

  setupDragAndDrop();

  // Initial field list
  if (lastFetched.columns.length) {
    createFieldList(lastFetched.columns, document.getElementById("pv-field-list"));
  }

  rebuildPivot();
}

/** Call this when the host app loads new columns (e.g. after factSelect changes) */
function refreshPivotFieldList() {
  const el = document.getElementById("pv-field-list");
  if (el) createFieldList(lastFetched.columns, el);
}

// ─────────────────────────────────────────────
// EXPOSE
// ─────────────────────────────────────────────
window.PivotModule = {
  init:               initPivotModule,
  setData:            setPivotData,
  refreshFieldList:   refreshPivotFieldList,
  getState:           () => pivotState,
};