"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor } from "@/app/(dashboard)/security/actions";
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const [password, setPassword] = useState(""), [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; accountName: string; qrCodeDataUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    startTransition(async () => {
      try {
        if (enabled) {
          const result = await disableTwoFactor(password, code);
          if (!result.ok) { setError(result.message); return; }
          setPassword(""); setCode(""); setMessage("Two-factor authentication disabled.");
        } else if (setup) {
          const result = await enableTwoFactor(password, code);
          if (!result.ok) { setError(result.message); return; }
          setRecoveryCodes(result.recoveryCodes); setSetup(null); setPassword(""); setCode("");
        } else {
          const result = await beginTwoFactorSetup(password);
          if (!result.ok) { setError(result.message); return; }
          setSetup({ secret: result.secret, accountName: result.accountName, qrCodeDataUrl: result.qrCodeDataUrl });
        }
      } catch { setError("Could not update security settings. Please refresh and try again."); }
    });
  };
  if (recoveryCodes.length) return <section className="master-form-card security-settings"><h2>Save your recovery codes</h2><p>2FA is enabled. Each code replaces an authenticator code once at login. Store these safely; they will not be shown again.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{recoveryCodes.join("\n")}</pre><div className="security-actions"><button className="security-primary" type="button" onClick={() => window.location.reload()}>I have saved my codes</button></div></section>;
  return <section className="master-form-card security-settings"><h2>Two-factor authentication: {enabled ? "Enabled" : "Disabled"}</h2>
    <p>{enabled ? "Enter your current password and an authenticator or recovery code to disable 2FA." : "Use an authenticator app such as Google Authenticator or Microsoft Authenticator. This setting applies only to your account."}</p>
    <form className="master-form" onSubmit={submit}>
      <label className="field">Current password<input type="password" autoComplete="current-password" required minLength={8} maxLength={128} value={password} disabled={pending} onChange={event => setPassword(event.target.value)}/></label>
      {setup && <div className="wide"><h3>Scan with your authenticator app</h3><p>Add an account in your authenticator app and scan this QR code. Then enter the 6-digit code below to enable 2FA. Setup expires after 10 minutes.</p><Image src={setup.qrCodeDataUrl} alt="Scan this QR code to add your Restaurant POS account to your authenticator app" width={256} height={256} unoptimized style={{ maxWidth: "100%", height: "auto", background: "white" }}/><p>Account: <strong>{setup.accountName}</strong></p><details><summary>Cannot scan? Enter the setup key manually</summary><p>Select a time-based key in your authenticator app.</p><p>Setup key: <code style={{ overflowWrap: "anywhere", userSelect: "all" }}>{setup.secret}</code></p></details></div>}
      {(setup || enabled) && <label className="field">{enabled ? "Authenticator or recovery code" : "6-digit authenticator code"}<input autoComplete="one-time-code" required maxLength={64} value={code} disabled={pending} onChange={event => setCode(event.target.value)}/></label>}
      {error && <p className="form-alert wide" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <div className="form-actions security-actions"><button type="submit" className="security-primary" disabled={pending}>{pending ? "Saving..." : enabled ? "Disable 2FA" : setup ? "Verify and enable 2FA" : "Set up 2FA"}</button>{setup && <button className="security-secondary" type="button" disabled={pending} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Start over</button>}</div>
    </form>
  </section>;
}
