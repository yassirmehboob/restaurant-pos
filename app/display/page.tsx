import type { Metadata } from "next";
import { DisplayPairing } from "@/components/display-pairing";

export const metadata: Metadata = { title: "Display", robots: { index: false, follow: false } };

export default function DisplayPage() {
  return <DisplayPairing />;
}
