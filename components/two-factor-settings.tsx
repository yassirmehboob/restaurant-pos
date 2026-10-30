"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import { Check, Copy, Download, KeyRound, LockKeyhole, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor } from "@/app/(dashboard)/security/actions";

type Account = { fullName: string; username: string; role: string };

export function TwoFactorSettings({ enabled, account }: { enabled: boolean; account: Account }) {
  const [password, setPassword] = useState(""), [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; accountName: string; qrCodeDataUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
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
  const copyCodes = async () => { try { await navigator.clipboard.writeText(recoveryCodes.join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setError("Copy is blocked here. Select the codes and copy them manually."); } };
  const downloadCodes = () => {
    const file = new Blob([`Restaurant POS recovery codes for ${account.username}\nEach code works once.\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(file); link.download = `restaurant-pos-recovery-codes-${account.username}.txt`; link.click(); URL.revokeObjectURL(link.href);
  };

  const step = enabled ? 0 : setup ? 2 : 1;
  const status = <section className={`security-hero ${enabled || recoveryCodes.length ? "is-on" : "is-off"}`}>
    <span className="security-hero-icon" aria-hidden="true">{enabled || recoveryCodes.length ? <ShieldCheck size={30}/> : <ShieldAlert size={30}/>}</span>
    <div className="security-hero-text">
      <span className="security-pill">{enabled || recoveryCodes.length ? "Protected" : "Not protected"}</span>
      <h1>Security · Two-factor authentication</h1>
      <p>{enabled || recoveryCodes.length ? "Your login asks for a code from your phone, so a stolen password alone cannot open your account." : "Add a code from your phone to your login. Even if someone learns your password, they cannot sign in without your phone."}</p>
    </div>
    <div className="security-account"><span className="security-avatar">{account.fullName.charAt(0).toUpperCase()}</span><div><strong>{account.fullName}</strong><small>{account.role} · {account.username}</small></div></div>
  </section>;

  if (recoveryCodes.length) return <div className="security-layout">{status}
    <section className="security-card security-recovery">
      <header><span><KeyRound size={20}/></span><div><h3>Save your recovery codes</h3><p>If you lose your phone, each code lets you sign in once. They will not be shown again.</p></div></header>
      <ol className="security-codes">{recoveryCodes.map(value => <li key={value}><code>{value}</code></li>)}</ol>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="security-actions">
        <button className="security-secondary" type="button" onClick={copyCodes}>{copied ? <Check size={17}/> : <Copy size={17}/>}{copied ? "Copied" : "Copy all"}</button>
        <button className="security-secondary" type="button" onClick={downloadCodes}><Download size={17}/>Download .txt</button>
        <button className="security-primary" type="button" onClick={() => window.location.reload()}><Check size={17}/>I have saved my codes</button>
      </div>
    </section>
  </div>;

  return <div className="security-layout">{status}
    <div className="security-grid">
      <section className="security-card">
        <header><span><LockKeyhole size={20}/></span><div><h3>{enabled ? "Turn off two-factor authentication" : "Set up in 3 steps"}</h3><p>{enabled ? "Confirm it is you with your password and a code from your app or a recovery code." : "Takes about a minute. This setting applies only to your account."}</p></div></header>
        {!enabled && <ol className="security-steps" aria-label="Setup progress">
          {["Confirm password", "Scan QR code", "Enter code"].map((label, index) => <li key={label} className={index + 1 < step ? "is-done" : index + 1 === step || (step === 2 && index === 2) ? "is-current" : ""}><span>{index + 1 < step ? <Check size={14}/> : index + 1}</span>{label}</li>)}
        </ol>}
        <form className="security-form" onSubmit={submit}>
          {setup && <div className="security-qr">
            <div className="security-qr-image"><Image src={setup.qrCodeDataUrl} alt="Scan this QR code to add your Restaurant POS account to your authenticator app" width={200} height={200} unoptimized/></div>
            <div className="security-qr-text">
              <h4>Scan with your authenticator app</h4>
              <p>In the app, tap <strong>+</strong> or <strong>Add account</strong>, then scan this code. The QR code expires in 10 minutes.</p>
              <p className="security-qr-account">Account: <strong>{setup.accountName}</strong></p>
              <details><summary>Cannot scan? Enter the key manually</summary><p>Choose a time-based key in your app and type:</p><code>{setup.secret}</code></details>
            </div>
          </div>}
          <div className="security-fields"><label className="field">Current password<input type="password" autoComplete="current-password" required minLength={8} maxLength={72} value={password} disabled={pending} placeholder="Your login password" onChange={event => setPassword(event.target.value)}/></label>
          {(setup || enabled) && <label className="field">{enabled ? "Authenticator or recovery code" : "6-digit code from the app"}<input className="security-code-input" autoComplete="one-time-code" inputMode={enabled ? "text" : "numeric"} required maxLength={64} value={code} disabled={pending} placeholder={enabled ? "123456 or recovery code" : "123456"} onChange={event => setCode(event.target.value)}/></label>}</div>
          {error && <p className="form-alert" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
          <div className="security-actions">
            <button type="submit" className={enabled ? "security-danger" : "security-primary"} disabled={pending}>{pending ? "Saving..." : enabled ? "Disable 2FA" : setup ? "Verify and enable 2FA" : "Continue"}</button>
            {setup && <button className="security-secondary" type="button" disabled={pending} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Start over</button>}
          </div>
        </form>
      </section>

      <aside className="security-card security-help">
        <header><span><Smartphone size={20}/></span><div><h3>Authenticator apps</h3><p>Free on Android and iPhone.</p></div></header>
        <ul className="security-apps"><li>Google Authenticator</li><li>Microsoft Authenticator</li><li>Authy</li></ul>
        <h4>Good to know</h4>
        <ul className="security-tips">
          <li>Codes change every 30 seconds and work without internet.</li>
          <li>Keep your recovery codes somewhere safe, away from your phone.</li>
          <li>New phone? Turn 2FA off, then set it up again on the new phone.</li>
        </ul>
      </aside>
    </div>
  </div>;
}
