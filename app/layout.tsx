import type { Metadata } from "next";
import "./globals.css";
import "./quick-edit.css";
import "./business-settings.css";

export const metadata: Metadata = {
  title: { default: "Restaurant POS", template: "%s | Restaurant POS" },
  description: "A secure, touch-friendly restaurant point of sale.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
