# NetraScan — Automated DR Analysis & Explainable Diagnostic Platform

AI-powered diabetic retinopathy (DR) screening prototype for rural Primary Health
Centres. **Phase 1** (capture + quality gate + role auth), **Phase 2** (real
trained models + dual-engine analysis + provenance) and **Phase 3** (real
Grad-CAM explainability + structured findings + plain-language reports) are
implemented; telemedicine, ABDM sync, offline store-and-forward and
local-language output remain locked "Coming Next" stubs (Phase 4).

---

## Quick start

Requirements: **Python 3.13.1**, **Node 20+ (developed on v25.8.2)**.

```bash
# 1. Frontend
npm install
npm run build

# 2. Backend (from backend/)
python -m venv .venv  # outside backend/, at repo root
pip install -r backend/requirements.txt -r backend/requirements-ml.txt
python -m app.seed                      # demo users, patients, demo scans
uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. Run
npm start            # http://localhost:3000  (API at :8000)
```

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@netrascan.in` | `Admin123!` |
| Patient | `patient@example.org` | `Patient123!` |
| Health worker | `worker@example.org` | `Worker123!` |
| Doctor | `doctor@example.org` | `Doctor123!` |

> Auth note: Phase 1's prompt specified phone + mocked-OTP login. NetraScan v2
> ships email + password with bcrypt hashing and an in-memory login rate limiter
> (10 attempts / 15 min per IP). The mocked-OTP flow was intentionally *not*
> implemented — the UI and API are honest about this rather than faking SMS.

## Quality gate

Real checks, tuned on the APTOS 2019 training set:

- **Blur**: variance-of-Laplacian, computed on a fixed **500 px** downscale so the
  metric is resolution-independent. Threshold **15.0** — APTOS sharp fundus
  photos median ~30 (p25 ≈ 21), deliberately blurred captures score < 15.
- **Fundus plausibility**: red-channel dominance (`< 0.32` → "may not be fundus")
  and dark-periphery fraction (`< 0.24` → "no dark periphery") produce warnings.
- **Recapture flow**: failed captures increment `retake_count`; after 3
  consecutive failures the UI suggests checking the lens/camera setup.

## Datasets & models

- **Engine B — DR severity (0–4 ICDR)**: `EfficientNet-B0` fine-tuned on
  **APTOS 2019 Blindness Detection** (3,662 images), weighted CrossEntropyLoss
  (inverse class frequency), stratified 85/15 validation split seeded at 42,
  checkpoint selected on **Quadratic Weighted Kappa**. Confidence = softmax
  probability of the predicted grade. Tensor preprocessing (center-crop 380 →
  CLAHE → denoise → ImageNet normalize) is shared byte-for-byte between
  training and inference (`verify_preprocessing_parity.py` proves it).
- **Engine A — lesion detection**: `YOLOv8n` fine-tuned on **IDRiD**
  (microaneurysms / haemorrhages / hard & soft exudates), 11,378 boxes across
  54 training images. When weights are unavailable the pipeline degrades
  honestly to classifier-only (`detector_ready: false` in `/health`).
- **Dual-engine consistency**: lesion load → expected grade band vs classifier
  grade → `Consistent` / `Flagged for Review` / `Review - Low Lesion Evidence`
  (zero lesions but grade ≥ 2).

Model weights are **not committed** to git. Generated artifacts live in
`backend/models/` (`efficientnet_b0_dr.pt` + `efficientnet_b0_dr_meta.json` with
epoch, val QWK, training date and git commit) and `backend/models/weights`.
Re-train or download as needed.

## Demo samples

`backend/demo_samples/` holds a curated, pre-verified set: **2 clean fundus
images per severity grade (0–4)** plus **2 deliberately blurred/dark captures**
that exercise the recapture flow. Regenerate with:

```bash
python backend/prepare_demo_samples.py --data-dir path/to/aptos2019
```

`python -m app.seed` also populates demo patients/scans/findings so the admin
dashboard and doctor review queue are never empty on first load.

## Phase 3 — Explainable AI & screening reports

Every completed Phase 2 analysis automatically produces (and caches in the
`screening_reports` table):

- **Real Grad-CAM heatmap** computed against the actual trained
  `efficientnet_b0_dr.pt` checkpoint (manual forward/backward hooks on
  `features[-1]`; 5-class head targets the predicted grade, ordinal head the
  raw severity score). The CAM is overlaid pixel-for-pixel on the preprocessed
  image the model actually saw. Generated once, then served from storage
  (`uploads/reports/{image_id}_gradcam.png`) — never regenerated per page view.
  **Failure handling**: OOM / hook / checkpoint errors are caught; the pipeline
  continues with `gradcam_path = null` and the UI shows "Heatmap unavailable".
  Backfill/re-verify a batch with `python backend/generate_reports.py --force`
  (this also runs automatically after classifier training finishes).
- **Structured clinical findings** — a restructuring of the `ai_findings` row
  (ICDR grade + label, lesion summary, total count, consistency status,
  flagged reason, engine `model_version`), served to the admin/clinical view.
- **Plain-language report (template NLG)** — deterministic, fully offline
  (Option A in the spec), patient-friendly wording with a severity-appropriate
  next step. Follow-up recommendation thresholds follow the ICDR severity scale
  and the AAO Diabetic Retinopathy Preferred Practice Pattern (2019): No DR →
  ~12 months, Mild → 6–12 months, Moderate → ~6 months, Severe → prompt
  referral, Proliferative → urgent referral. A clinical disclaimer is embedded
  **in the report text itself** so it survives printing/sharing.

**Invalidation**: reports are keyed to the engine `model_version`
(`efficientnet_b0_dr:<validation_qwk>`). If an image is re-analyzed or the
checkpoint is updated, the stored report is regenerated rather than left stale.

**Limitations disclosed**: Phase 1's capture flow does not record the eye
(OD/OS), so `region_notes` uses *image-relative* quadrants ("upper-left region
of the image"), never anatomical terms — noted in the admin Model Info panel.
Report text is English-only (Phase 4 adds local-language output, kept decoupled
from the template engine).

**Report export**: copy/print from the browser via the in-report print button
and a print stylesheet (PDF export is a planned stretch goal).

## Provenance & clinical disclaimer

Every result view shows exactly what was run (model, training source, val QWK,
detector status) plus:

> *NetraScan is a decision-support prototype, not a certified diagnostic device.
> Results must be reviewed by a qualified ophthalmologist before any clinical
> decision.*

The quality gate warns when an image looks non-fundus; however the classifier
has no built-in "is this a retina" check — a non-fundus photo will still produce
a numeric grade, which is disclosed in the UI/README. A binary fundus-vs-non
gate is a listed stretch goal.

## Known constraints & next steps

- **Rural/low-connectivity**: lightweight UI, large touch targets, upload
  progress states. No offline support yet (listed as a future consideration).
- **Deferred (stubs only)**: Grad-CAM heatmaps, NLG report generation,
  telemedicine/ABDM sync — visible as a locked "Coming Next" card.
- **CPU-only**: the reference machine has no discrete GPU; inference/training
  run on CPU (documented CPU-only fallback, must not crash).

## Project layout

```
backend/                FastAPI (auth, uploads, quality gate, analyze,
                        dashboard, ML registry, trainers, seed, parity script)
  app/ml/               preprocessing | quality_gate | classifier | detector |
                        consistency | registry
  demo_samples/         curated pre-verified fundus + poor captures
app/  components/  lib/ Next.js (React + Tailwind): patient/worker/doctor/admin
```