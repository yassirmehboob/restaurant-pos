import { getCurrentUser } from "@/data/auth";
import { mediaResponse } from "@/lib/signage-server";

// The owner's preview and video list use the signed-in session instead of a display key.
export async function GET(request: Request, context: RouteContext<"/api/signage/media/[kind]/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "OWNER") return new Response("Forbidden", { status: 403 });
  const { kind, id } = await context.params;
  return mediaResponse(request, user.businessId, kind, id, "private, no-store");
}
