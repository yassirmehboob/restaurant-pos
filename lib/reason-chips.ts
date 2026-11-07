import Swal from "sweetalert2";

// One-tap reasons; staff can still edit the text before confirming.
export const ORDER_CANCEL_REASONS = ["Customer left", "Ordered by mistake", "Item not available"] as const;
export const PAYMENT_REVERSAL_REASONS = ["Payment entered on the wrong order", "Customer has not paid yet", "Wrong payment method"] as const;

// A SweetAlert didOpen hook that puts reason buttons above the popup's input. A tap fills in the text.
export function reasonChips(reasons: readonly string[]) {
  return (popup: HTMLElement) => {
    const input = Swal.getInput(), row = document.createElement("div");
    row.className = "swal-reason-chips";
    for (const text of reasons) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = text;
      button.addEventListener("click", () => { if (!input) return; input.value = text; Swal.resetValidationMessage(); input.focus(); });
      row.append(button);
    }
    if (input) input.insertAdjacentElement("beforebegin", row); else popup.append(row);
  };
}
