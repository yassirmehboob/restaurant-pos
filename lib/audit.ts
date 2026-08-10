import "server-only";
import { headers } from "next/headers";
import { AuditLog } from "@/models/AuditLog";
type AuditInput = { businessId:string; userId:string; userName:string; action:string; entityType:string; entityId?:string; description:string; metadata?:Record<string,unknown> };
export async function writeAuditLog(input: AuditInput) {
  const requestHeaders = await headers();
  await AuditLog.create({ businessId:input.businessId, userId:input.userId, userNameSnapshot:input.userName,
    action:input.action, entityType:input.entityType, entityId:input.entityId, description:input.description,
    metadata:input.metadata, ipAddress:requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent:requestHeaders.get("user-agent") });
}
