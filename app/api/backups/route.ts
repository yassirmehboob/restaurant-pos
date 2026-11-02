import { getCurrentUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { COUNTER_ROLES } from "@/lib/roles";
import { loadBackupSettings } from "@/app/(dashboard)/settings/backups/actions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (!COUNTER_ROLES.includes(user.role) || !can(user, "backups")) return Response.json({ message: "Access denied." }, { status: 403 });
  return Response.json(await loadBackupSettings(), { headers: { "Cache-Control": "private, no-store" } });
}
