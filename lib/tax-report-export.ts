import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { buildTaxReport } from "@/lib/tax-report";
import { formatDate, formatDateTime } from "@/lib/dates";

type TaxReport = Awaited<ReturnType<typeof buildTaxReport>>;
const headers = ["Invoice", "Sale date", "Order type", "Payment method", "Tax collected (Rs)", "Invoice total (Rs)"];
export function taxExportRows(report: TaxReport) {
  return report.orders.map(order => [
    String(order.orderNumber ?? ""), order.saleDate ? formatDate(order.saleDate) : formatDateTime(order.completedAt ?? order.createdAt),
    order.orderType.replaceAll("_", " "), order.paymentMethods.join(" + ") || "Not recorded", order.taxAmount, order.grandTotal,
  ]);
}

export async function taxExcelReport(report: TaxReport, businessName: string) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 32 }, { width: 45 }];
  summary.addRows([["Tax Collection Report", businessName], ["From", report.range.fromText], ["To", report.range.toText],
    ["Paid invoices with tax", report.totals.orders], ["Total tax collected (Rs)", report.totals.tax], ["Invoice totals (Rs)", report.totals.sales]]);
  summary.getRow(1).font = { bold: true };
  for (const row of [5, 6]) summary.getCell(row, 2).numFmt = "#,##0.00";
  const sheet = workbook.addWorksheet("Tax collection", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = headers.map((header, index) => ({ header, width: [26, 26, 18, 24, 24, 24][index] }));
  sheet.addRows(taxExportRows(report));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  for (const column of [5, 6]) sheet.getColumn(column).numFmt = "#,##0.00";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function taxPdfReport(report: TaxReport, businessName: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Built-in PDF fonts support Latin text; replace unsupported glyphs without breaking the download.
  const safe = (value: string) => [...value].map(char => { try { font.encodeText(char); return char; } catch { return "?"; } }).join("");
  const fit = (value: string, width: number) => {
    let text = safe(value);
    if (font.widthOfTextAtSize(text, 9) <= width) return text;
    while (text && font.widthOfTextAtSize(text + "...", 9) > width) text = text.slice(0, -1);
    return text + "...";
  };
  const widths = [135, 145, 95, 125, 125, 145], margin = 36;
  let page = pdf.addPage([842, 595]), y = 0;
  const draw = (value: string, x: number, position: number, size = 10, heavy = false) => page.drawText(safe(value), { x, y: position, size, font: heavy ? bold : font });
  const startPage = () => {
    draw("Tax Collection Report", margin, 555, 18, true);
    draw(fit(businessName, 600), margin, 534);
    draw(`${report.range.fromText} to ${report.range.toText} | Paid invoices with tax: ${report.totals.orders}`, margin, 514);
    draw(`Total tax: Rs ${report.totals.tax.toFixed(2)} | Invoice totals: Rs ${report.totals.sales.toFixed(2)}`, margin, 494, 10, true);
    y = 466;
    let x = margin;
    for (let i = 0; i < headers.length; i++) { draw(headers[i], x, y, 9, true); x += widths[i]; }
    y -= 22;
  };
  startPage();
  const rows = taxExportRows(report);
  if (!rows.length) draw("No paid invoices with tax collected for these dates.", margin, y);
  for (const row of rows) {
    if (y < 55) { page = pdf.addPage([842, 595]); startPage(); }
    let x = margin;
    row.forEach((value, index) => { draw(fit(typeof value === "number" ? value.toFixed(2) : value, widths[index] - 10), x, y, 9); x += widths[index]; });
    page.drawLine({ start: { x: margin, y: y - 7 }, end: { x: 806, y: y - 7 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
    y -= 24;
  }
  pdf.getPages().forEach((item, index) => item.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: margin, y: 24, size: 9, font }));
  return pdf.save();
}
