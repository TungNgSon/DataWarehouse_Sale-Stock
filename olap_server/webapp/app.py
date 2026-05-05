import os
from decimal import Decimal

import oracledb
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from cuboid_config import FACT_CONFIG, is_valid_selection, resolve_mv_name

load_dotenv()

app = Flask(__name__)


def _get_db_connection():
    return oracledb.connect(
        user=os.getenv("DB_USER", "KDL_DW"),
        password=os.getenv("DB_PASSWORD", "kdl_123"),
        dsn=os.getenv("DB_DSN", "localhost/XEPDB1"),
    )


def _to_json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


def _public_config():
    config = {}
    for fact_name, fact_config in FACT_CONFIG.items():
        config[fact_name] = {
            "label": fact_config["label"],
            "dimensions": fact_config["dimensions"],
            "third_label": fact_config["third_label"],
            "filter_columns": sorted(fact_config["filter_columns"]),
        }
    return config


def _build_query(fact, time_level, item_level, third_level, filters):
    """
    Shared helper: validate selection, resolve MV, build SQL + bind_vars.
    Returns (mv_name, sql, bind_vars) or raises ValueError.
    """
    if not is_valid_selection(fact, time_level, item_level, third_level):
        raise ValueError("Invalid hierarchy selection")

    mv_name = resolve_mv_name(fact, time_level, item_level, third_level)
    if not mv_name:
        raise ValueError("Could not resolve cuboid")

    allowed_filters = FACT_CONFIG[fact]["filter_columns"]
    bind_vars = {}
    where_clauses = []

    for key, value in filters.items():
        if key not in allowed_filters:
            continue
        if value is None or value == "":
            continue
        bind_name = f"b_{key}"
        where_clauses.append(f"{key} = :{bind_name}")
        bind_vars[bind_name] = value

    base_sql = f"SELECT * FROM {mv_name}"
    if where_clauses:
        base_sql += " WHERE " + " AND ".join(where_clauses)

    return mv_name, base_sql, bind_vars


def _do_pivot(rows: list, row_dim: str, pivot_col: str, pivot_val: str):
    """
    Xoay pivot_col thành nhiều cột, tổng hợp pivot_val theo row_dim.

    Ví dụ:
        rows = [
            {"item_id": 1, "year": 2022, "total_price": 5000},
            {"item_id": 1, "year": 2023, "total_price": 7200},
            {"item_id": 2, "year": 2022, "total_price": 3000},
        ]
        row_dim   = "item_id"
        pivot_col = "year"
        pivot_val = "total_price"

    Returns:
        pivoted = {
            1: {"2022": 5000, "2023": 7200},
            2: {"2022": 3000, "2023": 0},
        }
        col_values = ["2022", "2023"]
    """
    col_values = sorted(set(str(r[pivot_col]) for r in rows))
    pivoted = {}

    for row in rows:
        row_key = row[row_dim]
        col_key = str(row[pivot_col])
        val = row.get(pivot_val) or 0

        if row_key not in pivoted:
            pivoted[row_key] = {c: 0 for c in col_values}

        pivoted[row_key][col_key] += val

    return pivoted, col_values


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def config():
    return jsonify(_public_config())


@app.post("/api/cuboid-data")
def cuboid_data():
    payload = request.get_json(silent=True) or {}

    fact        = payload.get("fact", "sold")
    time_level  = payload.get("time_level", "year")
    item_level  = payload.get("item_level", "none")
    third_level = payload.get("third_level", "none")
    filters     = payload.get("filters", {})
    max_rows    = int(os.getenv("MAX_ROWS", "200"))

    try:
        mv_name, base_sql, bind_vars = _build_query(
            fact, time_level, item_level, third_level, filters
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    sql = f"SELECT * FROM ({base_sql}) WHERE ROWNUM <= :b_limit"
    bind_vars["b_limit"] = max_rows

    try:
        with _get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, bind_vars)
                columns = [desc[0].lower() for desc in cursor.description]
                data = [
                    {columns[i]: _to_json_value(row[i]) for i in range(len(columns))}
                    for row in cursor.fetchall()
                ]

        return jsonify({
            "fact":      fact,
            "mv_name":   mv_name,
            "columns":   columns,
            "rows":      data,
            "row_count": len(data),
        })
    except oracledb.Error as exc:
        return jsonify({
            "error":   "Oracle connection or query failed",
            "details": str(exc),
            "mv_name": mv_name,
        }), 500
    except Exception as exc:
        return jsonify({"error": str(exc), "mv_name": mv_name}), 500


