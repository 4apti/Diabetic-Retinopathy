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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import {
  type FindingOut,
  type PatientOut,
  type UploadOut,
  fetchScanBlobUrl,
  patientsApi,
} from "@/lib/api"
import { useSession } from "@/lib/session"
import { Info } from "lucide-react"

function parseLesions(raw: string | { type: string; count: number }[]): {
  type: string
  count: number
}[] {
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const gradeLabels = ["No DR", "Mild", "Moderate", "Severe", "Proliferative"]

interface ProvenanceShape {
  classifier?: { model?: string; trained_on?: string; validation_qwk?: number | null }
  detector?: string
}

function ModelProvenanceNote({ raw }: { raw: string }) {
  let data: ProvenanceShape = {}
  try {
    data = JSON.parse(raw) as ProvenanceShape
  } catch {
    data = {}
  }
  const clf = data.classifier
  return (
    <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      <p className="font-medium uppercase tracking-wide">Model &amp; limits</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        <li>
          Severity model: {clf?.model ?? "EfficientNet-B0"}
          {clf?.trained_on ? ` · trained on ${clf.trained_on}` : ""}
          {clf?.validation_qwk != null ? ` · validation QWK ${clf.validation_qwk}` : ""}
        </li>
        <li>
          {typeof data.detector === "string" && data.detector.length > 0
            ? data.detector
            : "Lesion detection was not available for this scan"}
        </li>
        <li>
          This is an AI screening aid for retinal fundus photographs only.
          Results are not a clinical diagnosis — please follow up with an
          eye-care professional.
        </li>
      </ul>
    </div>
  )
}

function findingBadgeTone(status: string): "accent" | "destructive" | "success" {
  if (status === "Flagged for Review") return "destructive"
  if (status === "Completed" || status === "completed" || status === "Consistent")
    return "success"
  return "accent"
}

function FindingPanel({ finding, token }: { finding: FindingOut; token: string }) {
  const [preview, setPreview] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    fetchScanBlobUrl(finding.image_id, token)
      .then((url) => {
        if (active) setPreview(url)
      })
      .catch(() => {
        if (active) setPreview(null)
      })
    return () => {
      active = false
    }
  }, [finding.image_id, token])

  const lesions = parseLesions(finding.lesion_list)
  const statusLabel =
    finding.analysis_status === "completed"
      ? "Completed"
      : finding.analysis_status === "failed"
        ? "Failed"
        : "Queued"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">Scan&nbsp;#{finding.image_id.slice(0, 6)}</CardTitle>
            <CardDescription>
              Analyzed {finding.analyzed_at ? new Date(finding.analyzed_at).toLocaleString() : "—"}
            </CardDescription>
          </div>
          <Badge tone={statusLabel === "Failed" ? "destructive" : statusLabel === "Completed" ? "success" : "accent"}>
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {finding.analysis_status === "failed" && (
          <Alert variant="destructive">
            <Info />
            <AlertTitle>Analysis did not complete</AlertTitle>
            <AlertDescription>
              The screening result is unavailable. Please contact your health
              centre.
            </AlertDescription>
          </Alert>
        )}

        {finding.analysis_status === "completed" && finding.icdr_grade !== null && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                DR severity
              </p>
              <p className="mt-1 font-heading text-lg font-bold">
                {gradeLabels[finding.icdr_grade] ?? finding.icdr_grade}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  grade {finding.icdr_grade}
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Consistency
              </p>
              <Badge tone={findingBadgeTone(finding.consistency_status)}>
                {finding.consistency_status}
              </Badge>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lesion types
              </p>
              <p className="mt-1 text-sm">
                {lesions.length === 0
                  ? "None detected"
                  : lesions
                      .map((l) => `${l.type} × ${l.count}`)
                      .join(", ")}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Confidence
              </p>
              <p className="mt-1 text-sm">
                {finding.icdr_confidence !== null
                  ? `${Math.round(finding.icdr_confidence * 100)}%`
                  : "—"}
              </p>
            </div>
          </div>
        )}

        {finding.analysis_status === "completed" && finding.model_provenance && (
          <ModelProvenanceNote raw={finding.model_provenance} />
        )}

        {finding.analysis_status === "queued" && (
          <p className="text-sm text-muted-foreground">
            This scan is queued for analysis and will appear here once the
            report is ready.
          </p>
        )}

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL from authenticated fetch
          <img
            src={preview}
            alt="Your uploaded retina scan"
            className="max-h-64 w-full rounded-lg border object-cover"
          />
        )}
      </CardContent>
    </Card>
  )
}

function PatientDashboard() {
  const { token } = useSession()
  const [record, setRecord] = React.useState<PatientOut | null>(null)
  const [scans, setScans] = React.useState<UploadOut[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [retry, setRetry] = React.useState(0)

  React.useEffect(() => {
    if (!token) return
    let active = true
    patientsApi
      .self(token)
      .then((self) => {
        if (!active) return
        setRecord(self)
        return patientsApi.scans(token, self.id)
      })
      .then((list) => {
        if (active) setScans(list ?? [])
      })
      .catch((err: Error) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
    }
  }, [token, retry])

  return (
    <DashboardShell
      title="My screenings"
      description="Your NetraScan screening history and AI findings."
    >
      {error && (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>Could not load your records</AlertTitle>
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

      {!record && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading your profile&hellip;
        </div>
      )}

      {record && (
        <Card>
          <CardHeader>
            <CardTitle>{record.full_name}</CardTitle>
            <CardDescription>
              {[record.gender, record.age ? `${record.age} yrs` : null]
                .filter(Boolean)
                .join(" · ") || "Demographics not recorded"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {record.village || record.district
              ? `${[record.village, record.district].filter(Boolean).join(", ")}`
              : "Location not recorded"}
          </CardContent>
        </Card>
      )}

      <h2 className="mt-2 font-heading text-lg font-semibold">
        Screening results
      </h2>
      {scans === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading scans&hellip;
        </div>
      ) : scans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have any screenings yet. A health worker will create
          one during your next community camp.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {scans.map((scan) => {
            const finding = scan.findings?.[0]
            return finding ? (
              <FindingPanel key={scan.image_id} finding={finding} token={token ?? ""} />
            ) : (
              <Card key={scan.image_id}>
                <CardHeader>
                  <CardTitle className="text-base">Scan</CardTitle>
                  <CardDescription>
                    {new Date(scan.uploaded_at).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  This scan has no analysis result yet.
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </DashboardShell>
  )
}

export default function PatientDashboardPage() {
  return (
    <RequireRole roles={["patient"]}>
      <PatientDashboard />
    </RequireRole>
  )
}