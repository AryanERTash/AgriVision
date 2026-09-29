from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "dataset"
RAW_DIR = DATASET_DIR / "vegqual"
FILTERED_DIR = DATASET_DIR / "onion-detection"
MODEL_DIR = ROOT / "models"
FIGSHARE_API = "https://api.figshare.com/v2/articles/30596084"
CLASS_MAP = {4: 0, 10: 1}  # defected_onion, fresh_onion in the published VegQual labels


def ensure_dataset(dataset_root: Path | None = None) -> Path:
    if dataset_root:
        configured = dataset_root.expanduser().resolve()
        yaml_path = configured / "data.yaml" if (configured / "data.yaml").is_file() else next(configured.rglob("data.yaml"), None)
        if not yaml_path:
            raise FileNotFoundError(f"No data.yaml found under {configured}")
        return yaml_path.parent
    yaml_path = next(RAW_DIR.rglob("data.yaml"), None) if RAW_DIR.exists() else None
    if yaml_path:
        return yaml_path.parent
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    metadata = requests.get(FIGSHARE_API, timeout=30)
    metadata.raise_for_status()
    files = metadata.json().get("files", [])
    archive_meta = next((item for item in files if item["name"].endswith(".zip")), None)
    if not archive_meta:
        raise RuntimeError("The VegQual archive was not listed in Figshare metadata")
    archive_path = DATASET_DIR / archive_meta["name"]
    if not archive_path.exists():
        with requests.get(archive_meta["download_url"], stream=True, timeout=(20, 180)) as response:
            response.raise_for_status()
            with archive_path.open("wb") as output:
                for block in response.iter_content(chunk_size=1024 * 1024):
                    if block:
                        output.write(block)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(RAW_DIR)
    yaml_path = next(RAW_DIR.rglob("data.yaml"), None)
    if not yaml_path:
        raise RuntimeError("VegQual archive has no data.yaml file")
    return yaml_path.parent


def filter_onions(source: Path) -> Path:
    if FILTERED_DIR.exists():
        shutil.rmtree(FILTERED_DIR)
    split_names = {"train": "train", "valid": "valid", "test": "test"}
    for split in split_names.values():
        image_dir = FILTERED_DIR / split / "images"
        label_dir = FILTERED_DIR / split / "labels"
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        for label_path in (source / split / "labels").glob("*.txt"):
            remapped = []
            for line in label_path.read_text().splitlines():
                fields = line.split()
                if len(fields) >= 5 and int(fields[0]) in CLASS_MAP:
                    fields[0] = str(CLASS_MAP[int(fields[0])])
                    remapped.append(" ".join(fields))
            if not remapped:
                continue
            image_path = source / split / "images" / f"{label_path.stem}.jpg"
            if not image_path.exists():
                matches = list((source / split / "images").glob(f"{label_path.stem}.*"))
                if not matches:
                    continue
                image_path = matches[0]
            shutil.copy2(image_path, image_dir / image_path.name)
            (label_dir / f"{image_path.stem}.txt").write_text("\n".join(remapped) + "\n")
    config = {
        "path": str(FILTERED_DIR.resolve()),
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": 2,
        "names": ["defected_onion", "fresh_onion"],
    }
    FILTERED_DIR.mkdir(parents=True, exist_ok=True)
    yaml_path = FILTERED_DIR / "data.yaml"
    yaml_path.write_text(
        "\n".join(
            [
                f"path: {json.dumps(config['path'])}",
                f"train: {config['train']}",
                f"val: {config['val']}",
                f"test: {config['test']}",
                "nc: 2",
                "names: ['defected_onion', 'fresh_onion']",
            ]
        )
        + "\n"
    )
    return yaml_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine tune a YOLOv8n onion fresh/defective detector")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--imgsz", type=int, default=512)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--dataset-root", type=Path, default=None, help="Use an already extracted VegQual folder")
    args = parser.parse_args()

    from ultralytics import YOLO

    source = ensure_dataset(args.dataset_root)
    data_yaml = filter_onions(source)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=4,
        patience=8,
        project=str(ROOT / "runs"),
        name="onion-quality",
        exist_ok=True,
        plots=False,
        verbose=True,
    )
    best = Path(results.save_dir) / "weights" / "best.pt"
    if not best.is_file():
        raise RuntimeError(f"Training finished without producing {best}")
    shutil.copy2(best, MODEL_DIR / "onion_quality.pt")
    print(f"Saved model: {MODEL_DIR / 'onion_quality.pt'}")


if __name__ == "__main__":
    main()
