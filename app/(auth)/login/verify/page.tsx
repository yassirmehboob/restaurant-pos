import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { verifyLoginAction } from "@/app/(auth)/actions";
import { readLoginChallenge } from "@/lib/auth/login-challenge";
import { getCurrentUser } from "@/data/auth";

export default async function VerifyLoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (!(await readLoginChallenge())) redirect("/login");

  return (
    <div className="auth-card">
      <div className="auth-heading-icon"><ShieldCheck size={23} aria-hidden="true" /></div>
      <p className="eyebrow">STEP 2 OF 2</p>
      <h2>Verify it’s you.</h2>
      <p className="muted">Your password is verified. Enter the code from your authenticator app or use a recovery code to finish signing in.</p>
      <AuthForm action={verifyLoginAction} submitLabel="Verify and sign in" pendingLabel="Verifying..." alternateText="Use a different account?" alternateHref="/login" alternateLabel="Back to sign in" fields={[
        { name: "twoFactorCode", label: "Authenticator or recovery code", autoComplete: "one-time-code", placeholder: "Enter your code", maxLength: 64 },
      ]} />
    </div>
  );
}
