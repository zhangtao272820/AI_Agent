import re


def run(payload: dict) -> dict:
    input_data = payload.get("input_data") or {}
    text = str(input_data.get("text") or "")
    words = re.findall(r"\S+", text)
    lines = text.splitlines()
    non_empty_lines = [line for line in lines if line.strip()]
    return {
        "words": len(words),
        "characters": len(text),
        "lines": len(lines),
        "non_empty_lines": len(non_empty_lines),
    }
