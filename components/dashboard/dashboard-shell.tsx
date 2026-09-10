"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LayoutDashboard, LogOut, ScanEye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/session"
import { cn } from "cn"

const roleLabel: Record<string, string> = {
  patient: "Patient",
  health_worker: "Health Worker",
  doctor: "Doctor",
  admin: "Administrator",
}

interface DashboardShellProps {
  children: React.ReactNode
  title: string
  description?: string
  sidebar?: boolean
}

export function DashboardShell({
  children,
  title,
  description,
  sidebar = true,
}: DashboardShellProps) {
  const { user, signOut } = useSession()
  const router = useRouter()

  const navItems = (() => {
    if (!user) return []
    switch (user.role) {
      case "patient":
        return [{ label: "My scans", href: "/dashboard/patient" }]
      case "health_worker":
        return [{ label: "Patients & scans", href: "/dashboard/worker" }]
      case "doctor":
        return [{ label: "Review queue", href: "/dashboard/doctor" }]
      case "admin":
        return [
          { label: "Overview", href: "/admin" },
          { label: "Model info", href: "/admin/models" },
        ]
      default:
        return []
    }
  })()

  function handleSignOut() {
    signOut()
    router.push("/login")
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <ScanEye className="size-5 text-primary" aria-hidden />
            <Link
              href="/"
              className="font-heading text-base font-bold tracking-tight"
            >
              NetraScan
            </Link>
            <span className="ml-1 hidden rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground sm:inline-block">
              {user ? roleLabel[user.role] ?? user.role : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-sm text-muted-foreground md:inline-block">
                {user.full_name}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        {sidebar && navItems.length > 0 && (
          <nav
            aria-label="Dashboard"
            className="flex shrink-0 gap-1 md:w-56 md:flex-col"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <LayoutDashboard className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <main className="min-w-0 flex-1">
          <div className="mb-6 flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}