"""Optional local PaddleOCR sidecar for MilkCollect.

This service deliberately performs OCR and deterministic template parsing only. It
does not call an LLM or any paid API. Run from the repository root with:

    python -m pip install -r local-ocr/requirements.txt
    python local-ocr/service.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = os.getenv("LOCAL_OCR_HOST", "127.0.0.1")
PORT = int(os.getenv("LOCAL_OCR_PORT", "8790"))
MAX_BODY = int(os.getenv("LOCAL_OCR_MAX_BODY", str(25 * 1024 * 1024)))
_engine = None

MONTHS = {
    "IANUARIE": 1, "FEBRUARIE": 2, "MARTIE": 3, "APRILIE": 4,
    "MAI": 5, "IUNIE": 6, "IULIE": 7, "AUGUST": 8,
    "SEPTEMBRIE": 9, "OCTOMBRIE": 10, "NOIEMBRIE": 11, "DECEMBRIE": 12,
}


def engine():
    global _engine
    if _engine is None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise RuntimeError(
                "PaddleOCR is not installed. Run: python -m pip install -r local-ocr/requirements.txt"
            ) from exc
        _engine = PaddleOCR(
            # PaddleOCR 3.x exposes Latin-script recognition through the
            # supported `en` model identifier. `latin` without an explicitly
            # paired OCR version fails during model discovery in 3.7.
            lang=os.getenv("LOCAL_OCR_LANGUAGE", "en"),
            # PaddlePaddle 3.3 on Windows can fail in oneDNN while converting
            # array attributes for the OCR models. The plain CPU executor is
            # slower but stable on the IIS/local Windows deployment target.
            enable_mkldnn=False,
            text_detection_model_name=os.getenv("LOCAL_OCR_DETECTION_MODEL", "PP-OCRv5_mobile_det"),
            text_recognition_model_name=os.getenv("LOCAL_OCR_RECOGNITION_MODEL", "en_PP-OCRv5_mobile_rec"),
            text_det_limit_side_len=int(os.getenv("LOCAL_OCR_MAX_SIDE", "2200")),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _engine


def result_json(value: Any) -> Any:
    candidate = getattr(value, "json", value)
    if callable(candidate):
        candidate = candidate()
    if isinstance(candidate, str):
        return json.loads(candidate)
    return candidate


def find_recognition_arrays(value: Any) -> tuple[list[str], list[float], list[Any]] | None:
    if isinstance(value, dict):
        texts = value.get("rec_texts")
        boxes = value.get("rec_boxes") or value.get("dt_polys")
        if isinstance(texts, list) and isinstance(boxes, list) and len(texts) == len(boxes):
            scores = value.get("rec_scores") or [0.65] * len(texts)
            return [str(item) for item in texts], [float(item) for item in scores], boxes
        for child in value.values():
            found = find_recognition_arrays(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_recognition_arrays(child)
            if found:
                return found
    return None


def bounds(box: Any) -> tuple[float, float, float, float]:
    if len(box) == 4 and all(isinstance(item, (int, float)) for item in box):
        return float(box[0]), float(box[1]), float(box[2]), float(box[3])
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def recognize(path: Path) -> list[dict[str, Any]]:
    predictions = engine().predict(str(path))
    tokens: list[dict[str, Any]] = []
    for prediction in predictions:
        found = find_recognition_arrays(result_json(prediction))
        if not found:
            continue
        texts, scores, boxes = found
        for text, score, box in zip(texts, scores, boxes):
            text = text.strip()
            if not text:
                continue
            x1, y1, x2, y2 = bounds(box)
            tokens.append({"text": text, "score": score, "x": (x1 + x2) / 2, "y": (y1 + y2) / 2, "x1": x1, "x2": x2, "y1": y1, "y2": y2})
    return sorted(tokens, key=lambda item: (item["y"], item["x"]))


def number(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9,.-]", "", value).replace(",", ".")
    try:
        return float(cleaned) if cleaned not in {"", ".", "-"} else None
    except ValueError:
        return None


def integer_like(value: str) -> float | None:
    parsed = number(value)
    return parsed if parsed is not None and parsed >= 0 else None


def grouped_rows(tokens: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if not tokens:
        return []
    heights = sorted(max(8.0, token.get("y2", token["y"]) - token.get("y1", token["y"])) for token in tokens)
    typical_height = heights[len(heights) // 2]
    tolerance = min(40.0, max(12.0, typical_height * 0.75))
    rows: list[list[dict[str, Any]]] = []
    for token in tokens:
        if not rows or abs(sum(item["y"] for item in rows[-1]) / len(rows[-1]) - token["y"]) > tolerance:
            rows.append([token])
        else:
            rows[-1].append(token)
    return [sorted(row, key=lambda item: item["x"]) for row in rows]


def text(tokens: list[dict[str, Any]]) -> str:
    return " ".join(token["text"] for token in tokens).strip()


def date_and_month(all_text: str) -> tuple[str | None, int | None]:
    match = re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b", all_text)
    if match:
        day, month, year = map(int, match.groups())
        if 1 <= day <= 31 and 1 <= month <= 12:
            return f"{year:04d}-{month:02d}-{day:02d}", month
    compact = re.search(r"\b(\d{3,4})[./-](20\d{2})\b", all_text)
    if compact:
        digits, year_text = compact.groups()
        digits = digits.zfill(4)
        day, month, year = int(digits[:2]), int(digits[2:]), int(year_text)
        if 1 <= day <= 31 and 1 <= month <= 12:
            return f"{year:04d}-{month:02d}-{day:02d}", month
    upper = all_text.upper()
    for name, month in MONTHS.items():
        if name in upper:
            return None, month
    return None, None


def header_value(rows: list[list[dict[str, Any]]], labels: tuple[str, ...]) -> str | None:
    for row in rows:
        line = text(row)
        upper = line.upper()
        if any(label in upper for label in labels):
            for separator in (":", "-"):
                if separator in line:
                    value = line.split(separator, 1)[1].strip(" ._-")
                    if value:
                        return value
    return None


def parse_daily(tokens: list[dict[str, Any]]) -> dict[str, Any]:
    rows = grouped_rows(tokens)
    all_text = "\n".join(text(row) for row in rows)
    date, _ = date_and_month(all_text)
    data_rows = []
    table_started = False
    for row in rows:
        line = text(row)
        upper = line.upper()
        if "CENTRU" in upper and "COLECTARE" in upper:
            table_started = True
            continue
        if table_started and any(marker in upper for marker in ("CENTRALIZATOR", "SEMNATURA", "TOTAL")):
            break
        if not table_started:
            continue
        values = [integer_like(item["text"]) for item in row]
        row_number = next((int(value) for value in values if value is not None and 1 <= value <= 60), None)
        numeric = [(item, integer_like(item["text"])) for item in row if integer_like(item["text"]) is not None]
        words = [item for item in row if integer_like(item["text"]) is None and len(item["text"].strip()) > 1]
        if not words or not numeric:
            continue
        center = max((item["text"] for item in words), key=len, default=None)
        if center:
            center = re.sub(r"^[^A-Za-zĂÂÎȘȚăâîșț]*\d[\d./-]*", "", center).strip(" ._-") or center
        numeric_values = [value for _, value in numeric if row_number is None or value != row_number]
        liters = numeric_values[0] if numeric_values else None
        if liters is None or liters > 100_000:
            continue
        row_number = row_number or len(data_rows) + 1
        tail = numeric_values[1:]
        data_rows.append({
            "rowNumber": row_number, "collectionCenter": center, "liters": liters,
            "fatPercent": tail[0] if tail and tail[0] <= 15 else None,
            "density": None, "water": None, "temperature": None,
            "noticeNumber": str(int(tail[-1])) if tail and tail[-1] > 15 else None,
            "confidence": min(item["score"] for item in row),
            "uncertainFields": ["density", "water", "temperature"],
        })
    return {
        "documentType": "daily_driver_statement",
        "companyName": header_value(rows, ("SRL", "S.R.L")),
        "date": date,
        "driverName": header_value(rows, ("NUME", "DRIVER", "SOFER")),
        "vehicleRegistration": header_value(rows, ("INMATRICULARE", "TRACK NUMBER")),
        "route": header_value(rows, ("ROUTE", "RUTA")),
        "rows": data_rows,
        "totalLiters": None,
        "warnings": ["Experimental local OCR was used. Verify all handwritten values before export."],
        "rawTranscription": all_text,
    }


def parse_monthly(tokens: list[dict[str, Any]]) -> dict[str, Any]:
    rows = grouped_rows(tokens)
    all_text = "\n".join(text(row) for row in rows)
    upper = all_text.upper()
    detailed = "JURNAL" in upper or any(str(day) in upper.split() for day in range(16, 32))
    date, month = date_and_month(all_text)
    milk_type = "OAIE" if "OAIE" in upper else "VACA"
    header_center = header_value(rows, ("CENTRU", "CL.", "PUNCT"))
    if header_center:
        # Header labels commonly share one OCR line, for example:
        # "CENTRU: VALEA LUNGA  TIP LAPTE: VACA". Keep only the value
        # belonging to CENTRU and never append the neighboring milk label.
        header_center = re.split(
            r"\b(?:TIP\s*(?:DE\s*)?LAPTE|MILK\s*TYPE)\b",
            header_center,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" ._:-") or None
    output_rows = []
    for row in rows:
        line = text(row).upper()
        if any(word in line for word in ("TOTAL", "NUME SI", "PRODUCATOR", "LITRI", "OBSERVAT")):
            continue
        names = [item for item in row if re.search(r"[A-Za-zĂÂÎȘȚăâîșț]", item["text"])]
        nums = [integer_like(item["text"]) for item in row]
        nums = [value for value in nums if value is not None]
        if not names or not nums:
            continue
        row_number = int(nums[0]) if 1 <= nums[0] <= 100 else len(output_rows) + 1
        values = nums[1:] if nums and nums[0] == row_number else nums
        if not values:
            continue
        name = max((item["text"] for item in names), key=len)
        liters = values[-2] if len(values) >= 2 else values[-1]
        g_value = values[-1] if len(values) >= 2 else None
        output_rows.append({
            "rowNumber": row_number,
            "producer": name if detailed else None,
            "centerName": None if detailed else name,
            "liters": liters,
            "ugPercent": None,
            "gValue": g_value,
            "confidence": min(item["score"] for item in row),
            "uncertainFields": ["ugPercent"] if detailed else [],
        })
    return {
        "documentType": "journal_monthly_settlement",
        "layoutType": "detailed" if detailed else "overview",
        "date": date, "documentMonth": month, "milkType": milk_type,
        "headerCenterName": header_center, "totalLiters": None,
        "rows": output_rows,
        "warnings": ["Experimental local OCR was used. Verify all handwritten values before export."],
        "rawTranscription": all_text,
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True, "engine": "paddleocr-latin-template-v1", "loaded": _engine is not None})
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/ocr":
            self.send_json(404, {"error": "Not found"})
            return
        started = time.monotonic()
        temporary: Path | None = None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("Invalid or oversized request body.")
            payload = json.loads(self.rfile.read(length))
            raw = base64.b64decode(payload["fileBase64"], validate=True)
            suffix = Path(str(payload.get("fileName") or "document.jpg")).suffix or ".jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(raw)
                temporary = Path(handle.name)
            tokens = recognize(temporary)
            if not tokens:
                raise RuntimeError("PaddleOCR did not detect any text in the document.")
            category = payload.get("documentCategory")
            document = parse_monthly(tokens) if category == "journal_monthly_settlement" else parse_daily(tokens)
            self.send_json(200, {
                "requestId": str(uuid.uuid4()), "engine": "paddleocr-latin-template-v1",
                "durationMs": round((time.monotonic() - started) * 1000), "document": document,
            })
        except Exception as exc:  # The Node API presents this message to the review queue.
            self.send_json(500, {"error": str(exc)})
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[local-ocr] {self.address_string()} {message % args}")


if __name__ == "__main__":
    print(f"Local Open Source OCR listening on http://{HOST}:{PORT}")
    print("The PaddleOCR model is loaded on the first OCR request.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
