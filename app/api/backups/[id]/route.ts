import { getCurrentUser } from "@/data/auth";
import { readBackupFile, validateBackupId } from "@/lib/backup-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (user.role !== "OWNER") return Response.json({ message: "Only the owner can download complete backups." }, { status: 403 });
  try {
    const { id } = await params;
    await validateBackupId(id);
    const bytes = await readBackupFile(user.businessId, id);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${id}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ message: "Backup is unavailable." }, { status: 404 }); }
}
