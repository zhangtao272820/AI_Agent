def run(payload: dict) -> dict:
    input_data = payload.get("input_data") or {}
    text = str(input_data.get("text") or "")
    mode = str(input_data.get("mode") or "upper").lower()
    if mode == "upper":
        transformed = text.upper()
    elif mode == "lower":
        transformed = text.lower()
    elif mode == "title":
        transformed = text.title()
    else:
        raise ValueError(f"unsupported mode: {mode}")
    return {"mode": mode, "transformed": transformed}
