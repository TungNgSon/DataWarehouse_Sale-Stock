from typing import Dict, Optional

FACT_CONFIG = {
    "sold": {
        "label": "fact_item_sold",
        "dimensions": {
            "time": ["none", "year", "yq", "yqm"],
            "item": ["none", "item"],
            "third": ["none", "custtype", "custtype_cust"],
        },
        "third_label": "customer",
        "filter_columns": {
            "year",
            "quarter",
            "month",
            "item_id",
            "customer_type",
            "customer_id",
        },
    },
    "stock": {
        "label": "fact_in_stock",
        "dimensions": {
            "time": ["none", "year", "yq", "yqm"],
            "item": ["none", "item"],
            "third": ["none", "state", "state_city", "state_city_store"],
        },
        "third_label": "store_geo",
        "filter_columns": {
            "year",
            "quarter",
            "month",
            "item_id",
            "state",
            "city_code",
            "store_id",
        },
    },
}


def _token_time(level: str) -> str:
    return {"year": "year", "yq": "yq", "yqm": "yqm"}[level]


def _single_time_mv(fact: str, level: str) -> str:
    if level == "year":
        return f"mv_{fact}_year"
    if level == "yq":
        return f"mv_{fact}_year_qtr"
    if level == "yqm":
        return f"mv_{fact}_year_qtr_month"
    raise ValueError(f"Unsupported time level: {level}")


def resolve_mv_name(
    fact: str,
    time_level: str,
    item_level: str,
    third_level: str,
) -> Optional[str]:
    if fact not in ("sold", "stock"):
        return None

    has_time = time_level != "none"
    has_item = item_level != "none"
    has_third = third_level != "none"

    if not has_time and not has_item and not has_third:
        return f"mv_{fact}_all"

    if has_time and not has_item and not has_third:
        return _single_time_mv(fact, time_level)

    if not has_time and has_item and not has_third:
        return f"mv_{fact}_item"

    if not has_time and not has_item and has_third:
        if fact == "sold":
            return f"mv_{fact}_{third_level}"
        return f"mv_{fact}_{third_level}"

    if has_time and has_item and not has_third:
        return f"mv_{fact}_{_token_time(time_level)}_item"

    if has_time and not has_item and has_third:
        return f"mv_{fact}_{_token_time(time_level)}_{third_level}"

    if not has_time and has_item and has_third:
        return f"mv_{fact}_item_{third_level}"

    if has_time and has_item and has_third:
        return f"mv_{fact}_{_token_time(time_level)}_item_{third_level}"

    return None


def is_valid_selection(fact: str, time_level: str, item_level: str, third_level: str) -> bool:
    if fact not in FACT_CONFIG:
        return False
    cfg = FACT_CONFIG[fact]["dimensions"]
    return (
        time_level in cfg["time"]
        and item_level in cfg["item"]
        and third_level in cfg["third"]
    )
