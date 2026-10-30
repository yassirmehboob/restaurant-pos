import { redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { SignageManager } from "@/components/signage-manager";
import { loadSignage } from "./actions";

export default async function SignagePage() {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/access-denied");
  return <SignageManager data={await loadSignage()} />;
}
