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
import "./receipts.css";
import "./payments.css";
import "./reports.css";
import "./sidebar.css";
import "./expenses.css";
import "./receipt-updates.css";
import "./order-status-updates.css";
import "./orders-date.css";
import "./image-guidance.css";
import "./image-preview.css";

export const metadata: Metadata = {
  title: { default: "Restaurant POS", template: "%s | Restaurant POS" },
  description: "A secure, touch-friendly restaurant point of sale.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
