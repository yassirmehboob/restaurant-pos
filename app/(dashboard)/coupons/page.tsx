import { redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { CouponManager } from "@/components/coupon-manager";
import { loadCouponBatches } from "./actions";

export default async function CouponsPage() {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/access-denied");
  return <CouponManager batches={await loadCouponBatches()} />;
}
