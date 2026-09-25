"use client"

/**
 * Professional medical report document (universal diagnostic-report format).
 *
 * This replaces the former "dashboard-like" case layout for clinicians: a
 * single-page, printable report document built strictly from real AI output.
 * Missing data renders as "Not Available" or "Unable to assess reliably from
 * the available image." — never as silence. The fundus figures are labeled
 * Figure 1 / Figure 2 and open the shared in-tab lightbox (zoom / pan / reset /
 * fullscreen) so the embedded image is reviewed in-place, never in a new tab.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ScanImageViewer } from "@/components/reports/image-viewer"
import { Badge } from "@/components/ui/badge"
import {
  type MedicalReport,
  type MedicalReportLesionTableRow,
  type ReportHeader,
  reportsApi,
} from "@/lib/api"
import { ScanEye } from "lucide-react"
import { cn } from "cn"

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function formatStamp(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-b-2 border-slate-800 pb-1 font-heading text-xs font-bold uppercase tracking-[0.14em] text-slate-900 dark:border-slate-200 dark:text-slate-100">
      {children}
    </h3>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}

function QualityNote({ quality }: { quality: string }) {
  if (!quality || quality.includes("not assessed")) return null
  const poor = quality.includes("poor") || quality.includes("insufficiently")
  if (!poor) return null
  return (
    <div className="rounded-md border border-amber-400/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      {quality}
    </div>
  )
}

function FigureFrame({
  figure,
  caption,
  children,
}: {
  figure: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure>
      <div className="overflow-hidden rounded-lg border bg-white p-1.5 shadow-sm dark:border-slate-700">
        {children}
      </div>
      <figcaption className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">{figure}:</span> {caption}
      </figcaption>
    </figure>
  )
}

function LesionTableRow({ row }: { row: MedicalReportLesionTableRow }) {
  const conf = row.confidence
  const confText = conf != null ? conf.toFixed(2) : "Not Available"
  return (
    <tr className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
      <td className="py-1.5 pr-3 text-sm text-slate-800 dark:text-slate-200">{row.label}</td>
      <td className="py-1.5 pr-3 text-right text-sm tabular-nums text-slate-800 dark:text-slate-200">
        {row.count}
      </td>
      <td className="py-1.5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
        {confText}
      </td>
    </tr>
  )
}

function MedicalReportDocument({
  report,
  header,
  imageId,
  token,
  signOff,
}: {
  report: MedicalReport
  header: ReportHeader | null | undefined
  imageId: string
  token: string
  signOff: { decision: string; doctor_notes: string | null; signed_at: string; ophthalmologist_id: number } | null
}) {
  const [impressionExpanded, setImpressionExpanded] = React.useState(false)

  const scanDate = report.examination?.scan_date ?? header?.scan_date ?? null
  const eye = report.examination?.eye ?? header?.eye_laterality ?? "Not captured"
  const qualityLine = report.examination?.quality ?? ""
  const generatedAt =
    report.generated_at ?? report.report_status?.generated_at ?? formatStamp(header?.generated_at)

  const discrepant = report.consistency?.discrepant ?? false

  return (
    <article className="medical-report mx-auto w-full max-w-4xl rounded-sm border border-slate-300 bg-white p-6 text-slate-900 shadow-sm sm:p-10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-800 pb-4 dark:border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900">
            <ScanEye className="size-6" aria-hidden />
          </div>
          <div>
            <p className="font-heading text-lg font-bold leading-tight">NetraScan Screening</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Diabetic Retinopathy Screening Centre &middot; Community Screening Program
            </p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">
            Medical Report
          </h2>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            AI-assisted screening report
          </p>
        </div>
      </header>

      {/* Report meta */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <p>
          Report ID: <span className="font-semibold text-slate-800 dark:text-slate-200">{report.report_id}</span>{" "}
          &nbsp;&middot;&nbsp; Generated:{" "}
          <span className="font-semibold text-slate-800 dark:text-slate-200">{generatedAt || "—"}</span>
        </p>
        <Badge tone="outline" className="normal-case">
          Scanner ID: {imageId.slice(0, 8)}
        </Badge>
      </div>

      <div className="mt-5 space-y-6">
        {/* PATIENT INFORMATION */}
        <section>
          <SectionHeading>1. Patient Information</SectionHeading>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <InfoRow label="Patient name" value={report.patient?.name} />
            <InfoRow label="Patient ID" value={report.patient?.patient_id} />
            <InfoRow label="Age" value={report.patient?.age} />
            <InfoRow label="Gender" value={report.patient?.gender} />
            <InfoRow label="Referring PHC" value={report.patient?.referring_phc} />
            <InfoRow label="Submitted by" value={report.patient?.submitting_worker} />
          </dl>
        </section>

        {/* EXAMINATION */}
        <section>
          <SectionHeading>2. Examination</SectionHeading>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <InfoRow label="Scan ID" value={report.examination?.scan_id} />
            <InfoRow label="Date of scan" value={formatDate(scanDate)} />
            <InfoRow label="Eye" value={eye} />
            <InfoRow label="Modality" value={report.examination?.modality} />
          </dl>
          {!qualityLine.includes("acceptable") && (
            <div className="mt-3">
              <QualityNote quality={qualityLine} />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{qualityLine}</p>
            </div>
          )}
          {qualityLine.includes("acceptable") && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{qualityLine}</p>
          )}
        </section>

        {/* FUNDUS IMAGE REVIEW */}
        <section>
          <SectionHeading>3. Fundus Image Review</SectionHeading>
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            <FigureFrame
              figure="Figure 1"
              caption="Original fundus photograph as submitted for screening. Open the embedded viewer to zoom and pan in-place."
            >
              <ScanImageViewer
                imageId={imageId}
                token={token}
                defaultMode="scan"
                label={`${report.patient?.name ?? "Patient"} — fundus image (Figure 1)`}
              />
            </FigureFrame>
            <FigureFrame
              figure="Figure 2"
              caption="Same fundus image with the AI explainability heatmap overlaid — regions that drove the severity assessment. Use the Fundus / Heatmap toggle in the viewer to compare."
            >
              <ScanImageViewer
                imageId={imageId}
                token={token}
                defaultMode="heatmap"
                showHeatmap
                label={`${report.patient?.name ?? "Patient"} — AI explainability (Figure 2)`}
              />
            </FigureFrame>
          </div>
        </section>

        {/* FINDINGS */}
        <section>
          <SectionHeading>4. Findings</SectionHeading>
          <div className="mt-3 space-y-3 text-sm leading-relaxed">
            <p>
              <span className="font-semibold">Optic disc:</span>{" "}
              {report.findings?.optic_disc ?? "Unable to assess reliably from the available image."}
            </p>
            <p>
              <span className="font-semibold">Macula:</span>{" "}
              {report.findings?.macula ?? "Unable to assess reliably from the available image."}
            </p>
            <p>
              <span className="font-semibold">Vasculature:</span>{" "}
              {report.findings?.vasculature ?? "Unable to assess reliably from the available image."}
            </p>
            <p>
              <span className="font-semibold">Background / retina:</span>{" "}
              {report.findings?.background ?? "Unable to assess reliably from the available image."}
            </p>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(report.findings?.lesion_lines ?? []).map((l) => (
              <li key={l.label} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{l.label}:</span>
                <span>{l.count_text}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{l.confidence_text}</span>
              </li>
            ))}
          </ul>
          {report.findings?.lesion_note && (
            <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">
              {report.findings.lesion_note}
            </p>
          )}
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">Region of AI attention:</span>{" "}
            {report.findings?.region_attention ?? "Unable to assess reliably from the available image."}
          </p>
        </section>

        {/* LESION TABLE */}
        <section>
          <SectionHeading>5. Detected Lesions</SectionHeading>
          <table className="mt-3 w-full">
            <thead>
              <tr className="border-b border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:text-slate-400">
                <th className="pb-1.5 pr-3 font-semibold">Lesion</th>
                <th className="pb-1.5 pr-3 text-right font-semibold">Count</th>
                <th className="pb-1.5 text-right font-semibold">Mean detection confidence</th>
              </tr>
            </thead>
            <tbody>
              {(report.lesion_table ?? []).map((row) => (
                <LesionTableRow key={row.type} row={row} />
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Counts and confidences are the AI lesion detector output on the submitted image. "Not
            Available" means the quantity was not recorded for this scan.
          </p>
        </section>

        {/* ICDR CLASSIFICATION */}
        <section>
          <SectionHeading>6. ICDR Classification</SectionHeading>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-300 p-3 dark:border-slate-600">
              <p className="font-heading text-base font-bold">
                {report.classification?.label ?? "Not Available"}
                {report.classification?.grade != null && (
                  <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                    ICDR grade {report.classification.grade}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Severity grade from the AI-assisted severity classifier
                {report.classification?.icdr_confidence != null
                  ? ` · classifier confidence ${report.classification.icdr_confidence.toFixed(3)}`
                  : ""}
                {"."}
              </p>
            </div>
            <div className="rounded-md border border-slate-300 p-3 dark:border-slate-600">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Basis for this grade
              </p>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                {report.classification?.basis ?? "See the plain-language summary below."}
              </p>
            </div>
          </div>
        </section>

        {/* CONSISTENCY */}
        <section>
          <SectionHeading>7. Dual-engine Consistency Check</SectionHeading>
          <div
            className={cn(
              "mt-3 rounded-md border p-3 text-sm",
              discrepant
                ? "border-red-400/80 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
                : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            <p className="font-headline font-semibold">
              {report.consistency?.headline ?? report.ai_analysis_summary?.consistency ?? "Not Available"}
            </p>
            <p className={cn("mt-1", discrepant && "font-medium")}>
              {report.consistency?.status ?? "Not Available"}
            </p>
          </div>
        </section>

        {/* IMPRESSION */}
        <section>
          <SectionHeading>8. Impression</SectionHeading>
          <p className="mt-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {report.impression ?? "Not Available"}
          </p>
          {report.recommendation && (
            <p className="mt-1 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
              {report.recommendation}
            </p>
          )}
        </section>

        {/* OBSERVATIONS */}
        <section>
          <SectionHeading>9. Observations</SectionHeading>
          <ol className="mt-3 space-y-1.5 text-sm text-slate-800 dark:text-slate-200">
            {(report.observations ?? []).map((o, i) => (
              <li key={`${o}-${i}`} className="flex gap-2.5">
                <span className="mt-0.5 font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                  {i + 1}.
                </span>
                <span>{o}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* RECOMMENDATION */}
        <section>
          <SectionHeading>10. Recommendation</SectionHeading>
          <p className="mt-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {report.recommendation ?? "An ophthalmology review is advised."}
          </p>
        </section>

        {/* AI ANALYSIS SUMMARY */}
        <section>
          <SectionHeading>11. AI Analysis Summary</SectionHeading>
          <table className="mt-3 w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Severity classifier</td>
                <td className="py-1.5 text-right text-slate-800 dark:text-slate-200">
                  {report.ai_analysis_summary?.classifier ?? "Not Available"}
                </td>
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Lesion detector</td>
                <td className="py-1.5 text-right text-slate-800 dark:text-slate-200">
                  {report.ai_analysis_summary?.detector ?? "Not Available"}
                </td>
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Assessed grade</td>
                <td className="py-1.5 text-right text-slate-800 dark:text-slate-200">
                  {report.ai_analysis_summary?.grade ?? "Not Available"}
                </td>
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 text-slate-500 dark:text-slate-400">Consistency</td>
                <td className="py-1.5 text-right text-slate-800 dark:text-slate-200">
                  {report.ai_analysis_summary?.consistency ?? "Not Available"}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 align-top text-slate-500 dark:text-slate-400">
                  Explainability
                </td>
                <td className="py-1.5 text-right text-slate-800 dark:text-slate-200">
                  {report.ai_analysis_summary?.region_analysis ?? "Not Available"}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* REPORT STATUS */}
        <section>
          <SectionHeading>12. Report Status</SectionHeading>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <InfoRow label="Report ID" value={report.report_status?.report_id ?? report.report_id} />
            <InfoRow label="Generated at" value={formatStamp(report.report_status?.generated_at ?? generatedAt)} />
            <InfoRow label="Generation method" value={report.report_status?.method ?? "Not Available"} />
            <InfoRow label="AI engine version" value={report.report_status?.model_version ?? "Not Available"} />
            <InfoRow
              label="Clinical sign-off"
              value={
                signOff
                  ? `${signOff.decision} on ${formatDate(signOff.signed_at)} by ophthalmologist #${signOff.ophthalmologist_id}`
                  : "Pending clinical sign-off"
              }
            />
            {signOff?.doctor_notes && (
              <div className="sm:col-span-2">
                <InfoRow label="Ophthalmologist notes" value={signOff.doctor_notes} />
              </div>
            )}
          </dl>
        </section>

        {/* AI DISCLAIMER */}
        <section>
          <SectionHeading>13. AI Disclaimer</SectionHeading>
          <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {report.disclaimer ?? "Not Available"}
          </p>
        </section>
      </div>

      <footer className="mt-8 border-t border-slate-300 pt-4 text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
        End of report &middot; Generated by NetraScan AI-assisted screening platform
      </footer>

      <div className="mt-4 flex flex-col items-start gap-2 no-print">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImpressionExpanded((v) => !v)}
        >
          {impressionExpanded ? "Hide" : "Show"} plain-language summary
        </Button>
        {impressionExpanded && (
          <p className="text-sm text-muted-foreground">{report.impression}</p>
        )}
      </div>
    </article>
  )
}

/**
 * Invisible on-screen document that becomes the only printed output. Callers
 * mount it under a .print-only wrapper and trigger window.print() so page UI,
 * sidebar and workflow controls never reach the printer (or the PDF).
 */
export function MedicalReportPrint({
  imageId,
  token,
  signOff,
}: {
  imageId: string
  token: string
  signOff: React.ComponentProps<typeof MedicalReportDocument>["signOff"]
}) {
  const [report, setReport] = React.useState<MedicalReport | null>(null)
  const [header, setHeader] = React.useState<ReportHeader | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!token) return
    let active = true
    reportsApi
      .get(token, imageId)
      .then((r) => {
        if (!active) return
        setReport(r.structured_findings?.medical_report ?? null)
        setHeader(r.header ?? null)
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
      <div className="print-only">
        <p className="text-sm text-muted-foreground">The medical report is not available yet.</p>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="print-only">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Preparing the medical report&hellip;
        </div>
      </div>
    )
  }

  return (
    <MedicalReportDocument
      report={report}
      header={header}
      imageId={imageId}
      token={token}
      signOff={signOff}
    />
  )
}