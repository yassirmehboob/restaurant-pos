import { mediaResponse, screenByToken } from "@/lib/signage-server";

export async function GET(request: Request, context: RouteContext<"/api/display/[token]/media/[kind]/[id]">) {
  const { token, kind, id } = await context.params;
  const screen = await screenByToken(token);
  if (!screen) return new Response("Unauthorized", { status: 401 });
  // Media ids never change content, so the TV may keep them for a day and avoid re-downloading videos.
  return mediaResponse(request, String(screen.businessId), kind, id, "private, max-age=86400");
}
