import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "@/app/(auth)/actions";
import { getCurrentUser } from "@/data/auth";
export default async function LoginPage(){if(await getCurrentUser())redirect("/dashboard");return <div className="auth-card"><p className="eyebrow">Welcome back</p><h2>Sign in to continue</h2><p className="muted">Use your owner or staff account.</p><AuthForm action={loginAction} submitLabel="Sign In" pendingLabel="Signing In..." alternateText="New restaurant?" alternateHref="/signup" alternateLabel="Create an account" fields={[{name:"username",label:"Username",autoComplete:"username",placeholder:"restaurant.owner"},{name:"password",label:"Password",type:"password",autoComplete:"current-password",placeholder:"Enter your password"}]}/></div>}
