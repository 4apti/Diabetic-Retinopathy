export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"

export class ApiError extends Error {
  status: number
  detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

/**
 * Thin typed wrapper around the NetraScan FastAPI backend.
 * Throws ApiError with the backend `detail` message when a request fails.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(init.headers as Record<string, string>),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })

  if (!response.ok) {
    let detail: string | undefined
    try {
      const body = await response.json()
      detail = typeof body.detail === "string" ? body.detail : undefined
    } catch {
      // non-JSON error body — keep undefined detail
    }
    const error = new ApiError(
      detail ?? `Request failed (${response.status})`,
      response.status,
      detail,
    )
    throw error
  }

  return (await response.json()) as T
}

export interface UserOut {
  id: number
  email: string
  full_name: string
  role: "patient" | "health_worker" | "doctor" | "admin" | "ophthalmologist"
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: UserOut
}

export interface FindingOut {
  image_id: string
  lesion_list: string | { type: string; count: number }[]
  lesion_count: number
  icdr_grade: number | null
  icdr_confidence: number | null
  consistency_status: string
  analysis_status: string
  analyzed_at: string | null
  model_provenance?: string | null
}

export interface UploadOut {
  image_id: string
  patient_id: number
  filename: string
  quality_status: string
  quality_score: number | null
  retake_count?: number
  uploaded_at: string
  findings: FindingOut[]
}

export interface PatientOut {
  id: number
  full_name: string
  age: number | null
  gender: string | null
  village: string | null
  district: string | null
  phone: string | null
  created_at: string
}

export interface RoleStats {
  total_patients: number
  total_scans: number
  scans_analyzed: number
  scans_pending: number
  flagged_for_review: number
  grade_distribution: Record<string, number>
}

export interface ReviewQueueItem {
  image_id: string
  patient_name: string
  patient_id: number | null
  icdr_grade: number | null
  icdr_confidence: number | null
  lesion_count: number | null
  lesion_list: string | null
  consistency_status: string
  analysis_status: string
  analyzed_at: string | null
  model_provenance?: string | null
}

export interface ModelInfo {
  name: string
  family: string
  task: string
  trained_on: string
  fine_tuned: boolean
  weights: boolean
  weights_path: string
  validation: Record<string, unknown>
  note: string
}

export interface LesionSummaryItem {
  type: string
  count: number
  avg_confidence: number | null
}

export interface StructuredFindings {
  icdr_grade: number | null
  icdr_grade_label: string
  lesion_summary: LesionSummaryItem[]
  total_lesion_count: number
  consistency_status: string
  flagged_reason: string | null
  model_version: string | null
}

export interface ScreeningReport {
  image_id: string
  report_text: string
  structured_findings: StructuredFindings
  region_notes: string | null
  gradcam_path: string | null
  generation_method: "template" | "llm"
  model_version: string | null
  generated_at: string | null
}

export interface DoctorQueueItem {
  image_id: string
  patient_id: number
  patient_name: string
  icdr_grade: number | null
  icdr_confidence: number | null
  consistency_status: string
  sync_status: "queued" | "syncing" | "synced" | "failed"
  viewed: boolean
  signed_off: boolean
  signed_decision: "Approved" | "Revised" | "Rejected" | null
  analyzed_at: string | null
}

export interface DoctorQueueCount {
  unseen: number
  unseen_flagged: number
}

export interface SignOffInput {
  image_id: string
  decision: "Approved" | "Revised" | "Rejected"
  doctor_notes?: string
  revised_grade?: number | null
}

export interface SignOffResult {
  image_id: string
  decision: string
  doctor_notes: string | null
  revised_grade: number | null
  signed_at: string
  summary_languages: string[]
}

export interface SyncStatus {
  pending: number
  syncing: number
  synced: number
  failed: number
  total: number
  offline_sim: boolean
}

export type PatientScanState =
  | "scan_received"
  | "analysis_in_progress"
  | "awaiting_review"
  | "reviewed"

export interface PatientStatus {
  image_id: string
  state: PatientScanState
  stage_label: string
  patient_text: string
  summary_languages: string[]
  signed_off: boolean
  signed_decision: string | null
  revised_grade: number | null
}

export interface PatientSummary {
  language: string
  summary_text: string
  has_audio: boolean
  content_version?: string
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: (token: string) => apiFetch<UserOut>("/auth/me", {}, token),
}

export const patientsApi = {
  self: (token: string) => apiFetch<PatientOut>("/patients/self", {}, token),
  list: (token: string) => apiFetch<PatientOut[]>("/patients", {}, token),
  create: (token: string, patient: Record<string, unknown>) =>
    apiFetch<PatientOut>("/patients", {
      method: "POST",
      body: JSON.stringify(patient),
    }, token),
  scans: (token: string, patientId: number) =>
    apiFetch<UploadOut[]>(`/patients/${patientId}/scans`, {}, token),
}

export const uploadsApi = {
  create: (token: string, patientId: number, file: File) => {
    const form = new FormData()
    form.append("patient_id", String(patientId))
    form.append("file", file)
    return apiFetch<UploadOut>("/uploads", { method: "POST", body: form }, token)
  },
  get: (token: string, imageId: string) =>
    apiFetch<UploadOut>(`/uploads/${imageId}`, {}, token),
  analyze: (token: string, imageId: string) =>
    apiFetch<FindingOut>(`/analyze/${imageId}`, { method: "POST" }, token),
}

export const dashboardApi = {
  stats: (token: string) => apiFetch<RoleStats>("/stats", {}, token),
  reviewQueue: (token: string) =>
    apiFetch<ReviewQueueItem[]>("/review-queue", {}, token),
  models: (token: string) => apiFetch<ModelInfo[]>("/models", {}, token),
}

export const reportsApi = {
  get: (token: string, imageId: string) =>
    apiFetch<ScreeningReport>(`/reports/${imageId}`, {}, token),
  gradcamUrl: (imageId: string) =>
    `${API_BASE_URL}/reports/${imageId}/gradcam`,
}

export const telemedApi = {
  queue: (token: string) =>
    apiFetch<DoctorQueueItem[]>("/doctor/queue", {}, token),
  queueCount: (token: string) =>
    apiFetch<DoctorQueueCount>("/doctor/queue/count", {}, token),
  markSeen: (token: string, imageId: string) =>
    apiFetch<{ image_id: string; viewed: boolean }>(
      `/doctor/queue/${imageId}/seen`,
      { method: "POST" },
      token,
    ),
  signOff: (token: string, input: SignOffInput) =>
    apiFetch<SignOffResult>("/doctor/signoffs", {
      method: "POST",
      body: JSON.stringify(input),
    }, token),
  syncStatus: (token: string) =>
    apiFetch<SyncStatus>("/sync/status", {}, token),
  setOfflineSim: (token: string, enabled: boolean) =>
    apiFetch<SyncStatus>("/sync/offline-sim", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }, token),
  scanStatus: (token: string, imageId: string) =>
    apiFetch<PatientStatus>(`/reports/${imageId}/status`, {}, token),
  summaries: (token: string, imageId: string) =>
    apiFetch<PatientSummary[]>(`/summaries/${imageId}`, {}, token),
}

export function summaryAudioUrl(
  imageId: string,
  language: string,
  contentVersion?: string,
): string {
  const base = `${API_BASE_URL}/summaries/${imageId}/${language}/audio`
  return contentVersion ? `${base}?v=${encodeURIComponent(contentVersion)}` : base
}

export async function fetchSummaryAudioUrl(
  imageId: string,
  language: string,
  token: string,
  contentVersion?: string,
): Promise<string> {
  const response = await fetch(summaryAudioUrl(imageId, language, contentVersion), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`No audio clip (${response.status})`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

/**
 * Fetches the stored Grad-CAM heatmap as a blob and returns an object URL.
 * The served endpoint is bearer-auth protected, so it cannot be <img>-tagged
 * directly without a token.
 */
export async function fetchGradcamBlobUrl(
  imageId: string,
  token: string,
): Promise<string | null> {
  const response = await fetch(reportsApi.gradcamUrl(imageId), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export function scanImageUrl(imageId: string): string {
  return `${API_BASE_URL}/uploads/${imageId}/image`
}

/**
 * Fetches a stored scan as a blob and returns an object URL. Must be called
 * from the browser because it authenticates with the session bearer token,
 * which an <img src> request cannot supply.
 */
export async function fetchScanBlobUrl(
  imageId: string,
  token: string,
): Promise<string> {
  const response = await fetch(scanImageUrl(imageId), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Unable to load scan image (${response.status})`)
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}