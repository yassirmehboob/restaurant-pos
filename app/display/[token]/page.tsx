import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DisplayDevice } from "@/components/display-device";

export const metadata: Metadata = { title: "Display", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function DisplayDevicePage({ params }: PageProps<"/display/[token]">) {
  const { token } = await params;
  if (!/^[\w-]{43}$/.test(token)) redirect("/display");
  return <DisplayDevice token={token} />;
}
