"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  type ScreeningReport,
  fetchGradcamBlobUrl,
  reportsApi,
} from "@/lib/api"
import { findingBadgeTone } from "@/lib/consistency"

/**
 * Phase 3 explainable screening report.
 *
 * variant="patient"  -> plain-language summary, heatmap, print (no structured
 *                       clinical data — that stays behind the admin views).
 * variant="clinical" -> same report PLUS the underlying structured findings
 *                       and region notes for an ophthalmologist to review.
 */
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
  const [heatmapUrl, setHeatmapUrl] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let active = true
    reportsApi
      .get(token, imageId)
      .then((r) => {
        if (!active) return
        setReport(r)
        if (r.gradcam_path) {
          return fetchGradcamBlobUrl(imageId, token).then((url) => {
            if (active) setHeatmapUrl(url)
          })
        }
        setHeatmapUrl(null)
        return undefined
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

  const sf = report.structured_findings

  return (
    <div className="report-area space-y-4">
      {variant === "clinical" && (
        <div className="flex items-center justify-between gap-3 no-print">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Generating model v{report.model_version ? report.model_version.split(":")[1] ?? report.model_version : "—"}
          </p>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print report
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AI heatmap
          </p>
          {heatmapUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL
            <img
              src={heatmapUrl}
              alt="Grad-CAM heatmap showing which retinal regions drove the AI decision"
              className="mt-2 w-full rounded-lg border"
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {report.gradcam_path ? "Loading heatmap…" : "Heatmap unavailable"}
            </p>
          )}
          {report.region_notes && (
            <p className="mt-2 text-xs text-muted-foreground">
              Activation: {report.region_notes}.
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Plain-language summary
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 font-sans text-sm leading-relaxed">
            {report.report_text}
          </pre>
        </div>
      </div>

      {variant === "clinical" && (
        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Structured clinical findings (for review)
          </summary>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">ICDR grade</p>
              <p className="mt-1 font-semibold">
                {sf.icdr_grade_label ?? "—"}
                {sf.icdr_grade != null ? ` (grade ${sf.icdr_grade})` : ""}
              </p>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Consistency</p>
              <Badge tone={findingBadgeTone(sf.consistency_status)}>{sf.consistency_status}</Badge>
              {sf.flagged_reason && (
                <p className="mt-2 text-xs text-muted-foreground">{sf.flagged_reason}</p>
              )}
            </div>
            <div className="rounded-md bg-muted/40 p-3 sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Lesion summary ({sf.total_lesion_count} total)
              </p>
              {sf.lesion_summary.length === 0 ? (
                <p className="mt-1 text-muted-foreground">None detected</p>
              ) : (
                <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                  {sf.lesion_summary.map((l) => (
                    <li key={l.type} className="flex justify-between">
                      <span className="text-muted-foreground">{l.type.replace(/_/g, " ")}</span>
                      <span className="font-medium tabular-nums">{l.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Region notes</p>
              <p className="mt-1 text-muted-foreground">{report.region_notes ?? "Not available"}</p>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Engine</p>
              <p className="mt-1 text-muted-foreground">
                {report.model_version ?? "unknown"} · {report.generation_method}
              </p>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}