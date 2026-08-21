# Local Open Source OCR (experimental)

This optional sidecar runs PaddleOCR locally and converts its output to the same
Daily Routes and Monthly Settlement JSON schemas used by the main application.
It makes no paid API calls. Handwriting and template parsing are experimental,
so every result must still be reviewed before it is sent to Excel.

## Setup

Use a dedicated Python virtual environment on the server:

```powershell
py -3.12 -m venv .venv-local-ocr
.\.venv-local-ocr\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r local-ocr\requirements.txt
python local-ocr\service.py
```

Set `LOCAL_OCR_URL=http://127.0.0.1:8790` in the main application `.env`, restart
the Node/IIS application, then select **Local Open Source** on OCR Settings. The
first document is slower because PaddleOCR downloads and loads its models.

For production, run `python local-ocr/service.py` as a Windows service rather
than an interactive console. Keep it bound to `127.0.0.1`; it is an internal
sidecar and should not be exposed publicly.
