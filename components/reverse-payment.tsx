"use client";
import { Undo2 } from "lucide-react";
import { useTransition } from "react";
import Swal from "sweetalert2";
import { reverseOrderPayment } from "@/app/(dashboard)/payments/reversal-actions";
import { useCan } from "@/components/permission-provider";
import { PAYMENT_REVERSAL_REASONS, reasonChips } from "@/lib/reason-chips";

export function ReversePayment({ orderId, orderNumber, amount }: { orderId: string; orderNumber: string; amount: number }) {
  const can = useCan(), [pending, start] = useTransition();
  if (!can("reverse_payments")) return null;
  const reverse = async () => {
    const result = await Swal.fire({
      title: `Reverse payment on ${orderNumber}?`,
      text: `Use this when the Rs ${amount.toLocaleString("en-PK", { maximumFractionDigits: 2 })} payment was recorded by mistake. The order goes back to unpaid, so it can be collected properly or cancelled.`,
      icon: "warning", input: "textarea", inputLabel: "Reason for reversal", inputPlaceholder: "Tap a reason or type your own...", didOpen: reasonChips(PAYMENT_REVERSAL_REASONS),
      inputAttributes: { maxlength: "500" },
      inputValidator: value => value.trim().length < 3 ? "Enter a reason for the reversal." : undefined,
      showCancelButton: true, confirmButtonText: "Reverse payment", confirmButtonColor: "#dc2626", cancelButtonText: "Keep payment", reverseButtons: true, focusCancel: true,
    });
    if (!result.isConfirmed) return;
    start(async () => {
      const response = await reverseOrderPayment(orderId, result.value);
      if (!response.ok) await Swal.fire("Could not reverse", response.message, "error");
    });
  };
  return <button type="button" className="reverse-payment-trigger" disabled={pending} onClick={reverse}><Undo2 size={15}/>{pending ? "Reversing..." : "Reverse payment"}</button>;
}
