import { csvCell } from "@/lib/csv";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { buildSalesReport } from "@/lib/reporting";

export async function GET(request:Request){const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401});if(!can(user,"reports"))return new Response("Forbidden",{status:403});const url=new URL(request.url);await connectToDatabase();const report=await buildSalesReport(user.businessId,{range:url.searchParams.get("range")??undefined,from:url.searchParams.get("from")??undefined,to:url.searchParams.get("to")??undefined});const rows=[["Order Number","Sale Date","Completed At","Type","Customer","Table","Waiter/Rider","Subtotal","Tax","Delivery","Grand Total","Payment Status"],...report.orders.map(order=>[order.orderNumber,order.saleDate?formatDate(order.saleDate):"",order.completedAt?formatDateTime(order.completedAt):"",order.orderType,order.customerSnapshot?.name??"",order.tableNameSnapshot??"",order.waiterNameSnapshot??"",order.subtotal,order.taxAmount,order.deliveryChargeAmount,order.grandTotal,order.paymentStatus])];const body="\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");return new Response(body,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="sales-${report.range.fromText}-to-${report.range.toText}.csv"`,"Cache-Control":"no-store"}})}
