import { getCurrentUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { connectToDatabase } from "@/lib/db";
import { activeSaleSession } from "@/lib/sale-sessions";
import { businessDateQuery } from "@/lib/reporting";
import { buildTaxReport } from "@/lib/tax-report";
import { taxExcelReport, taxPdfReport } from "@/lib/tax-report-export";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ format: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "reports")) return new Response("Forbidden", { status: 403 });
  const { format } = await params;
  if (format !== "pdf" && format !== "xlsx") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  await connectToDatabase();
  const sale = await activeSaleSession(user);
  const report = await buildTaxReport(user.businessId, businessDateQuery({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  }, sale?.saleDate));
  const bytes = await (format === "pdf" ? taxPdfReport(report, user.businessName) : taxExcelReport(report, user.businessName));
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="tax-collection-${report.range.fromText}-to-${report.range.toText}.${format}"`,
    "Cache-Control": "no-store",
  } });
}
