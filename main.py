from __future__ import annotations

import csv
import io
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from store import (
    add_batch,
    get_batch,
    init_db,
    list_batches,
    save_review,
    summary,
)
from vision import OnionVision, decode_image, validate_image


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = Path(os.environ.get("ONION_DATA_DIR", ROOT / "data")).expanduser().resolve()
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "agrivision.sqlite3"
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_FILES = 12

DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(DB_PATH)
    app.state.vision = OnionVision(ROOT / "models" / "onion_quality.pt")
    yield


app = FastAPI(title="AgriVision", description="Onion quality assessment demo", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    vision = getattr(app.state, "vision", None)
    return {
        "status": "ok",
        "model": vision.status if vision else "loading",
        "model_version": vision.version if vision else "loading",
    }


@app.get("/api/summary")
def get_summary():
    return summary(DB_PATH)


@app.get("/api/batches")
def batches():
    return list_batches(DB_PATH)


@app.get("/api/batches/{batch_id}")
def batch_detail(batch_id: str):
    record = get_batch(DB_PATH, batch_id)
    if not record:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return record


@app.get("/api/batches/{batch_id}/report.csv")
def batch_csv(batch_id: str):
    record = get_batch(DB_PATH, batch_id)
    if not record:
        raise HTTPException(status_code=404, detail="Inspection not found")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["Sample", "File", "Grade", "Model confidence", "Flags", "Review note"]
    )
    for item in record["samples"]:
        writer.writerow(
            [
                item["number"],
                item["original_name"],
                item["grade"],
                item["confidence"],
                ", ".join(item["flags"]),
                item.get("review_note") or "",
            ]
        )
    filename = f"agrivision-{record['id'][:8]}.csv"
    return Response(
        output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/analyze")
async def analyze_batch(
    files: Annotated[list[UploadFile], File(description="One tray photo or up to 12 sample photos")],
    batch_name: Annotated[str, Form()] = "",
    center: Annotated[str, Form()] = "",
    supplier: Annotated[str, Form()] = "",
):
    if not files:
        raise HTTPException(status_code=400, detail="Add at least one onion photo")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail=f"Upload up to {MAX_FILES} photos per inspection")

    vision: OnionVision = app.state.vision
    prepared: list[tuple[str, bytes]] = []
    total_bytes = 0
    for uploaded in files:
        raw = await uploaded.read()
        total_bytes += len(raw)
        if len(raw) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"{uploaded.filename or 'Image'} is larger than 15 MB")
        if total_bytes > 90 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Keep the combined upload under 90 MB")
        if not raw:
            continue
        try:
            validate_image(raw)
        except ValueError as exc:
            raise HTTPException(status_code=415, detail=f"{uploaded.filename or 'Image'}: {exc}") from exc
        safe_name = Path(uploaded.filename or "onion-photo").name[:180]
        prepared.append((safe_name, raw))
    if not prepared:
        raise HTTPException(status_code=400, detail="No readable photos were provided")

    batch_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    samples: list[dict] = []
    for photo_index, (original_name, raw) in enumerate(prepared):
        image = decode_image(raw)
        analysis = await run_in_threadpool(vision.analyze, image)
        del image
        frame_objects = analysis["items"]
        annotated_name = f"{batch_id}-{photo_index + 1}-marked.jpg"
        annotated_path = MEDIA_DIR / annotated_name
        annotated_path.write_bytes(analysis["annotated"])
        annotated_url = f"/media/{annotated_name}"

        for object_index, item in enumerate(frame_objects):
            sample_id = uuid.uuid4().hex
            crop_name = f"{sample_id}-crop.jpg"
            (MEDIA_DIR / crop_name).write_bytes(item["crop"])
            samples.append(
                {
                    **{key: value for key, value in item.items() if key not in {"crop"}},
                    "id": sample_id,
                    "number": len(samples) + 1,
                    "original_name": original_name,
                    "annotated_url": annotated_url,
                    "crop_url": f"/media/{crop_name}",
                    "source_photo": photo_index + 1,
                    "object_number": object_index + 1,
                    "created_at": now,
                }
            )

    if not samples:
        raise HTTPException(
            status_code=422,
            detail="No onion bulbs were found. Try a brighter photo with the bulbs separated from the background.",
        )

    name = batch_name.strip()[:100] or f"Inspection {datetime.now().strftime('%d %b %H:%M')}"
    result = add_batch(
        DB_PATH,
        {
            "id": batch_id,
            "batch_name": name,
            "center": center.strip()[:100],
            "supplier": supplier.strip()[:100],
            "created_at": now,
            "model_version": vision.version,
        },
        samples,
    )
    return result


@app.patch("/api/samples/{sample_id}/review")
async def review_sample(sample_id: str, payload: dict):
    grade = payload.get("grade")
    note = str(payload.get("note", ""))[:500]
    if grade not in {"Grade A", "URS"}:
        raise HTTPException(status_code=422, detail="Grade must be Grade A or URS")
    batch_id = save_review(DB_PATH, sample_id, grade, note)
    if not batch_id:
        raise HTTPException(status_code=404, detail="Sample not found")
    return get_batch(DB_PATH, batch_id)


@app.get("/media/{filename}")
def media(filename: str):
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(status_code=404, detail="Image not found")
    path = MEDIA_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)
