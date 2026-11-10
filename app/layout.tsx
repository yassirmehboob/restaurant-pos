import type { Metadata } from "next";
import "./globals.css";
// Sindhi and Urdu on kitchen tickets (lib/receipt-fonts.ts LOCAL_FONT_CSS); bundled so printing works offline.
import "@fontsource/noto-naskh-arabic/arabic-400.css";
import "@fontsource/noto-naskh-arabic/arabic-700.css";
import "./audit.css";
import "./user-accounts.css";
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
import "./product-variants.css";
import "./weight-picker.css";
import "./discounts.css";
import "./category-price-reference.css";
import "./form-performance.css";
import "./kitchen.css";
import "./sale-sessions.css";
import "./pos-customers.css";
import "./date-picker.css";
import "./pos-review.css";
import "./waiter.css";
import "./sms-settings.css";
import "./sms-history.css";
import { NumberWheelGuard } from "@/components/number-wheel-guard";
import { appIconBusiness, logoImageId } from "@/lib/app-icon";

// The app icon is the business logo; its image id in the URL makes browsers fetch the new icon when the logo changes.
export async function generateMetadata(): Promise<Metadata> {
  const business = await appIconBusiness().catch(() => null);
  const v = logoImageId(business?.logoUrl) ?? "default";
  const icon = (size: number) => `/api/app-icon?size=${size}&v=${v}`;
  return {
    title: { default: "Restaurant POS", template: "%s | Restaurant POS" },
    description: "A secure, touch-friendly restaurant point of sale.",
    icons: {
      icon: [{ url: icon(32), sizes: "32x32", type: "image/png" }, { url: icon(192), sizes: "192x192", type: "image/png" }],
      apple: [{ url: icon(180), sizes: "180x180", type: "image/png" }],
    },
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body><NumberWheelGuard/>{children}</body>
    </html>
  );
}
