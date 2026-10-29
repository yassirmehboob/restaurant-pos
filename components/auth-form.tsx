"use client";

import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import type { AuthState } from "@/app/(auth)/actions";

type Field = { name: string; label: string; type?: string; autoComplete?: string; placeholder: string; optional?: boolean; maxLength?: number };

export function AuthForm({ action, fields, submitLabel, pendingLabel, alternateText, alternateHref, alternateLabel }: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  pendingLabel: string;
  alternateText?: string;
  alternateHref?: string;
  alternateLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="auth-form" aria-busy={pending}>
      {state?.error && <div className="form-alert" role="alert">{state.error}</div>}
      {fields.map(field => {
        const errors = state?.fieldErrors?.[field.name];
        const isPassword = field.type === "password";
        return (
          <div className="field" key={field.name}>
            <label htmlFor={field.name}>{field.label}</label>
            <div className={`auth-input-wrap${isPassword ? " has-password-toggle" : ""}`}>
              <input id={field.name} name={field.name} type={isPassword && showPassword ? "text" : field.type ?? "text"} autoComplete={field.autoComplete} placeholder={field.placeholder} maxLength={field.maxLength} required={!field.optional} aria-invalid={errors?.length ? true : undefined} aria-describedby={errors?.length ? `${field.name}-errors` : undefined} />
              {isPassword && <button type="button" className="auth-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>}
            </div>
            {errors?.length ? <div id={`${field.name}-errors`} role="alert">{errors.map(error => <p className="field-error" key={error}>{error}</p>)}</div> : null}
          </div>
        );
      })}
      <button className="primary-button" disabled={pending} type="submit">{pending ? pendingLabel : submitLabel}{pending ? <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button>
      {alternateHref && alternateLabel && <p className="alternate-copy">{alternateText} <Link href={alternateHref}>{alternateLabel}</Link></p>}
    </form>
  );
}
