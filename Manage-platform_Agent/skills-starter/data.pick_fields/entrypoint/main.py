def run(payload: dict) -> dict:
    input_data = payload.get("input_data") or {}
    items = input_data.get("items") or []
    fields = input_data.get("fields") or []
    result = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out = {}
        for key in fields:
            out[key] = item.get(key)
        result.append(out)
    return {"count": len(result), "items": result}
