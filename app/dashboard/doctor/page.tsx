"use client"

import * as React from "react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { RequireRole } from "@/components/dashboard/route-guard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  type ReviewQueueItem,
  type RoleStats,
  dashboardApi,
  fetchScanBlobUrl,
} from "@/lib/api"
import { useSession } from "@/lib/session"
import { Info } from "lucide-react"

const gradeLabels = ["No DR", "Mild", "Moderate", "Severe", "Proliferative"]

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: "default" | "warning" | "danger"
}) {
  return (
    <Card className="gap-1">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={
            tone === "danger"
              ? "text-destructive"
              : tone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : undefined
          }
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function QueueItem({ item, token }: { item: ReviewQueueItem; token: string }) {
  const [preview, setPreview] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    fetchScanBlobUrl(item.image_id, token)
      .then((url) => {
        if (active) setPreview(url)
      })
      .catch(() => {
        if (active) setPreview(null)
      })
    return () => {
      active = false
    }
  }, [item.image_id, token])

  let lesions = "—"
  try {
    if (item.lesion_list) {
      const parsed = JSON.parse(item.lesion_list)
      if (Array.isArray(parsed)) {
        lesions =
          parsed.length === 0
            ? "None"
            : parsed.map((l) => `${l.type} × ${l.count}`).join(", ")
      }
    }
  } catch {
    lesions = "—"
  }

  const flagged = item.consistency_status === "Flagged for Review"

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">
              {item.patient_name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                scan #{item.image_id.slice(0, 6)}
              </span>
            </CardTitle>
            <CardDescription>
              {item.analyzed_at
                ? new Date(item.analyzed_at).toLocaleString()
                : "Not yet analyzed"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={flagged ? "destructive" : "success"}>
              {item.consistency_status}
            </Badge>
            <Badge
              tone={
                item.analysis_status === "completed"
                  ? "success"
                  : item.analysis_status === "failed"
                    ? "destructive"
                    : "accent"
              }
            >
              {item.analysis_status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {item.analysis_status === "failed" ? (
          <p className="text-sm text-muted-foreground">
            The AI engines are not deployed yet, so this scan has no findings.
            It is held for re-analysis.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                DR severity
              </p>
              <p className="mt-1 font-heading text-base font-bold">
                {item.icdr_grade !== null
                  ? `${gradeLabels[item.icdr_grade] ?? item.icdr_grade} (${item.icdr_grade})`
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lesions
              </p>
              <p className="mt-1 text-sm capitalize">{lesions}</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Confidence
              </p>
              <p className="mt-1 text-sm">
                {item.icdr_confidence !== null
                  ? `${Math.round(item.icdr_confidence * 100)}%`
                  : "—"}
              </p>
            </div>
          </div>
        )}

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL from authenticated fetch
          <img
            src={preview}
            alt={`Retina scan for ${item.patient_name}`}
            className="mt-3 max-h-56 w-full rounded-lg border object-cover"
          />
        )}

        {item.analysis_status === "completed" && item.model_provenance && (
          <p className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            {(() => {
              try {
                const prov = JSON.parse(item.model_provenance) as {
                  classifier?: { model?: string; validation_qwk?: number | null }
                  detector?: string
                }
                const clf = prov.classifier
                const parts = [
                  `Severity: ${clf?.model ?? "EfficientNet-B0"}`,
                  clf?.validation_qwk != null
                    ? `val QWK ${clf.validation_qwk}`
                    : null,
                  typeof prov.detector === "string" && prov.detector.length > 0
                    ? prov.detector
                    : "lesion detector unavailable",
                  "AI screening aid only, not a diagnosis",
                ].filter(Boolean)
                return parts.join(" · ")
              } catch {
                return item.model_provenance
              }
            })()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DoctorDashboard() {
  const { token } = useSession()
  const [stats, setStats] = React.useState<RoleStats | null>(null)
  const [queue, setQueue] = React.useState<ReviewQueueItem[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([dashboardApi.stats(token), dashboardApi.reviewQueue(token)])
      .then(([stats, queue]) => {
        if (active) {
          setStats(stats)
          setQueue(queue)
        }
      })
      .catch((err: Error) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
    }
  }, [token, retry])

  const flagged = queue?.filter(
    (item) => item.consistency_status === "Flagged for Review",
  )

  return (
    <DashboardShell
      title="Ophthalmology review"
      description="Prioritise scans that the dual-engine check flagged for review."
    >
      {error && (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>Could not load the review queue</AlertTitle>
          <AlertDescription>
            {error}{" "}
            <Button
              variant="link"
              className="h-auto p-0 text-destructive"
              onClick={() => setRetry((n) => n + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Scans analyzed" value={stats?.scans_analyzed ?? "—"} />
        <StatCard label="Pending analysis" value={stats?.scans_pending ?? "—"} />
        <StatCard label="Flagged for review" value={stats?.flagged_for_review ?? "—"} tone="warning" />
        <StatCard label="Patients registered" value={stats?.total_patients ?? "—"} />
      </div>

      <h2 className="mt-2 font-heading text-lg font-semibold">
        Flagged for review ({flagged?.length ?? "…"})
      </h2>
      {queue === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Scanning the queue&hellip;
        </div>
      ) : flagged && flagged.length > 0 ? (
        <div className="flex flex-col gap-4">
          {flagged.map((item) => (
            <QueueItem key={item.image_id} item={item} token={token ?? ""} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No scans are currently flagged. Recent scans appear in the list
          below for context.
        </p>
      )}

      <h2 className="mt-6 font-heading text-lg font-semibold">Recent scans</h2>
      {queue && queue.length > 0 ? (
        <div className="flex flex-col gap-4">
          {queue
            .filter((item) => item.consistency_status !== "Flagged for Review")
            .map((item) => (
              <QueueItem key={item.image_id} item={item} token={token ?? ""} />
            ))}
        </div>
      ) : queue ? (
        <p className="text-sm text-muted-foreground">
          No scans yet. Uploaded scans will appear here after analysis.
        </p>
      ) : null}
    </DashboardShell>
  )
}

export default function DoctorDashboardPage() {
  return (
    <RequireRole roles={["doctor"]}>
      <DoctorDashboard />
    </RequireRole>
  )
}