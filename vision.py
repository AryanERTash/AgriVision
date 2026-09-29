from __future__ import annotations

from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_EDGE = 3000


def validate_image(raw: bytes) -> None:
    try:
        with Image.open(BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("use a JPEG, PNG, or WebP image")
            width, height = source.size
            if width < 80 or height < 80:
                raise ValueError("image is too small to inspect")
            if width * height > 60_000_000:
                raise ValueError("image dimensions are too large; resize it before upload")
            source.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("use a JPEG, PNG, or WebP image") from exc


def decode_image(raw: bytes) -> np.ndarray:
    try:
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            width, height = image.size
            if max(width, height) > MAX_IMAGE_EDGE:
                image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)
            image = image.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("use a JPEG, PNG, or WebP image") from exc
    width, height = image.size
    if width < 80 or height < 80:
        raise ValueError("image is too small to inspect")
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def _encode_jpg(image: np.ndarray, quality: int = 88) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("could not encode inspection image")
    return encoded.tobytes()


def _crop_bytes(image: np.ndarray, box: tuple[int, int, int, int]) -> bytes:
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    margin_x = max(8, int((x2 - x1) * 0.08))
    margin_y = max(8, int((y2 - y1) * 0.08))
    x1, x2 = max(0, x1 - margin_x), min(width, x2 + margin_x)
    y1, y2 = max(0, y1 - margin_y), min(height, y2 + margin_y)
    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        crop = image
    ch, cw = crop.shape[:2]
    scale = min(420 / max(cw, ch), 1.0)
    if scale < 1:
        crop = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_AREA)
    return _encode_jpg(crop, 86)


def _surface_cues(crop: np.ndarray) -> tuple[list[str], dict[str, float]]:
    if crop.size == 0:
        return [], {"green_pct": 0.0, "dark_patch_pct": 0.0}
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue, saturation, value = cv2.split(hsv)
    total = max(1, crop.shape[0] * crop.shape[1])
    # These are surface-colour cues, not diagnoses. The thresholds err on the side of review.
    green = (hue >= 35) & (hue <= 92) & (saturation >= 65) & (value >= 45)
    dark = (value <= 52) & (saturation >= 38)
    green_pct = float(green.sum()) / total * 100
    dark_pct = float(dark.sum()) / total * 100
    flags: list[str] = []
    if green_pct >= 3.8:
        flags.append("Possible sprout")
    if dark_pct >= 5.5:
        flags.append("Dark surface patches")
    return flags, {"green_pct": round(green_pct, 1), "dark_patch_pct": round(dark_pct, 1)}


