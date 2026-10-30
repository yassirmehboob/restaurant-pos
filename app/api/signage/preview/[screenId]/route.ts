import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { buildFeed } from "@/lib/signage-server";
import { SignageScreen } from "@/models/SignageScreen";

export async function GET(_request: Request, context: RouteContext<"/api/signage/preview/[screenId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (user.role !== "OWNER") return Response.json({ message: "Only the owner can preview displays." }, { status: 403 });
  const { screenId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(screenId)) return Response.json({ message: "Screen not found." }, { status: 404 });
  await connectToDatabase();
  const screen = await SignageScreen.findOne({ _id: screenId, businessId: user.businessId }).lean();
  if (!screen) return Response.json({ message: "Screen not found." }, { status: 404 });
  return Response.json(await buildFeed(screen, (kind, id) => `/api/signage/media/${kind}/${id}`), { headers: { "Cache-Control": "no-store" } });
}
