from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS batches (
                id TEXT PRIMARY KEY,
                batch_name TEXT NOT NULL,
                center TEXT NOT NULL DEFAULT '',
                supplier TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                model_version TEXT NOT NULL,
                total INTEGER NOT NULL DEFAULT 0,
                grade_a_count INTEGER NOT NULL DEFAULT 0,
                urs_count INTEGER NOT NULL DEFAULT 0,
                review_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS samples (
                id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
                number INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                annotated_url TEXT NOT NULL,
                crop_url TEXT NOT NULL,
                source_photo INTEGER NOT NULL DEFAULT 1,
                object_number INTEGER NOT NULL DEFAULT 1,
                grade TEXT NOT NULL,
                score INTEGER NOT NULL,
                confidence REAL NOT NULL,
                model_class TEXT NOT NULL,
                flags_json TEXT NOT NULL DEFAULT '[]',
                review_required INTEGER NOT NULL DEFAULT 0,
                size_status TEXT NOT NULL DEFAULT 'not measured',
                diameter_px REAL NOT NULL DEFAULT 0,
                box_json TEXT NOT NULL DEFAULT '[]',
                cues_json TEXT NOT NULL DEFAULT '{}',
                human_grade TEXT,
                review_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS samples_batch_idx ON samples(batch_id, number);
            CREATE INDEX IF NOT EXISTS batches_created_idx ON batches(created_at DESC);
            """
        )


def _recalculate(connection: sqlite3.Connection, batch_id: str) -> None:
    rows = connection.execute(
        "SELECT grade, human_grade, review_required FROM samples WHERE batch_id = ?", (batch_id,)
    ).fetchall()
    grade_a = sum((row["human_grade"] or row["grade"]) == "Grade A" for row in rows)
    urs = len(rows) - grade_a
    review = sum(bool(row["review_required"]) and not row["human_grade"] for row in rows)
    connection.execute(
        "UPDATE batches SET total = ?, grade_a_count = ?, urs_count = ?, review_count = ? WHERE id = ?",
        (len(rows), grade_a, urs, review, batch_id),
    )


def _summary(row: sqlite3.Row) -> dict:
    total = row["total"]
    grade_a_count = row["grade_a_count"]
    return {
        "id": row["id"],
        "batch_name": row["batch_name"],
        "center": row["center"],
        "supplier": row["supplier"],
        "created_at": row["created_at"],
        "model_version": row["model_version"],
        "total": total,
        "grade_a_count": grade_a_count,
        "urs_count": row["urs_count"],
        "review_count": row["review_count"],
        "grade_a_pct": round(grade_a_count / total * 100, 1) if total else 0,
        "urs_pct": round(row["urs_count"] / total * 100, 1) if total else 0,
    }


def add_batch(path: Path, batch: dict, samples: list[dict]) -> dict:
    with _connect(path) as connection:
        connection.execute(
            """INSERT INTO batches(id, batch_name, center, supplier, created_at, model_version)
               VALUES(:id, :batch_name, :center, :supplier, :created_at, :model_version)""",
            batch,
        )
        for sample in samples:
            connection.execute(
                """INSERT INTO samples(
                    id, batch_id, number, original_name, annotated_url, crop_url, source_photo,
                    object_number, grade, score, confidence, model_class, flags_json,
                    review_required, size_status, diameter_px, box_json, cues_json, created_at
                ) VALUES(
                    :id, :batch_id, :number, :original_name, :annotated_url, :crop_url, :source_photo,
                    :object_number, :grade, :score, :confidence, :model_class, :flags_json,
                    :review_required, :size_status, :diameter_px, :box_json, :cues_json, :created_at
                )""",
                {
                    **sample,
                    "batch_id": batch["id"],
                    "flags_json": json.dumps(sample["flags"]),
                    "review_required": int(sample["review_required"]),
                    "box_json": json.dumps(sample["box"]),
                    "cues_json": json.dumps(sample["cues"]),
                },
            )
        _recalculate(connection, batch["id"])
    return get_batch(path, batch["id"])


def get_batch(path: Path, batch_id: str) -> dict | None:
    with _connect(path) as connection:
        batch = connection.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not batch:
            return None
        samples = connection.execute(
            "SELECT * FROM samples WHERE batch_id = ? ORDER BY number", (batch_id,)
        ).fetchall()
    result = _summary(batch)
    result["samples"] = [
        {
            "id": row["id"],
            "number": row["number"],
            "original_name": row["original_name"],
            "annotated_url": row["annotated_url"],
            "crop_url": row["crop_url"],
            "source_photo": row["source_photo"],
            "object_number": row["object_number"],
            "grade": row["human_grade"] or row["grade"],
            "predicted_grade": row["grade"],
            "score": row["score"],
            "confidence": row["confidence"],
            "model_class": row["model_class"],
            "flags": json.loads(row["flags_json"]),
            "review_required": bool(row["review_required"] and not row["human_grade"]),
            "size_status": row["size_status"],
            "cues": json.loads(row["cues_json"]),
            "human_grade": row["human_grade"],
            "review_note": row["review_note"],
        }
        for row in samples
    ]
    return result


def list_batches(path: Path, limit: int = 50) -> list[dict]:
    with _connect(path) as connection:
        rows = connection.execute(
            "SELECT * FROM batches ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_summary(row) for row in rows]


def summary(path: Path) -> dict:
    with _connect(path) as connection:
        totals = connection.execute(
            """SELECT COUNT(*) AS inspections, COALESCE(SUM(total), 0) AS samples,
                      COALESCE(SUM(grade_a_count), 0) AS grade_a,
                      COALESCE(SUM(urs_count), 0) AS urs,
                      COALESCE(SUM(review_count), 0) AS review
               FROM batches"""
        ).fetchone()
        recent = connection.execute(
            "SELECT * FROM batches ORDER BY created_at DESC LIMIT 5"
        ).fetchall()
    count = totals["samples"]
    return {
        "inspections": totals["inspections"],
        "samples": count,
        "grade_a_count": totals["grade_a"],
        "urs_count": totals["urs"],
        "review_count": totals["review"],
        "grade_a_pct": round(totals["grade_a"] / count * 100, 1) if count else 0,
        "recent": [_summary(row) for row in recent],
    }


def save_review(path: Path, sample_id: str, grade: str, note: str) -> str | None:
    with _connect(path) as connection:
        row = connection.execute("SELECT batch_id FROM samples WHERE id = ?", (sample_id,)).fetchone()
        if not row:
            return None
        batch_id = row["batch_id"]
        connection.execute(
            "UPDATE samples SET human_grade = ?, review_note = ?, review_required = 0 WHERE id = ?",
            (grade, note, sample_id),
        )
        _recalculate(connection, batch_id)
    return batch_id