def _candidate_boxes(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Simple fallback object proposals for a clearly framed onion on a plain background."""
    height, width = image.shape[:2]
    small_scale = min(1.0, 1000 / max(width, height))
    small = cv2.resize(image, None, fx=small_scale, fy=small_scale) if small_scale < 1 else image.copy()
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    # Foreground pixels differ from a plain background by colour or luminance.
    chroma = cv2.threshold(saturation, 36, 255, cv2.THRESH_BINARY)[1]
    luminance = cv2.threshold(value, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    mask = cv2.bitwise_or(chroma, luminance)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    scale_back = 1 / small_scale
    proposals: list[tuple[int, int, int, int]] = []
    frame_area = small.shape[0] * small.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < frame_area * 0.025 or area > frame_area * 0.86:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        ratio = w / max(1, h)
        if not 0.48 <= ratio <= 1.85:
            continue
        proposals.append(
            (
                max(0, int(x * scale_back)),
                max(0, int(y * scale_back)),
                min(width, int((x + w) * scale_back)),
                min(height, int((y + h) * scale_back)),
            )
        )
        if len(proposals) >= 20:
            break
    return proposals


class OnionVision:
    """Local YOLO detector with cautious CV fallbacks for unrecognized samples."""

    def __init__(self, model_path: Path):
        self.model = None
        self.model_path = model_path
        self.version = "CV fallback"
        self.status = "fallback"
        if model_path.is_file():
            try:
                from ultralytics import YOLO

                self.model = YOLO(str(model_path))
                self.version = "YOLOv8n · VegQual fine-tune"
                self.status = "trained detector ready"
            except Exception as exc:  # Keep upload/report workflows available on unsupported machines.
                print(f"AgriVision model unavailable: {exc}")

    def analyze(self, image: np.ndarray) -> dict:
        height, width = image.shape[:2]
        detections: list[dict] = []
        if self.model is not None:
            try:
                result = self.model.predict(image, imgsz=640, conf=0.22, iou=0.5, verbose=False)[0]
                if result.boxes is not None:
                    names = result.names
                    for box in result.boxes:
                        coords = box.xyxy[0].cpu().numpy().astype(int).tolist()
                        x1, y1, x2, y2 = coords
                        x1, y1 = max(0, x1), max(0, y1)
                        x2, y2 = min(width, x2), min(height, y2)
                        class_id = int(box.cls[0].item())
                        class_name = str(names.get(class_id, "unknown")).lower()
                        kind = "defected" if "defect" in class_name else "fresh"
                        confidence = float(box.conf[0].item())
                        if x2 - x1 < 16 or y2 - y1 < 16:
                            continue
                        detections.append(
                            {"box": (x1, y1, x2, y2), "model_class": kind, "confidence": confidence}
                        )
            except Exception as exc:
                print(f"AgriVision inference fell back to image cues: {exc}")
                self.status = "image-cue fallback"

        if not detections:
            proposals = _candidate_boxes(image)
            if not proposals:
                # Retain a low-confidence sample to make uncertainty visible and reviewable.
                proposals = [(0, 0, width, height)]
            detections = [
                {"box": box, "model_class": "unknown", "confidence": 0.34} for box in proposals
            ]

        detections.sort(key=lambda entry: (entry["box"][1], entry["box"][0]))
        diameters = [max(entry["box"][2] - entry["box"][0], entry["box"][3] - entry["box"][1]) for entry in detections]
        median_diameter = float(np.median(diameters)) if len(diameters) > 1 else 0
        small_objects = {
            index for index, diameter in enumerate(diameters)
            if median_diameter > 0 and diameter < median_diameter * 0.67
        }
        annotated = image.copy()
        items: list[dict] = []
        for index, detection in enumerate(detections, start=1):
            x1, y1, x2, y2 = detection["box"]
            crop = image[y1:y2, x1:x2]
            flags, cues = _surface_cues(crop)
            confidence = detection["confidence"]
            model_class = detection["model_class"]
            if model_class == "defected":
                flags.insert(0, "Visible defect")
            review_required = confidence < 0.52 or model_class == "unknown"
            if review_required:
                flags.append("Manual review")

            size_status = "not measured"
            if len(detections) > 1:
                if index - 1 in small_objects:
                    size_status = "small relative to this frame"
                    flags.append("Undersized · relative")
                else:
                    size_status = "within this frame's size range"
            grade_a = model_class == "fresh" and not flags
            grade = "Grade A" if grade_a else "URS"
            score = 94 if grade_a else 61 if model_class == "unknown" else 55
            score -= 5 * sum(flag != "Manual review" for flag in flags)
            if index - 1 in small_objects:
                score -= 8
            score = max(20, min(98, score))
            color = (50, 149, 65) if grade == "Grade A" else (52, 92, 203)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, max(2, width // 500))
            tag = f"{index:02d}  {grade}  {round(confidence * 100)}%"
            font_scale = min(0.82, max(0.48, width / 1500))
            thickness = max(1, width // 900)
            (tag_width, tag_height), baseline = cv2.getTextSize(
                tag, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
            )
            tag_y = max(tag_height + 8, y1)
            cv2.rectangle(
                annotated,
                (x1, tag_y - tag_height - 8),
                (x1 + tag_width + 12, tag_y + baseline + 3),
                color,
                -1,
            )
            cv2.putText(
                annotated,
                tag,
                (x1 + 6, tag_y - 4),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (255, 255, 255),
                thickness,
                cv2.LINE_AA,
            )
            items.append(
                {
                    "grade": grade,
                    "score": score,
                    "confidence": round(confidence * 100, 1),
                    "model_class": model_class,
                    "flags": list(dict.fromkeys(flags)),
                    "review_required": review_required,
                    "size_status": size_status,
                    "diameter_px": round(float(max(x2 - x1, y2 - y1)), 1),
                    "box": [int(x1), int(y1), int(x2), int(y2)],
                    "cues": cues,
                    "crop": _crop_bytes(image, (x1, y1, x2, y2)),
                    "object_number": index,
                }
            )
        return {"items": items, "annotated": _encode_jpg(annotated)}
