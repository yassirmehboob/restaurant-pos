import { requireUser } from "@/data/auth";
import { User } from "@/models/User";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import "@/app/security.css";
export default async function SecurityPage() {
  const user = await requireUser();
  const account = await User.findOne({ _id: user.id, businessId: user.businessId, isActive: true }).select("twoFactorEnabled").lean();
  return <main className="master-page security-page"><TwoFactorSettings enabled={Boolean(account?.twoFactorEnabled)} account={{ fullName: user.fullName, username: user.username, role: user.role }}/></main>;
}
