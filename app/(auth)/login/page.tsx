import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/app/(auth)/actions";
import { getCurrentUser } from "@/data/auth";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="auth-card">
      <div className="auth-heading-icon"><LogIn size={23} aria-hidden="true" /></div>
      <p className="eyebrow">YOUR RESTAURANT WORKSPACE</p>
      <h2>Welcome back.</h2>
      <p className="muted">Sign in to get ready for your next great service.</p>
      <AuthForm action={loginAction} submitLabel="Sign in to your workspace" pendingLabel="Signing in..." fields={[
        { name: "username", label: "Username", autoComplete: "username", placeholder: "Enter your username" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password", placeholder: "Enter your password" },
      ]} />
    </div>
  );
}
