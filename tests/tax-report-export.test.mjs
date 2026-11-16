import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { taxExcelReport, taxPdfReport } from "../lib/tax-report-export.ts";

function report(count) {
  return {
    range: {fromText:"2026-11-01",toText:"2026-11-16"},
    orders: Array.from({length:count}, (_, index)=>({orderNumber:`INV-${index}`,saleDate:"2026-11-16",orderType:"DINE_IN",paymentMethods:["CASH","CARD"],taxAmount:15.25,grandTotal:115.25})),
    totals: {orders:count,tax:15.25*count,sales:115.25*count},
  };
}

test("Excel exports numeric amounts, selected dates, totals and split payment methods", async()=>{
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await taxExcelReport(report(2), "Test Restaurant"));
  const sheet = workbook.getWorksheet("Tax collection"), summary = workbook.getWorksheet("Summary");
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("D2").value, "CASH + CARD");
  assert.equal(sheet.getCell("E2").value, 15.25);
  assert.equal(sheet.getCell("F2").value, 115.25);
  assert.equal(summary.getCell("B2").value, "2026-11-01");
  assert.equal(summary.getCell("B5").value, 30.5);
});

test("PDF exports open successfully and paginate long reports", async()=>{
  const bytes = await taxPdfReport(report(70), "Test Restaurant");
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>1);
  for(const page of pdf.getPages()) assert.equal(page.getWidth(),842);
});

test("empty reports export valid Excel and PDF files", async()=>{
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await taxExcelReport(report(0), "Test Restaurant"));
  assert.equal(workbook.getWorksheet("Tax collection").rowCount,1);
  const pdf = await PDFDocument.load(await taxPdfReport(report(0), "Test Restaurant"));
  assert.equal(pdf.getPageCount(),1);
});
