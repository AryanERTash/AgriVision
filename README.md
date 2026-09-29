# AgriVision Onion Quality Studio(SIH PROJECT)

A browser based prototype for onion inspection and batch reporting. The web page talks to a local FastAPI service; inspection images and reports stay on the machine running the server.

## Run it

Use the existing Conda environment:

```bash
conda run -n p30 python -m pip install -r requirements.txt
conda run -n p30 uvicorn main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The app initializes its SQLite database and `data/media/` folder on first start. Set `ONION_DATA_DIR` to move local report and image storage elsewhere.

## Deploy on Render

Create a Render **Web Service** connected to this repository and select the **Docker** runtime. Render will build the root `Dockerfile`. The container binds to `0.0.0.0` and uses Render's `PORT` environment variable; `/api/health` is the health-check path.

The container stores SQLite data and uploaded report images under `/var/data`. To retain them through restarts and deploys, attach a persistent disk mounted at `/var/data`. Render's filesystem is otherwise ephemeral, and persistent disks require a paid service plan. For a disposable demo deployment, no disk setup is needed.

## What the prototype does

- Accepts one tray photo or up to 12 individual onion images (JPEG, PNG and WebP, up to 15 MB each).
- Includes a downloadable `sample.jpeg` and an in-form button to add it to a sample inspection.
- Runs a local YOLOv8n detector fine tuned for the dataset's fresh and defective onion labels. OpenCV adds visible green-sprout-like and dark-patch cues.
- Draws an annotated image, estimates Grade A / URS per detected onion, and stores a SQLite batch report.
- Compares onion size only against other bulbs in the same photo; it does not infer millimetres from an uncalibrated image.
- Lets an operator correct a sample grade, exports item details to CSV, and prints a report to PDF from the browser.

The model is a demo assessment. Its learned classes are fresh and defective; the sprout and dark-patch labels are colour cues, not separately trained defect diagnoses. One photo cannot show internal rot, firmness or moisture. URS is shown as “Under Reference Standard” for this prototype; set procurement thresholds with the relevant buyer.

If the model file is not present or cannot load, the app keeps the workflow available and marks image-cue-only detections as requiring manual review.

## Model and dataset

`models/onion_quality.pt` is a YOLOv8n checkpoint fine tuned in this project for the two onion classes. Training uses the train and validation splits of the [VegQual fresh/defective produce dataset](https://doi.org/10.6084/m9.figshare.30596084.v4), by Tarek Rahman et al., shared under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The included checkpoint is the best validation checkpoint from a short seven-epoch local run; use the included training script for a longer fit against the full filtered dataset. The model is intended for local demonstration, not procurement certification.

`static/assets/sample.jpeg` is an example fresh-onion photo from VegQual, used under CC BY 4.0. Dataset credit: Tarek Rahman et al., [VegQual](https://doi.org/10.6084/m9.figshare.30596084.v4).

To repeat the fine tune, remove the existing model file if you want to replace it, then run:

```bash
conda run -n p30 python scripts/train_model.py --epochs 25 --imgsz 512
```

The script downloads the dataset to `dataset/`, filters the onion annotations, starts from Ultralytics' pretrained YOLOv8n weights, and writes the fine tuned checkpoint to `models/onion_quality.pt`. The full downloaded dataset is excluded from version control.

## API

- `GET /api/health` — server and model status
- `GET /api/summary` — dashboard counts and latest inspections
- `GET /api/batches` — saved inspection list
- `GET /api/batches/{id}` — full report
- `GET /api/batches/{id}/report.csv` — CSV export
- `POST /api/analyze` — multipart image upload and inspection
- `PATCH /api/samples/{id}/review` — save a human grade correction

The report print action opens the browser print dialog; select “Save as PDF” to create a PDF.
