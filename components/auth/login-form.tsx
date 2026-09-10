"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, EyeOff, HelpCircle, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { InputGroup } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"

export type LoginFormMode = "user" | "admin"
export type UserRole = "patient" | "worker" | "doctor"

const roleConfig: Record<
  UserRole,
  { label: string; buttonLabel: string; context: string }
> = {
  patient: {
    label: "Patient",
    buttonLabel: "Continue as Patient",
    context:
      "You'll use this portal to book and track your own eye-care visits and screenings.",
  },
  worker: {
    label: "Health Worker",
    buttonLabel: "Continue as Health Worker",
    context:
      "You'll run village screenings, add patient records, and send referrals for specialist review.",
  },
  doctor: {
    label: "Doctor",
    buttonLabel: "Continue as Doctor",
    context:
      "You'll review incoming screenings and support health workers with ophthalmologist guidance.",
  },
}

const roleOrder: UserRole[] = ["patient", "worker", "doctor"]
const roleLabel: Record<UserRole, string> = {
  patient: "Patient",
  worker: "Health Worker",
  doctor: "Doctor",
}

function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email is required."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return "Enter a valid email address."
  return null
}

function validatePassword(password: string): string | null {
  if (!password) return "Password is required."
  return null
}

interface LoginFormProps {
  mode: LoginFormMode
}

export function LoginForm({ mode }: LoginFormProps) {
  const isAdmin = mode === "admin"

  const [role, setRole] = React.useState<UserRole>("patient")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [errors, setErrors] = React.useState<{
    email?: string | null
    password?: string | null
  }>({})

  const [status, setStatus] = React.useState<
    "idle" | "submitting" | "submitted"
  >("idle")
  const [submitOpen, setSubmitOpen] = React.useState(false)
  const [forgotOpen, setForgotOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)

  const roleContext = roleConfig[role]

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    const nextErrors = { email: emailError, password: passwordError }

    setErrors(nextErrors)

    if (emailError || passwordError) {
      return
    }

    setStatus("submitting")
    window.setTimeout(() => {
      setStatus("submitted")
      setSubmitOpen(true)
    }, 900)
  }

  function handleSubmitDialogChange(open: boolean) {
    setSubmitOpen(open)
    if (!open) {
      setPassword("")
      setStatus("idle")
    }
  }

  const buttonLabel = isAdmin
    ? "Sign in to Administration"
    : roleConfig[role].buttonLabel

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Design preview notice */}
      <Alert variant="default" className="bg-secondary/40">
        <HelpCircle className="text-primary" />
        <AlertTitle>Design preview</AlertTitle>
        <AlertDescription>
          No data is submitted. Entering details here only demonstrates the
          interface.
        </AlertDescription>
      </Alert>

      {/* Admin access notice */}
      {isAdmin && (
        <Alert variant="default" className="bg-secondary/40">
          <KeyRound className="text-primary" />
          <AlertTitle>Protected space — in a future build</AlertTitle>
          <AlertDescription>
            This administration page is a design preview. No access control is
            implemented, so nothing here is protected or restricted.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {/* Role selection — user login only */}
        {!isAdmin && (
          <FieldGroup>
            <div className="flex flex-col gap-2">
              <span
                id="role-label"
                className="text-sm font-medium text-foreground"
              >
                I&apos;m signing in as
              </span>
              <ToggleGroup
                aria-labelledby="role-label"
                value={[role]}
                multiple={false}
                onValueChange={(value) => {
                  if (value.length > 0) {
                    setRole(value[0] as UserRole)
                  }
                }}
              >
                {roleOrder.map((r) => (
                  <ToggleGroupItem key={r} value={r}>
                    {roleLabel[r]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <p
              aria-live="polite"
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {roleContext.context}
            </p>
          </FieldGroup>
        )}

        {/* Email */}
        <Field>
          <FieldLabel htmlFor={isAdmin ? "admin-email" : "email"}>
            Email address
          </FieldLabel>
          <FieldContent>
            <InputGroup>
              <Input
                id={isAdmin ? "admin-email" : "email"}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.org"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (errors.email) {
                    setErrors((prev) => ({ ...prev, email: null }))
                  }
                }}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={
                  errors.email
                    ? isAdmin
                      ? "admin-email-error"
                      : "email-error"
                    : undefined
                }
              />
            </InputGroup>
            <FieldError id={isAdmin ? "admin-email-error" : "email-error"}>
              {errors.email}
            </FieldError>
          </FieldContent>
        </Field>

        {/* Password */}
        <Field>
          <div className="flex w-full items-center justify-between">
            <FieldLabel htmlFor={isAdmin ? "admin-password" : "password"}>
              Password
            </FieldLabel>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Forgot password?
            </button>
          </div>
          <FieldContent>
            <InputGroup>
              <Input
                id={isAdmin ? "admin-password" : "password"}
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errors.password) {
                    setErrors((prev) => ({ ...prev, password: null }))
                  }
                }}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password
                    ? isAdmin
                      ? "admin-password-error"
                      : "password-error"
                    : undefined
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mr-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </InputGroup>
            <FieldError id={isAdmin ? "admin-password-error" : "password-error"}>
              {errors.password}
            </FieldError>
          </FieldContent>
        </Field>

        {/* Submit */}
        <Button
          type="submit"
          size="lg"
          disabled={status === "submitting"}
          className="mt-1 w-full"
        >
          {status === "submitting" ? (
            <>
              <Spinner size="sm" />
              Signing in&hellip;
            </>
          ) : (
            buttonLabel
          )}
        </Button>

        {/* Live region for assistive technology */}
        <span id="login-status" className="sr-only" aria-live="polite">
          {status === "submitting"
            ? "Signing in…"
            : status === "submitted"
              ? "Preview complete. No account was authenticated. The password has been cleared."
              : errors.email || errors.password
                ? "Please fix the highlighted fields."
                : ""}
        </span>

        {/* Cross-navigation */}
        <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
          {isAdmin ? (
            <p>
              No public administrator sign-up exists. Prefer the{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                user login
              </Link>
              {"."}
            </p>
          ) : (
            <p>
              Are you an administrator?{" "}
              <Link
                href="/admin/login"
                className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Go to admin login
              </Link>
              {"."}
            </p>
          )}
        </div>
      </form>

      {/* Prototype help */}
      <div>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          About this prototype
        </button>
      </div>

      {/* Submission feedback dialog */}
      <Dialog open={submitOpen} onOpenChange={handleSubmitDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview sign-in</DialogTitle>
            <DialogDescription>
              {isAdmin ? (
                <>
                  You approached the <strong>Administrator</strong> portal.
                </>
              ) : (
                <>
                  You approached the <strong>{roleConfig[role].label}</strong>{" "}
                  portal.
                </>
              )}{" "}
              No account was authenticated and your password was not stored or
              sent anywhere. This prototype only demonstrates the interface.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Forgot password dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password recovery isn&apos;t connected</DialogTitle>
            <DialogDescription>
              This preview can&apos;t send reset emails, so no message was
              dispatched. In a full build you would receive a secure reset link
              at your registered email address.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Prototype help dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About this prototype</DialogTitle>
            <DialogDescription>
              These RetinaCare login screens are interactive frontend previews.
              They do not connect to a database, create accounts, send emails,
              authenticate anyone, or make medical assessments. Everything is
              held in component memory and disappears when the page reloads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}