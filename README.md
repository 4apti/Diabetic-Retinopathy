# NetraScan — Automated DR Analysis & Explainable Diagnostic Platform

AI-powered diabetic retinopathy (DR) screening prototype for rural Primary Health
Centres. **Phase 1** (capture + quality gate + role auth), **Phase 2** (real
trained models + dual-engine analysis + provenance), **Phase 3** (real
Grad-CAM explainability + structured findings + plain-language reports) and
**Phase 4** (telemedicine store-and-forward sync, ophthalmologist sign-off
portal, patient status stages, local-language + voice summaries) are all
implemented. Remaining polish is listed under *Future work*.

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
| Ophthalmologist | `ophthalmologist@netrascan.in` | `Doctor123!` |

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
The clinical report templates are English; Phase 4's patient summaries add
Hindi + voice on top of the template engine, decoupled from it.

**Report export**: copy/print from the browser via the in-report print button
and a print stylesheet (PDF export is a planned stretch goal).

## Phase 4 — Telemedicine & the ophthalmologist review loop

The closed loop: **PHC captures → query quality gate → two-engine analysis →
report + heatmap → store-and-forward sync queue → ophthalmologist review →
sign-off → patient summary in their language, with voice.**

- **Store-and-forward queue** (`sync_queue`, idempotent by `image_id`): every
  generated report is enqueued automatically. A background worker re-checks
  bandwidth (`telemedicine_base_url` /health, >3 s ⇒ low) and transmits with
  exponential backoff (30 s → 60 s → 120 s → 240 s, capped at 5 min). Low
  bandwidth keeps the case *queued* with "Waiting for connection"; transmission
  failures are recorded as `failed` and retried, never dropped. Auto-resumes
  when connectivity returns.
  - **Prototype simplification (stated here honestly)**: the PHC-facing instance
    and the *telemedicine server* are the **same backend**, so a successful
    transmission is an internal state transition (`queued → syncing → synced`).
    The retry/backoff/bandwidth semantics are fully real; only the network hop
    is elided. A real two-server deployment is listed under *Future work*.
  - **Admin demo switch** (`POST /api/sync/offline-sim`): forces the bandwidth
    probe down so the low-bandwidth state can be demonstrated live — the UI
    keeps working and drains the queue when the switch is flipped back.
- **Ophthalmologist role** — a third clinical role (own `/doctor/login` route,
  seeded `ophthalmologist@netrascan.in`). Server-side `require_roles` guards
  every endpoint; the queue never trusts the client.
- **Review portal** (`/dashboard/doctor`): synced cases with the full Phase 3
  evidence (scan, heatmap, structured findings, report), sorted flagged-first,
  filterable (All / Flagged / Awaiting), sync-state chips, and **sign-off**
  (Approved / Revised / Rejected) stored in the auditable `sign_offs` table —
  a revision keeps the AI grade *and* the doctor's `revised_grade` (a natural
  future retraining signal). Opening a case records `viewed_at`.
- **Notifications (§5, polling)**: the dashboard shell polls
  `GET /api/doctor/queue/count` every 20 s, shows a persistent **Queue (N)**
  badge (red when any are `Flagged for Review`) and a toast when new cases
  arrive. Push/email/SMS are explicitly out of scope (Future work).
- **Patient status stages (§6)**: server-derived (no duplicate status column)
  on the patient scan page — *Scan received → Analysis in progress → Awaiting
  doctor review → Reviewed*. Plain language, icon-paired, no fake ETA. The AI
  report and heatmap are **only shown to the patient after sign-off**; before
  that the page says the scan is with the doctor.
- **Local-language + voice summaries (§6–§7)**: after sign-off, a
  doctor-summary is generated into `patient_summaries` in **English + Hindi**
  from per-language templates (never machine translation), using the
  doctor's `revised_grade` when a case was Revised. Voice is **offline** —
  pre-generated Windows SAPI (System.Speech) WAVs per case/language, served
  via an access-controlled endpoint with an in-page play button. No live TTS
  call, no new packages. Hindi audio is generated with **Microsoft Edge TTS**
  (`hi-IN-SwaraNeural`, via the `edge-tts` package) and cached as an `.mp3` per
  case; English uses the offline Windows SAPI WAV path. Audio is generated once
  and cached, so playback after that is fully offline. If no audio can be
  produced, the patient dashboard falls back to the browser's Web Speech API.
  - **Translations note**: the Hindi template copy was authored by a non-native
    writer and should be reviewed by a fluent Hindi speaker before any
    production use (flagged in the code too).
- **Demo data**: `python -m app.seed` pre-syncs the demo cases into the doctor
  queue and pre-signs one case (summary + voice included) so every patient
  stage is demonstrable immediately. A full closed-loop run: log in as
  worker → upload → analyze → the case appears (badge + toast) for
  ophthalmologist → sign off → patient sees *Reviewed* + summary + voice.

New tables: `sync_queue`, `sign_offs`, `patient_summaries`; new modules:
`app/sync.py` (worker + bandwidth probe), `app/ml/summaries.py` (templates +
SAPI voice), `app/routers/telemedicine.py` (queue/sign-off/summaries APIs),
`components/reports/report-panel.tsx`, Phase 4 sections in the admin overview
and dashboards.

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
  progress states, and a store-and-forward sync queue with bandwidth-gated
  backoff and automatic resume. A full PWA offline queue (local capture buffer
  that syncs later) is Future work.
- **Prototype deployments**: one backend hosts both the PHC-facing API and the
  telemedicine role (see Phase 4 notes); reports and heatmaps are regenerated
  after classifier retraining completes via the watchdog script.
- **CPU-only**: the reference machine has no discrete GPU; inference/training
  run on CPU (documented CPU-only fallback, must not crash).

## Future work

- **Real two-server deployment**: PHC instance ↔ telemedicine server over HTTPS,
  with signed payloads replacing the internal-state transition.
- **ABDM integration** (Ayushman Bharat Digital Mission): patient consent,
  ABHA identity linking and record sync to the ABDM ecosystem.
- **PWA offline queue**: buffer captures on-device and batch-sync when
  connectivity returns (the backend queue semantics already support this).
- **Fundus-vs-non-fundus binary gate** so non-retinal photos are rejected early
  rather than graded.
- **More languages & voices**: the template engine and SAPI pipeline are
  table-driven, so extra template languages/voices drop in without new code.
- **Native-speaker review** of the Hindi templates before any real use.
- **Retraining feedback loop**: `Revised` sign-offs are preserved as labels and
  are the intended signal for classifier fine-tuning.
- **Notifications**: push / email / SMS out of band (polling covers the demo).
- **PDF export** of reports (print stylesheet exists).

## Project layout

```
backend/                FastAPI (auth, uploads, quality gate, analyze,
                        dashboard, telemedicine, ML registry, trainers, seed,
                        sync worker, parity script)
  app/ml/               preprocessing | quality_gate | classifier | detector |
                        consistency | registry | gradcam | reports | summaries
  app/routers/          auth | patients | uploads | analyze | dashboard |
                        reports | telemedicine
  demo_samples/         curated pre-verified fundus + poor captures
app/  components/  lib/ Next.js (React + Tailwind): patient/worker/doctor/admin
                        (+ report-panel, review portal, login variants)
```