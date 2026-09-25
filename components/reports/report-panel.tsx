"use client"

/**
 * Universal explainable screening report (Phase-4-A fixes).
 *
 * The same clinical structure is rendered for the patient and the doctor:
 *   Header snapshot -> Findings -> Observations -> Recommendation -> Disclaimer
 * which mirrors the generated `report_text` byte-for-byte in structure. The
 * patient layout keeps plain-language wording; the clinical variant additionally
 * surfaces the structured model details (flag reason, engine, region clusters).
 *
 * Fix 1 also applies here: the image area uses the shared in-tab
 * ScanImageViewer (zoom/pan + Fundus/Heatmap toggle) rather than a static
 * heatmap image.
 */

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ScanImageViewer } from "@/components/reports/image-viewer"
import {
  type ScreeningReport,
  reportsApi,
} from "@/lib/api"
import { findingBadgeTone } from "@/lib/consistency"
import { Info, TriangleAlert } from "lucide-react"

const LESION_LABELS: Record<string, string> = {
  microaneurysm: "Microaneurysms",
  hemorrhage: "Hemorrhages",
  hard_exudate: "Hard exudates",
  soft_exudate: "Soft exudates / cotton-wool spots",
}

const GRADE_LABELS: Record<number, string> = {
  0: "No DR",
  1: "Mild NPDR",
  2: "Moderate NPDR",
  3: "Severe NPDR",
  4: "Proliferative DR",
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function ReportHeader({ report }: { report: ScreeningReport }) {
  const h = report.header
  if (!h || (!h.patient_name && !h.scan_date)) return null
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">{h.patient_name ?? "Patient"}</span>
        {h.patient_age != null && (
          <span className="text-muted-foreground">
            {h.patient_age} yrs{h.patient_gender ? `, ${h.patient_gender}` : ""}
          </span>
        )}
        <span className="text-muted-foreground">
          Scan #{report.image_id.slice(0, 8)}
        </span>
        <span className="text-muted-foreground">Scanned {formatDate(h.scan_date)}</span>
        {h.referring_phc && (
          <span className="text-muted-foreground">PHC {h.referring_phc}</span>
        )}
        {h.submitting_worker && (
          <span className="text-muted-foreground">via {h.submitting_worker}</span>
        )}
        <span className="text-muted-foreground">
          Eye: {h.eye_laterality ?? "not captured"}
        </span>
      </div>
    </div>
  )
}

function FindingsGrid({ report }: { report: ScreeningReport }) {
  const sf = report.structured_findings
  const breakdown = sf.lesion_breakdown?.length
    ? sf.lesion_breakdown
    : sf.lesion_summary.map((l) => ({ type: l.type, count: l.count }))
  const region = report.region_notes ?? sf.region_notes ?? null
  const gradeLabel =
    sf.icdr_grade != null
      ? (GRADE_LABELS[sf.icdr_grade] ?? sf.icdr_grade_label)
      : sf.icdr_grade_label

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg bg-muted/60 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          DR severity
        </p>
        <p className="mt-1 font-heading text-lg font-bold">
          {gradeLabel}
          {sf.icdr_grade != null && (
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              grade {sf.icdr_grade}
            </span>
          )}
        </p>
        <Badge tone={findingBadgeTone(sf.consistency_status)} className="mt-1">
          {sf.consistency_status}
        </Badge>
      </div>

      <div className="rounded-lg bg-muted/60 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Lesion breakdown
        </p>
        <ul className="mt-1 grid gap-1">
          {breakdown.length === 0 ? (
            <li className="text-sm text-muted-foreground">Not available</li>
          ) : (
            breakdown.map((l) => (
              <li key={l.type} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {LESION_LABELS[l.type] ?? l.type.replace(/_/g, " ")}
                </span>
                <span className="font-medium tabular-nums">{l.count}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="rounded-lg bg-muted/60 p-3 sm:col-span-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Region of AI attention
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {region ?? "Region analysis unavailable."}
        </p>
      </div>

      <div className="rounded-lg bg-muted/60 p-3 sm:col-span-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Basis for this grade
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {sf.grade_basis ?? "See the plain-language summary below."}
        </p>
      </div>
    </div>
  )
}

function ObservationsBlock({ report }: { report: ScreeningReport }) {
  const observations = report.observations?.length
    ? report.observations
    : report.structured_findings.observations
  if (!observations?.length) return null
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Observations</p>
          <ul className="list-inside space-y-1 text-sm text-muted-foreground">
            {observations.map((o, i) => (
              <li key={i} className="flex gap-2">
                <span className="select-none">•</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function RecommendationBlock({ report }: { report: ScreeningReport }) {
  const recommendation = report.recommendation ?? report.structured_findings.recommendation
  if (!recommendation) return null
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Recommended next step</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{recommendation}</p>
        </div>
      </div>
    </div>
  )
}

function DisclaimerBlock({ report }: { report: ScreeningReport }) {
  const disclaimer =
    report.disclaimer ?? report.structured_findings.disclaimer ?? null
  if (!disclaimer) return null
  return (
    <p className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
      {disclaimer}
    </p>
  )
}

function ClinicalDetails({ report }: { report: ScreeningReport }) {
  const sf = report.structured_findings
  const region = sf.region_analysis
  return (
    <details className="rounded-lg border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Structured clinical findings (for review)
      </summary>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Consistency</p>
          <Badge tone={findingBadgeTone(sf.consistency_status)}>{sf.consistency_status}</Badge>
          {sf.flagged_reason && (
            <p className="mt-2 text-xs text-muted-foreground">{sf.flagged_reason}</p>
          )}
        </div>
        {sf.possible_macular_edema && (
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Macular edema risk
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sf.macular_edema_note ?? "Heavy exudation — assess clinically."}
            </p>
          </div>
        )}
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Region analysis</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {region
              ? `${region.description ?? "—"} (${region.cluster_count ?? 0} hotspots, disc ${region.used_optic_disc ? "detected" : "not detected"})`
              : report.region_notes ?? "Not available"}
          </p>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Engine</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.model_version ?? "unknown"} · {report.generation_method}
          </p>
        </div>
      </div>
    </details>
  )
}

export function ScreeningReportPanel({
  imageId,
  token,
  variant = "patient",
}: {
  imageId: string
  token: string
  variant?: "patient" | "clinical"
}) {
  const [report, setReport] = React.useState<ScreeningReport | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let active = true
    reportsApi
      .get(token, imageId)
      .then((r) => {
        if (active) setReport(r)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [imageId, token])

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        The explainable report is not available yet — please try again in a few
        minutes.
      </p>
    )
  }

  if (!report) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" /> Preparing&hellip;
      </div>
    )
  }

  return (
    <div className="report-area space-y-4">
      {variant === "clinical" && (
        <div className="flex items-center justify-between gap-3 no-print">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Generating model v
            {report.model_version ? report.model_version.split(":")[1] ?? report.model_version : "—"}
          </p>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print report
          </Button>
        </div>
      )}

      <ReportHeader report={report} />

      <ScanImageViewer
        imageId={imageId}
        token={token}
        label={report.header?.patient_name ? `${report.header.patient_name} — retina scan` : "Retina scan"}
      />

      <FindingsGrid report={report} />

      <ObservationsBlock report={report} />

      <RecommendationBlock report={report} />

      <DisclaimerBlock report={report} />

      {variant === "clinical" && <ClinicalDetails report={report} />}

      {variant === "patient" && (
        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Full plain-language text
          </summary>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 p-4 font-sans text-sm leading-relaxed text-muted-foreground">
            {report.report_text}
          </pre>
        </details>
      )}
    </div>
  )
}