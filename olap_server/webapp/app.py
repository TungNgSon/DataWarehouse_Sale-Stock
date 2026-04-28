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


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def config():
    return jsonify(_public_config())


@app.post("/api/cuboid-data")
def cuboid_data():
    payload = request.get_json(silent=True) or {}

    fact = payload.get("fact", "sold")
    time_level = payload.get("time_level", "year")
    item_level = payload.get("item_level", "none")
    third_level = payload.get("third_level", "none")
    filters = payload.get("filters", {})
    max_rows = int(os.getenv("MAX_ROWS", "200"))

    if not is_valid_selection(fact, time_level, item_level, third_level):
        return jsonify({"error": "Invalid hierarchy selection"}), 400

    mv_name = resolve_mv_name(fact, time_level, item_level, third_level)
    if not mv_name:
        return jsonify({"error": "Could not resolve cuboid"}), 400

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

        return jsonify(
            {
                "fact": fact,
                "mv_name": mv_name,
                "columns": columns,
                "rows": data,
                "row_count": len(data),
            }
        )
    except oracledb.Error as exc:
        return jsonify(
            {
                "error": "Oracle connection or query failed",
                "details": str(exc),
                "mv_name": mv_name,
            }
        ), 500
    except Exception as exc:
        return jsonify({"error": str(exc), "mv_name": mv_name}), 500


if __name__ == "__main__":
    host = os.getenv("APP_HOST", "127.0.0.1")
    port = int(os.getenv("APP_PORT", "5050"))
    debug = os.getenv("APP_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)
