import type { Metadata } from "next";
import "./globals.css";
import "./quick-edit.css";
import "./business-settings.css";
import "./modern.css";
import "./modal-master.css";
import "./theme-v2.css";
import "./items.css";
import "./item-fullscreen.css";
import "./deals.css";
import "./form-controls.css";
import "./deal-components.css";
import "./customers.css";
import "./staff.css";
import "./tables.css";
import "./pos.css";
import "./pos-updates.css";
import "./orders.css";

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