@app.post("/api/pivot-data")
def pivot_data():
    """
    Pivot endpoint.

    Nhận thêm 3 tham số so với /api/cuboid-data:
      pivot_col  – cột sẽ trở thành các cột mới  (vd: "year", "quarter", "state")
      pivot_val  – metric cần tổng hợp            (vd: "total_price", "quantity")
      row_dim    – cột làm hàng (trục Y)           (vd: "item_id", "customer_type")

    Dùng cùng MV với /api/cuboid-data, chỉ transform kết quả ở Python.
    """
    payload = request.get_json(silent=True) or {}

    fact        = payload.get("fact", "sold")
    time_level  = payload.get("time_level", "year")
    item_level  = payload.get("item_level", "none")
    third_level = payload.get("third_level", "none")
    filters     = payload.get("filters", {})

    # Pivot-specific params
    pivot_col = payload.get("pivot_col")   # vd: "year"
    pivot_val = payload.get("pivot_val")   # vd: "total_price"
    row_dim   = payload.get("row_dim")     # vd: "item_id"

    if not all([pivot_col, pivot_val, row_dim]):
        return jsonify({
            "error": "pivot_col, pivot_val, and row_dim are all required"
        }), 400

    try:
        mv_name, base_sql, bind_vars = _build_query(
            fact, time_level, item_level, third_level, filters
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        with _get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(base_sql, bind_vars)
                columns = [desc[0].lower() for desc in cursor.description]
                raw_rows = [
                    {columns[i]: _to_json_value(row[i]) for i in range(len(columns))}
                    for row in cursor.fetchall()
                ]

        # Validate pivot params against actual columns
        for param_name, param_val in [
            ("pivot_col", pivot_col),
            ("pivot_val", pivot_val),
            ("row_dim",   row_dim),
        ]:
            if param_val not in columns:
                return jsonify({
                    "error":           f"'{param_val}' not found in MV columns",
                    "param":           param_name,
                    "available_cols":  columns,
                }), 400

        if not raw_rows:
            return jsonify({
                "fact":      fact,
                "mv_name":   mv_name,
                "pivot_col": pivot_col,
                "pivot_val": pivot_val,
                "row_dim":   row_dim,
                "columns":   [row_dim],
                "rows":      [],
                "row_count": 0,
            })

        # ── Thực hiện pivot ──────────────────────────────────────────────────
        pivoted, col_values = _do_pivot(raw_rows, row_dim, pivot_col, pivot_val)

        pivot_rows = []
        for row_key, col_map in pivoted.items():
            entry = {row_dim: row_key}
            entry.update(col_map)
            pivot_rows.append(entry)

        pivot_columns = [row_dim] + col_values
        # ────────────────────────────────────────────────────────────────────

        return jsonify({
            "fact":      fact,
            "mv_name":   mv_name,
            "pivot_col": pivot_col,
            "pivot_val": pivot_val,
            "row_dim":   row_dim,
            "columns":   pivot_columns,
            "rows":      pivot_rows,
            "row_count": len(pivot_rows),
        })

    except oracledb.Error as exc:
        return jsonify({
            "error":   "Oracle connection or query failed",
            "details": str(exc),
            "mv_name": mv_name,
        }), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    host  = os.getenv("APP_HOST", "127.0.0.1")
    port  = int(os.getenv("APP_PORT", "5050"))
    debug = os.getenv("APP_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)