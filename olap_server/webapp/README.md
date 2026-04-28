# OLAP Web Cuboid Explorer

## Why this app exists
You already have cuboids in Oracle. This app is the missing web interface layer so users can:
- Select fact and hierarchy levels.
- Roll-up and drill-down interactively.
- View table and chart output from resolved cuboid MV.

## Architecture
1. Oracle XE keeps canonical cuboids (56 MVs from part1..part6).
2. Flask backend resolves hierarchy selection to one MV name.
3. Frontend calls backend API and renders table/chart.

## Key features
- Fact switch: sold or stock.
- Hierarchy controls:
  - Time: none/year/yq/yqm
  - Item: none/item
  - Third dimension:
    - Sold: none/custtype/custtype_cust
    - Stock: none/state/state_city/state_city_store
- Roll-up and drill-down buttons per dimension.
- Optional filters by year/quarter/month/item/customer/state/city/store.
- Dynamic table and chart rendering.

## Setup
1. Open terminal in olap_server/webapp.
2. Create virtual environment and activate.
3. Install dependencies:
   pip install -r requirements.txt
4. Copy .env.example to .env and adjust Oracle credentials.
5. Run app:
   python app.py
6. Open browser:
   http://127.0.0.1:5050

## API
- GET /api/config
  - Returns supported facts, dimensions, and filter fields.
- POST /api/cuboid-data
  - Input JSON:
    {
      "fact": "sold",
      "time_level": "yq",
      "item_level": "item",
      "third_level": "custtype",
      "filters": {"year": 2024}
    }
  - Output JSON:
    - resolved mv_name
    - columns
    - rows
    - row_count

## Notes
- This app reads from existing MVs only, it does not create cuboids.
- For performance, row output is capped by MAX_ROWS in .env.
- If you later need auth and role-based access, add it in Flask layer.
