import { requireUser } from "@/data/auth";
import { User } from "@/models/User";
import { MasterHeader } from "@/components/master-shell";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import "@/app/security.css";
export default async function SecurityPage() {
  const user = await requireUser();
  const account = await User.findOne({ _id: user.id, businessId: user.businessId, isActive: true }).select("twoFactorEnabled").lean();
  return <main className="master-page"><MasterHeader eyebrow="Your account" title="Security" description="Protect your own login with an optional authenticator code."/><TwoFactorSettings enabled={Boolean(account?.twoFactorEnabled)}/></main>;
}
