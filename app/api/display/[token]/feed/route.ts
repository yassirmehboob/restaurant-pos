import { buildFeed, screenByToken } from "@/lib/signage-server";

export async function GET(_request: Request, context: RouteContext<"/api/display/[token]/feed">) {
  const { token } = await context.params;
  const screen = await screenByToken(token);
  // 401 tells the TV its key was revoked, so it returns to the pairing screen.
  if (!screen) return Response.json({ message: "This display is not connected." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const feed = await buildFeed(screen, (kind, id) => `/api/display/${token}/media/${kind}/${id}`);
    return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ message: "Display content is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
