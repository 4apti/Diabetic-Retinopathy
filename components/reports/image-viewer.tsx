"use client"

/**
 * Shared in-tab fundus / heatmap viewer (Phase-4-A fix).
 *
 * Used everywhere a scan image is shown: the patient dashboard, the doctor
 * case detail, the review queue and the ASHA worker dashboard. The thumbnail
 * opens a lightbox that supports wheel / pinch zoom, click-and-drag pan (via
 * react-zoom-pan-pinch) and, when a Grad-CAM heatmap exists for the scan, a
 * Fundus / Heatmap toggle so the reviewer can compare the two views side by
 * side in the same window instead of switching tabs.
 */

import * as React from "react"
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
  useControls,
} from "react-zoom-pan-pinch"

import { Spinner } from "@/components/ui/spinner"
import { fetchGradcamBlobUrl, fetchScanBlobUrl } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "cn"

function LightboxControls({
  mode,
  hasHeatmap,
  onModeChange,
  onClose,
}: {
  mode: "scan" | "heatmap"
  hasHeatmap: boolean
  onModeChange: (mode: "scan" | "heatmap") => void
  onClose: () => void
}) {
  const { zoomIn, zoomOut, resetTransform } = useControls()

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        {hasHeatmap && (
          <div className="flex items-center rounded-md bg-white/10 p-0.5">
            <button
              type="button"
              onClick={() => onModeChange("scan")}
              className={cn(
                "rounded px-3 py-1 text-xs font-semibold transition-colors",
                mode === "scan" ? "bg-white text-black" : "text-white/80 hover:text-white",
              )}
            >
              Fundus
            </button>
            <button
              type="button"
              onClick={() => onModeChange("heatmap")}
              className={cn(
                "rounded px-3 py-1 text-xs font-semibold transition-colors",
                mode === "heatmap" ? "bg-white text-black" : "text-white/80 hover:text-white",
              )}
            >
              Heatmap
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => zoomIn()}
          aria-label="Zoom in"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomOut()}
          aria-label="Zoom out"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => resetTransform()}
          aria-label="Reset zoom"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Minimize2 className="size-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close viewer"
        className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function ScanImageViewer({
  imageId,
  token,
  className,
  thumbnailClassName,
  showHeatmap = true,
  label = "Retina scan",
}: {
  imageId: string
  token: string
  className?: string
  thumbnailClassName?: string
  showHeatmap?: boolean
  label?: string
}) {
  const [scanUrl, setScanUrl] = React.useState<string | null>(null)
  const [heatmapUrl, setHeatmapUrl] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"scan" | "heatmap">("scan")
  const wrapperRef = React.useRef<ReactZoomPanPinchRef | null>(null)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    fetchScanBlobUrl(imageId, token)
      .then((url) => {
        if (active) setScanUrl(url)
      })
      .catch(() => {
        if (active) setScanUrl(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    if (showHeatmap) {
      fetchGradcamBlobUrl(imageId, token)
        .then((url) => {
          if (active) setHeatmapUrl(url)
        })
        .catch(() => {
          if (active) setHeatmapUrl(null)
        })
    }
    return () => {
      active = false
    }
  }, [imageId, token, showHeatmap])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const activeUrl = mode === "heatmap" && heatmapUrl ? heatmapUrl : scanUrl
  const hasHeatmap = showHeatmap && heatmapUrl !== null

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Spinner size="sm" /> Loading image…
      </div>
    )
  }

  if (!scanUrl) return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMode("scan")
          setOpen(true)
        }}
        aria-label={`Open ${label} viewer`}
        className={cn(
          "relative block w-full cursor-zoom-in overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL */}
        <img
          src={scanUrl}
          alt={`${label} — click to zoom`}
          className={cn("max-h-64 w-full rounded-lg object-cover", thumbnailClassName)}
        />
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          <Maximize2 className="size-3" /> Zoom
        </span>
        {hasHeatmap && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
            Fundus / Heatmap
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${label} viewer`}
          className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <TransformWrapper
            ref={wrapperRef}
            initialScale={1}
            minScale={0.5}
            maxScale={8}
            wheel={{ step: 0.18 }}
            doubleClick={{ mode: "toggle" }}
            limitToBounds
          >
            <div className="flex h-full flex-col gap-3 p-4">
              <LightboxControls
                mode={mode}
                hasHeatmap={hasHeatmap}
                onModeChange={(next) => setMode(next)}
                onClose={() => setOpen(false)}
              />
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                {activeUrl ? (
                  <TransformComponent
                    wrapperClass="h-full w-full flex items-center justify-center"
                    contentClass="!transform-origin-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob URL */}
                    <img
                      src={activeUrl}
                      alt={`${label} — ${mode === "heatmap" ? "Grad-CAM heatmap" : "scan"}`}
                      className="max-h-full max-w-full rounded-lg bg-black shadow-xl"
                      draggable={false}
                    />
                  </TransformComponent>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <Spinner size="sm" /> Loading…
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge tone="accent" className="capitalize">
                  {mode === "heatmap" ? "Grad-CAM heatmap" : label}
                </Badge>
                <Badge tone="success">Scroll / pinch to zoom · drag to pan</Badge>
                <Badge tone="destructive">Press Esc to close</Badge>
              </div>
            </div>
          </TransformWrapper>
        </div>
      )}
    </>
  )
}