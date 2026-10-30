import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { SignagePlayer } from "@/components/signage-player";

export const metadata: Metadata = { title: "Display preview", robots: { index: false, follow: false } };

export default async function DisplayPreviewPage({ params }: PageProps<"/display/preview/[screenId]">) {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/access-denied");
  const { screenId } = await params;
  if (!/^[a-f\d]{24}$/i.test(screenId)) notFound();
  return <SignagePlayer feedUrl={`/api/signage/preview/${screenId}`} mode="preview" />;
}
