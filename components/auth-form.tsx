"use client";
import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
type Field={name:string;label:string;type?:string;autoComplete?:string;placeholder:string;optional?:boolean;maxLength?:number};
export function AuthForm({action,fields,submitLabel,pendingLabel,alternateText,alternateHref,alternateLabel}:{action:(state:AuthState,formData:FormData)=>Promise<AuthState>;fields:Field[];submitLabel:string;pendingLabel:string;alternateText:string;alternateHref:string;alternateLabel:string}){
  const[state,formAction,pending]=useActionState(action,undefined);
  return <form action={formAction} className="auth-form">
    {state?.error&&<div className="form-alert" role="alert">{state.error}</div>}
    {fields.map(field=><div className="field" key={field.name}><label htmlFor={field.name}>{field.label}</label><input id={field.name} name={field.name} type={field.type??"text"} autoComplete={field.autoComplete} placeholder={field.placeholder} maxLength={field.maxLength} required={!field.optional}/>{state?.fieldErrors?.[field.name]?.map(error=><p className="field-error" key={error}>{error}</p>)}</div>)}
    <button className="primary-button" disabled={pending} type="submit">{pending?pendingLabel:submitLabel}</button>
    <p className="alternate-copy">{alternateText} <Link href={alternateHref}>{alternateLabel}</Link></p>
  </form>;
}
