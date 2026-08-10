# Restaurant POS — Codex Master Development Plan

> **Purpose:** This file is the implementation blueprint for Codex to build a production-ready Restaurant POS using the existing Next.js + React + MongoDB starter project.
>
> **Primary users:** Restaurant owners, cashiers, admins, kitchen staff, and waiters. Many users may have limited computer experience, so the interface must be extremely simple, touch-friendly, mobile/tablet-friendly, and difficult to misuse.

---

## 1. Codex Role

Act as a **senior full-stack engineer and POS system architect**.

Build this system incrementally inside the existing project. Do not rewrite the whole starter project unnecessarily. First inspect the current codebase, package manager, Next.js version, folder structure, styling system, linting rules, TypeScript configuration, and existing dependencies.

### Mandatory development behavior

1. Preserve existing working project structure where practical.
2. Use TypeScript.
3. Use reusable components.
4. Keep business logic outside UI components.
5. Add server-side validation for every write operation.
6. Never trust values coming from the browser for price, cost, totals, role, business ownership, or profit calculations.
7. Every business-owned record must contain `businessId`.
8. Use soft-delete/active flags for master data where deleting historical references would break reports.
9. Sales/order records must store historical snapshots of product/deal names, prices, costs, taxes, discounts, and quantities so old receipts/reports never change when the menu changes.
10. Build each phase completely before moving to the next phase.
11. After each phase:
    - run lint,
    - run TypeScript checks,
    - run tests if present,
    - fix errors,
    - summarize changed files,
    - state manual testing steps.
12. Never put MongoDB credentials, auth secrets, printer secrets, or image-service secrets in client code.
13. Use `.env.local` and provide/update `.env.example`.
14. Prefer simple UX over feature density.
15. Do not add complicated abstractions unless they solve a real POS requirement.

---

# 2. Recommended Technology Stack

Use the existing starter choices where compatible. Preferred stack:

- **Next.js** with App Router
- **React**
- **TypeScript**
- **MongoDB**
- **Mongoose**
- **Tailwind CSS**
- **shadcn/ui** or the project's existing component library
- **React Hook Form**
- **Zod**
- **NextAuth/Auth.js** or a secure credentials/session implementation already present in the starter
- **bcrypt/bcryptjs** for password hashing
- **MongoDB GridFS** for business logos and product/deal image binaries
- **Recharts** for dashboard/report charts
- **date-fns** for date handling
- **Lucide icons**
- Optional **TanStack Query** only if the existing app benefits from it
- Optional **Zustand** for local POS/cart UI state
- **QZ Tray integration or a local print bridge** for automatic multi-printer routing
- Standard browser print as the fallback

Do **not** store product images as base64 strings inside normal MongoDB documents.

---

# 3. Core Business Goals

The POS must support:

- Business registration/setup
- Admin signup/login
- Restaurant profile
- Products/menu items
- Categories
- Product/deal images
- Customers
- Waiters/staff
- Restaurant tables
- Item deals/combos
- Dine-in orders
- Takeaway orders
- Delivery orders
- Table number
- Waiter assignment
- Sale records
- Payment records
- Customer receipt
- Kitchen receipt / KOT
- One-printer or two-printer configuration
- Profit reporting
- Loss/expense reporting
- Daily/monthly sales reports
- Touch-screen support
- Mobile and tablet responsive interface
- Strong audit trail
- Settings

---

# 4. Scope Strategy

## Version 1 — Required

Implement these first:

1. Authentication
2. Business setup
3. Admin dashboard
4. Categories
5. Products
6. Deals
7. Customers
8. Waiters/staff
9. Tables
10. POS order screen
11. Dine-in / takeaway / delivery
12. Cart calculations
13. Order save
14. Sale/payment completion
15. Customer receipt
16. Kitchen receipt
17. Printer settings
18. Sales history
19. Basic profit report
20. Expenses
21. P&L summary
22. Settings
23. Audit log

## Version 2 — Recommended Later

Do not block V1 for these:

- Inventory/stock
- Ingredient-level recipe costing
- Purchase orders
- Supplier management
- Multiple branches
- Kitchen Display System
- Online ordering
- Rider management
- Loyalty points
- Coupons
- Advanced discounts
- Customer credit ledger
- Split payments
- Split bills by guest
- Table merge/move
- Shift opening/closing
- Cash drawer control
- Offline synchronization
- Full accounting integration

Design V1 so these can be added later without a major rewrite.

---

# 5. Multi-Tenant Data Rule

Even if the first installation has only one restaurant, design the database as business-aware.

Every relevant collection must contain:

```ts
businessId: ObjectId
```

Never query a business-owned document only by `_id`.

Correct pattern:

```ts
Model.findOne({
  _id: recordId,
  businessId: session.user.businessId
})
```

This prevents one restaurant from accessing another restaurant's data if multi-business support is enabled later.

---

# 6. User Roles

Use role-based access.

Suggested roles:

```ts
type UserRole =
  | "OWNER"
  | "ADMIN"
  | "CASHIER"
  | "WAITER"
  | "KITCHEN";
```

## OWNER

Full access:

- Business settings
- Users/staff
- Products/deals
- Sales
- Profit reports
- Expenses
- Printer settings
- Audit logs

## ADMIN

Almost full operational access. Sensitive settings may optionally remain owner-only.

## CASHIER

- POS
- Customers
- Orders
- Payments
- Receipts
- Sales history according to permission
- No sensitive cost/profit settings unless granted

## WAITER

Future-friendly role:

- Create/update assigned orders
- Select tables
- Add items
- Send to kitchen

## KITCHEN

Future-friendly role:

- View kitchen tickets/status
- No prices/profit

For V1, OWNER/ADMIN/CASHIER can be fully implemented first.

---

# 7. Authentication

## Signup

The signup form must stay short and contain exactly:

- Restaurant/business name
- Owner full name
- Username
- Password

Do not require an email address for signup or login. Restaurant users may not have email accounts. Usernames must be normalized to lowercase, validated on the server, and unique across login accounts.

After registration, redirect the owner to a protected Business Profile form where they can add or update the business address, contact number, optional business email, legal name, city, country, tax number, currency, timezone, and business logo. Owners and admins may return to this form later from the dashboard navigation.

Initial signup creates:

1. Business
2. Owner user
3. Default settings
4. Default order numbering settings
5. Optional sample categories/tables only if user chooses

Suggested fields:

```ts
Business {
  _id
  name
  legalName?
  phone?
  email?
  address?
  city?
  country?
  currency
  timezone
  taxNumber?
  logoUrl?
  isActive
  createdAt
  updatedAt
}
```

```ts
User {
  _id
  businessId
  fullName
  username
  email? // optional for future communication; never required for login
  passwordHash
  role
  pinHash?
  isActive
  lastLoginAt?
  createdAt
  updatedAt
}
```

Support secure username and password login.

Recommended future option: 4–6 digit cashier PIN for fast in-store switching.

---

# 8. Database Collections

Create Mongoose models with indexes.

## 8.1 Category

```ts
Category {
  _id
  businessId
  name
  sortOrder
  imageUrl?
  isActive
  createdAt
  updatedAt
}
```

Indexes:

```ts
{ businessId: 1, name: 1 }
{ businessId: 1, isActive: 1, sortOrder: 1 }
```

---

## 8.2 Product

```ts
Product {
  _id
  businessId
  categoryId
  name
  description?
  imageUrl?
  salePrice
  costPrice
  taxRate?
  isTaxInclusive
  isAvailable
  isActive
  sortOrder
  createdAt
  updatedAt
}
```

Important:

- Money values should be handled consistently.
- Prefer storing amounts as integer minor units if practical, e.g. paisa/cents.
- If using decimal numbers, create a central money utility and round consistently.

For PKR, integer rupees may be enough initially if restaurant pricing has no decimals.

---

## 8.3 Deal

A deal/combo can contain products.

```ts
Deal {
  _id
  businessId
  name
  description?
  imageUrl?
  salePrice
  items: [
    {
      productId
      quantity
    }
  ]
  isAvailable
  isActive
  sortOrder
  createdAt
  updatedAt
}
```

Deal cost should normally be calculated from component product costs when sold, then stored as an immutable snapshot on the sale/order line.

---

## 8.4 Customer

```ts
Customer {
  _id
  businessId
  name
  phone?
  alternatePhone?
  email?
  address?
  area?
  notes?
  totalOrders?
  totalSpent?
  lastOrderAt?
  isActive
  createdAt
  updatedAt
}
```

Customer is optional for dine-in/takeaway.

For delivery, require at minimum:

- customer name
- phone
- delivery address

---

## 8.5 Staff / Waiter

Keep restaurant operational staff separate from application login accounts if needed.

```ts
Staff {
  _id
  businessId
  userId?
  fullName
  role: "WAITER" | "CASHIER" | "KITCHEN" | "OTHER"
  phone?
  code?
  isActive
  createdAt
  updatedAt
}
```

This allows a waiter name to appear on an order without requiring every waiter to have a login.

---

## 8.6 Table

```ts
RestaurantTable {
  _id
  businessId
  name        // e.g. "Table 1"
  number?     // e.g. 1
  area?       // Hall, Family Area, Rooftop
  capacity?
  sortOrder
  isActive
  createdAt
  updatedAt
}
```

Optional status is better derived from open orders instead of permanently stored.

---

## 8.7 Order

Order is the operational restaurant transaction.

Suggested statuses:

```ts
type OrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "SENT_TO_KITCHEN"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "COMPLETED"
  | "CANCELLED";
```

Order types:

```ts
type OrderType =
  | "DINE_IN"
  | "TAKEAWAY"
  | "DELIVERY";
```

Schema:

```ts
Order {
  _id
  businessId

  orderNumber
  orderType
  status

  tableId?
  tableNameSnapshot?

  waiterId?
  waiterNameSnapshot?

  customerId?
  customerSnapshot?: {
    name
    phone?
    address?
  }

  items: [
    {
      lineId

      itemType: "PRODUCT" | "DEAL"
      productId?
      dealId?

      nameSnapshot
      imageUrlSnapshot?
      quantity

      unitPrice
      unitCost

      taxRate
      discountAmount

      lineSubtotal
      lineTax
      lineTotal

      notes?

      dealItemsSnapshot?: [
        {
          productId?
          name
          quantity
          unitCost
        }
      ]
    }
  ]

  subtotal
  discountType?: "NONE" | "FIXED" | "PERCENT"
  discountValue?
  discountAmount

  taxAmount
  serviceChargeAmount?
  deliveryChargeAmount?

  grandTotal

  paidAmount
  dueAmount

  paymentStatus: "UNPAID" | "PARTIAL" | "PAID"

  kitchenPrintedAt?
  customerReceiptPrintedAt?

  notes?

  createdByUserId
  completedByUserId?

  openedAt
  completedAt?
  cancelledAt?
  cancellationReason?

  createdAt
  updatedAt
}
```

### Critical order rule

Order items must use **snapshots**.

If "Chicken Burger" costs 500 today and is changed to 600 next month, an old receipt must still show 500.

---

## 8.8 Payment

Keep payments separately for future flexibility.

```ts
Payment {
  _id
  businessId
  orderId
  amount
  method: "CASH" | "CARD" | "BANK" | "OTHER"
  reference?
  receivedByUserId
  paidAt
  notes?
  createdAt
}
```

For V1, full single payment is enough, but schema supports partial/split payments later.

---

## 8.9 Expense

Net profit cannot be calculated correctly from sales alone.

```ts
Expense {
  _id
  businessId
  category
  description
  amount
  expenseDate
  paymentMethod?
  notes?
  createdByUserId
  createdAt
  updatedAt
}
```

Examples:

- Rent
- Electricity
- Gas
- Salaries
- Packaging
- Delivery expense
- Maintenance
- Miscellaneous

---

## 8.10 Printer Settings

```ts
PrinterSettings {
  _id
  businessId

  printingMode: "BROWSER" | "QZ_TRAY"

  receiptPaperWidth: "58MM" | "80MM"

  customerPrinterName?
  kitchenPrinterName?

  kitchenPrintingEnabled
  customerPrintingEnabled

  onePrinterMode
  printTwoCopiesWhenOnePrinter

  customerReceiptCopies
  kitchenReceiptCopies

  autoPrintKitchenOnConfirm
  autoPrintCustomerOnPayment

  showLogoOnCustomerReceipt
  showPricesOnKitchenReceipt

  createdAt
  updatedAt
}
```

Rules:

### Two printers connected

- Customer receipt → customer printer
- Kitchen receipt → kitchen printer

### One printer connected

If `onePrinterMode = true`:

- print Kitchen Receipt
- then print Customer Receipt
- both from configured single printer

### Browser fallback

If direct-printer control is unavailable:

- open printable receipt window/page
- let user use system print dialog

Never pretend browser-only JavaScript can silently choose arbitrary printers reliably.

---

## 8.11 Business Settings

```ts
BusinessSettings {
  _id
  businessId

  currency
  timezone

  defaultTaxRate
  pricesIncludeTax

  serviceChargeEnabled
  serviceChargeRate?

  orderPrefix
  nextOrderSequence

  receiptHeader?
  receiptFooter?

  requireWaiterForDineIn
  requireTableForDineIn

  allowNegativeDiscount
  allowPriceOverride
  requireManagerForPriceOverride

  createdAt
  updatedAt
}
```

Implement safe order-number generation so simultaneous orders do not receive the same number.

Example:

```text
ORD-000001
ORD-000002
```

---

## 8.12 Audit Log

Track important changes.

```ts
AuditLog {
  _id
  businessId
  userId
  userNameSnapshot?
  action
  entityType
  entityId?
  description
  metadata?
  ipAddress?
  userAgent?
  createdAt
}
```

Examples:

- LOGIN
- CREATE_PRODUCT
- UPDATE_PRODUCT
- DEACTIVATE_PRODUCT
- CREATE_ORDER
- CANCEL_ORDER
- COMPLETE_ORDER
- REFUND
- CHANGE_SETTINGS
- ADD_EXPENSE
- DELETE_EXPENSE

Avoid logging passwords or sensitive secrets.

---

# 9. Recommended Folder Structure

Adapt to the existing project instead of forcing this exactly.

```text
src/
  app/
    (auth)/
      login/
      signup/

    (dashboard)/
      dashboard/
      pos/
      orders/
      sales/
      products/
      categories/
      deals/
      customers/
      staff/
      tables/
      expenses/
      reports/
      settings/
        business/
        receipt/
        printers/
        users/

    api/
      auth/
      products/
      categories/
      deals/
      customers/
      staff/
      tables/
      orders/
      payments/
      expenses/
      reports/
      settings/
      uploads/

  components/
    ui/
    layout/
    pos/
    orders/
    receipts/
    forms/
    reports/

  lib/
    auth/
    db/
    permissions/
    validation/
    money/
    printing/
    uploads/
    audit/
    order-number/

  models/
    Business.ts
    BusinessSettings.ts
    User.ts
    Category.ts
    Product.ts
    Deal.ts
    Customer.ts
    Staff.ts
    RestaurantTable.ts
    Order.ts
    Payment.ts
    Expense.ts
    PrinterSettings.ts
    AuditLog.ts

  services/
    order.service.ts
    payment.service.ts
    report.service.ts
    print.service.ts
    upload.service.ts

  types/
```

---

# 10. UI/UX Design Requirements

The restaurant POS is not an office ERP. It must be optimized for speed.

## 10.1 General UI Principles

- Large touch targets: preferably 44–52 px minimum
- Large readable fonts
- High contrast
- Minimal typing
- Avoid tiny dropdowns
- Avoid crowded tables on tablets
- Always show primary action clearly
- Destructive buttons require confirmation
- Use icons + text, not icons alone for important actions
- Use plain language
- Show success/failure feedback immediately
- Keep form labels visible
- Do not rely only on hover
- All actions must work on touch screens
- Avoid right-click interactions
- Avoid double-click requirements

---

## 10.2 Main Navigation

Desktop/tablet landscape:

- Dashboard
- POS
- Orders
- Sales
- Products
- Deals
- Customers
- Staff
- Tables
- Expenses
- Reports
- Settings
- Logout

Tablet/mobile:

Use bottom navigation or an easy hamburger/drawer.

The **POS** action should always be one tap away.

---

# 11. POS Screen Design

This is the most important screen.

## Tablet/Desktop Layout

### Left / Main Area

- Search box
- Category tabs/buttons
- Product/deal grid
- Product image
- Product name
- Price
- Availability

### Right Cart Area

- Order type
- Table
- Waiter
- Customer
- Cart items
- Quantity controls
- Item notes
- Subtotal
- Discount
- Tax
- Delivery charge
- Grand total
- Buttons:
  - Hold/Save
  - Send to Kitchen
  - Pay
  - Clear

## Mobile Layout

Use a staged flow:

1. Menu/product screen
2. Floating cart button with item count and total
3. Cart drawer/full-screen sheet
4. Payment sheet

Do not compress desktop columns into unusable mobile widths.

---

# 12. POS Interaction Rules

## Order Type

At start of order, user selects one large button:

- Dine-In
- Takeaway
- Delivery

Default can be configured.

## Dine-In

Require based on settings:

- Table
- Waiter

## Takeaway

Table is hidden.

Customer is optional.

## Delivery

Require:

- Customer name
- phone
- address

Optional:

- delivery charge
- delivery notes

---

# 13. Product Selection

Product cards must be touch-friendly.

Card shows:

- image
- name
- price

When tapped:

- add one quantity immediately

Optional long/secondary action:

- item note
- quantity
- customization later

Unavailable products must clearly show:

```text
Unavailable
```

and cannot be added.

Deals should appear in the same POS catalog with a visible "Deal" badge.

---

# 14. Cart

Each line should show:

- Item name
- Quantity
- `-` button
- `+` button
- Unit price
- Line total
- Note button
- Remove button

Never allow quantity below 1.

For a touch screen, make plus/minus buttons large.

---

# 15. Order Calculation

All final calculations must be recalculated on the server.

Recommended calculation order:

```text
line base = unitPrice × quantity
line discounts
subtotal
order discount
tax
service charge
delivery charge
grand total
```

Use one centralized calculation function, shared conceptually by preview and server.

The server is authoritative.

Do not accept `grandTotal` from client as trusted data.

---

# 16. Deals

Deal setup UI:

- Deal name
- Deal image
- Selling price
- Add component products
- Quantity per component
- Active/available

Example:

```text
Family Deal
2 × Zinger Burger
1 × Large Fries
1 × 1.5L Drink
Sale Price: 2,499
```

At sale time:

- save deal selling price snapshot
- calculate component cost snapshot
- save deal component snapshot

This allows correct gross-profit reporting.

---

# 17. Kitchen Receipt / KOT

Kitchen receipt should be simple and large.

Recommended content:

```text
RESTAURANT NAME
KITCHEN ORDER

Order: ORD-000123
Type: DINE-IN
Table: Table 7
Waiter: Ali
Time: 08:42 PM

--------------------------------
2 x Chicken Burger
    NO MAYO

1 x Large Fries

1 x Family Deal
    2 x Zinger Burger
    1 x Fries
    1 x Drink
--------------------------------

Order Note:
Birthday table — serve drinks first
```

Kitchen receipt should normally NOT show:

- cost
- profit
- payment
- unnecessary customer financial information

Make `showPricesOnKitchenReceipt` configurable.

Use large bold quantities.

---

# 18. Customer Receipt

Recommended content:

```text
RESTAURANT NAME
Address
Phone
Tax number if available

Receipt: ORD-000123
Date/Time
Order Type
Table
Waiter
Customer (if available)

--------------------------------
2 x Chicken Burger      1,000
1 x Large Fries           350
--------------------------------
Subtotal                 1,350
Discount                  -100
Tax                         50
Delivery                     0
--------------------------------
TOTAL                    1,300
Paid                     1,300
Balance                       0
--------------------------------

Payment: Cash

Thank you!
Receipt footer from Settings
```

Support 58mm and 80mm CSS.

---

# 19. Printing Architecture

Create a central interface:

```ts
interface PrinterAdapter {
  listPrinters(): Promise<string[]>;
  printCustomerReceipt(orderId: string): Promise<void>;
  printKitchenReceipt(orderId: string): Promise<void>;
}
```

Implement:

```text
BrowserPrinterAdapter
QzTrayPrinterAdapter
```

The rest of the application must not care which printer technology is used.

---

## 19.1 Browser Printing

Use print-specific routes/components:

```text
/print/order/[orderId]/customer
/print/order/[orderId]/kitchen
```

CSS:

```css
@media print {
  ...
}
```

Provide paper-width classes for:

- 58 mm
- 80 mm

---

## 19.2 QZ Tray / Local Print Bridge

This is recommended when the restaurant needs:

- automatic printing
- separate kitchen and customer printers
- no printer dialog for every order
- direct routing by configured printer name

Do not hard-code printer names.

Printer names come from Settings.

Create status indicators:

```text
Printer Service: Connected
Customer Printer: EPSON TM-T20III
Kitchen Printer: XPrinter XP-Q200
```

Error UX must be very obvious:

```text
Kitchen receipt was NOT printed.
[Try Again]
[Print from Browser]
```

Never mark a receipt as printed when the print request failed.

---

# 20. One-Printer / Two-Printer Logic

Implement exactly:

```ts
if (settings.onePrinterMode) {
  if (settings.kitchenPrintingEnabled) {
    printKitchenReceipt(orderId);
  }

  if (settings.customerPrintingEnabled) {
    printCustomerReceipt(orderId);
  }
} else {
  // route each receipt to configured printer
}
```

However customer receipt should normally print at payment/completion, while kitchen receipt prints when an order is confirmed/sent to kitchen.

Settings should also allow manual reprint.

Add reprint buttons in Order Details:

- Print Kitchen
- Print Customer
- Print Both

Audit reprints if useful.

---

# 21. Order Lifecycle

Suggested flow:

## New Order

```text
DRAFT
```

## Confirm / Send Kitchen

```text
CONFIRMED
SENT_TO_KITCHEN
```

Kitchen receipt prints here if configured.

## Kitchen Progress

Optional V1 status:

```text
PREPARING
READY
```

## Dine-In Served

```text
SERVED
```

## Payment

Payment is created.

If fully paid:

```text
COMPLETED
paymentStatus = PAID
```

Customer receipt prints here if configured.

---

# 22. Editing an Order After Kitchen Print

Restaurant orders often change.

Support adding/removing items after initial kitchen print.

For a later enhancement, kitchen should receive an **amendment KOT** instead of reprinting the entire ticket.

Example:

```text
ORDER UPDATE — ORD-000123

ADDED
+ 1 x Chicken Karahi

REMOVED
- 1 x Fries
```

For V1, it is acceptable to reprint the updated full KOT with a prominent:

```text
UPDATED ORDER
```

But architect order item line IDs so delta tickets can be implemented later.

---

# 23. Cancellation

Cancellation must:

- require confirmation
- require a reason
- store user
- store time
- not delete the order
- appear in audit logs

Cancelled orders should not be counted as sales.

If payment/refund functionality is added later, refund must be a separate auditable transaction.

---

# 24. Product Image Upload

UI requirements:

- Upload from mobile camera/gallery
- Preview
- Replace
- Remove
- Compress/resize before or during upload if practical

Recommended image constraints:

- square/near-square
- WebP/JPEG
- approx. 800–1200 px max dimension
- reasonable file-size limit

Store:

```ts
imageUrl
```

Use MongoDB GridFS for image binary storage. GridFS must use dedicated `images.files` and `images.chunks` collections; do not embed binary/base64 content in normal Business, Product, Deal, or Category documents. Store only an internal URL such as `/api/images/[id]` in the owning record.

Every GridFS file must include `businessId` and image kind in metadata. The image-serving route must authenticate the request and verify that file metadata belongs to the session business before returning bytes. Validate MIME type and enforce a 5 MB maximum upload size.

---

# 25. Dashboard

Keep dashboard useful, not decorative.

Today cards:

- Today's Sales
- Orders
- Average Order Value
- Gross Profit
- Expenses
- Net Result

Additional:

- Dine-in sales
- Takeaway sales
- Delivery sales
- Top-selling products
- Top-selling deals
- Recent orders

Owners/admins see profit values.

Cashier role can hide cost/profit.

---

# 26. Reports

Implement filters:

- Today
- Yesterday
- This Week
- This Month
- Custom Date Range

## Sales Report

Show:

- total orders
- gross sales
- discount
- tax
- delivery charges
- net sales
- payment method totals
- order type totals

## Product Sales

- product
- quantity sold
- revenue
- estimated cost
- gross profit

## Deal Sales

Same idea.

## Waiter Report

- waiter
- orders taken
- sales amount
- average ticket

## Order Type Report

- Dine-in
- Takeaway
- Delivery

## Profit & Loss

At minimum:

```text
Sales Revenue
- Cost of Goods Sold
= Gross Profit

- Expenses
= Net Profit / Loss
```

Important wording:

If inventory/ingredient usage is not implemented, call COGS an **estimated sales cost based on product/deal cost snapshots**.

---

# 27. Profit Calculation

Each completed order item stores:

```ts
unitCost
quantity
```

Then:

```text
line cost = unitCost × quantity
order COGS = sum(line costs)
gross profit = net product sales - COGS
```

Net P&L:

```text
gross profit - recorded expenses
```

Do not calculate historical profit using current Product.costPrice.

Use the sale-time snapshot.

---

# 28. Sales History

Provide a searchable order list.

Filters:

- order number
- date
- order type
- waiter
- table
- customer
- status
- payment method

Columns/cards:

- Order #
- Date/time
- Type
- Table
- Waiter
- Total
- Payment
- Status

Actions:

- View
- Print Customer Receipt
- Print Kitchen Receipt
- Print Both

Owner/admin optional action:

- Cancel with reason

---

# 29. Customers

Customer search must be fast by:

- name
- phone

When entering a delivery phone number, auto-suggest existing customers.

Customer detail:

- name
- phone
- addresses
- order count
- total spent
- last order
- order history

Do not make customer creation mandatory for normal counter sales.

---

# 30. Admin Forms

All master-data pages should follow a consistent pattern.

Phase 2 list and form presentation:

- Use **Item / Items** in all user-facing UI copy instead of Product / Products. The internal MongoDB model and route may remain `Product` and `/products` for compatibility.
- Keep the Items page header compact so more menu cards remain visible without scrolling.
- Item cards show the item name on one truncated single line and the category immediately below it.
- At desktop widths, use a dense responsive multi-column card catalog where practical.
- Items provide live filters for item name, category, Available, Unavailable, and Deactivated status.
- Add Item and Update Item use a full-viewport popup workspace so the desktop form fits without internal scrolling.
- After a successful Item create/update response, reset the form and automatically close the full-screen popup.
- Deals use the same compact-header, live-filter, responsive card-catalog pattern as Items.
- Deal cards show a single-line deal name, price, availability state, and every included item with its quantity. The included-item summary wraps to multiple lines and must never be truncated.
- Deals support Available, Unavailable, and Deactivated filtering and quick availability changes.
- Add Deal and Update Deal use the full-viewport popup and automatically close after a successful server response.
- Full-screen forms keep the Save action visible in a sticky footer on shorter displays.
- Deal item rows use explicit Item and Quantity labels, a clearly bordered numeric quantity input, and a dedicated trash icon button with disabled and hover states.
- Item names must be unique within a business using a unique compound index on `{ businessId: 1, name: 1 }`. Different businesses may use the same item name.
- Barcode is not part of the current Item form or schema. Remove obsolete unique SKU/barcode indexes during migration.

- Products, Deals, Customers, Staff, and Tables use the full page width for their lists.
- Add and Update actions open a modal dialog on desktop and a viewport-safe popup/sheet on mobile.
- Do not keep a permanently visible add form beside a list.
- Product forms contain Category, Product Name, Sale Price, Cost Price, Tax Rate, Description, and Image.
- Tax Rate is optional in Product add/update forms and defaults to `0` on the server when blank.
- Product forms must not contain Short Name, SKU, or Kitchen Station fields.
- Categories do not have a separate navigation page. Place an icon button beside the Category dropdown in Product add/update dialogs.
- The category popup supports adding, listing, updating, activating, and deactivating categories without leaving Products.
- Deals, Customers, Staff, and Tables follow the same list-first plus add/update popup pattern.
- The Customers main page follows the Items catalog pattern with responsive cards and live filters for name/contact details, area, and active/deactivated status. Customer deactivation requires a SweetAlert confirmation dialog.
- The Staff main page follows the Items catalog pattern with responsive cards and live filters for name/contact details, staff code, role, and active/deactivated status. Staff deactivation requires a SweetAlert confirmation dialog.
- The Tables main page follows the Items catalog pattern with responsive cards and live filters for table name/number, area, capacity, and active/deactivated status. Table deactivation requires a SweetAlert confirmation dialog.
- Keep normal desktop add/update forms compact enough to avoid internal modal scrolling; use viewport-safe scrolling only on short screens and mobile devices.
- Use a clean neutral professional interface with restrained accent colors, high contrast, and minimal decorative gradients.

Example Products page:

Top:

```text
Items                            [+ Add Item]
[Search Items...] [Category] [Status]
```

Main:

- desktop table
- mobile cards

Add/Edit opens:

- dialog on desktop
- full-screen sheet/page on mobile

Keep forms short.

---

# 31. Settings

Create sections:

## Business

- restaurant name
- phone
- address
- logo
- currency
- timezone

## POS

- default order type
- require table for dine-in
- require waiter for dine-in
- default tax
- service charge
- allow discount
- allow price override

## Receipt

- 58mm / 80mm
- receipt header
- receipt footer
- show logo
- tax details

## Printers

- browser/QZ mode
- customer printer
- kitchen printer
- one-printer mode
- copies
- auto-print settings
- test customer print
- test kitchen print

## Users

- admin/cashier accounts
- activate/deactivate
- reset password

---

# 32. Simple Touch-Friendly Components

Create reusable components:

```text
TouchButton
NumericKeypad
QuantityStepper
OrderTypeSelector
CategoryScroller
ProductCard
DealCard
CartLine
MoneyDisplay
TableSelector
WaiterSelector
CustomerQuickSearch
PaymentPanel
PrinterStatus
```

For numeric entry such as quantity/discount/payment, optionally use an on-screen numeric keypad for tablets.

---

# 33. Responsive Breakpoints

Design for at least:

- 360px phone
- 768px tablet portrait
- 1024px tablet landscape
- 1366px POS desktop
- 1920px desktop

The main target should be **10–13 inch touch tablets / POS screens**.

---

# 34. API / Server Actions

Use the existing project approach consistently.

Possible route design:

```text
POST   /api/auth/signup
POST   /api/auth/login

GET    /api/categories
POST   /api/categories
PATCH  /api/categories/:id

GET    /api/products
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id

GET    /api/deals
POST   /api/deals
PATCH  /api/deals/:id

GET    /api/customers
POST   /api/customers
PATCH  /api/customers/:id

GET    /api/staff
POST   /api/staff
PATCH  /api/staff/:id

GET    /api/tables
POST   /api/tables
PATCH  /api/tables/:id

POST   /api/orders
GET    /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id

POST   /api/orders/:id/confirm
POST   /api/orders/:id/cancel
POST   /api/orders/:id/payment

GET    /api/reports/sales
GET    /api/reports/profit-loss

GET    /api/settings
PATCH  /api/settings

POST   /api/uploads/image
```

If Server Actions are used, preserve the same service-layer separation and validation.

---

# 35. Validation

Create Zod schemas such as:

```text
signupSchema
loginSchema
categorySchema
productSchema
dealSchema
customerSchema
staffSchema
tableSchema
createOrderSchema
updateOrderSchema
paymentSchema
expenseSchema
businessSettingsSchema
printerSettingsSchema
```

Validate on:

- client for fast feedback
- server for security

---

# 36. Authorization

Create helpers like:

```ts
requireSession()
requireBusiness()
requireRole(["OWNER", "ADMIN"])
requirePermission(...)
```

Never rely on hiding a button as security.

Every server route/action must check authorization.

---

# 37. Security Requirements

- Hash passwords
- Secure session cookies
- CSRF-safe auth pattern
- Rate limit login if practical
- Validate image MIME/type/size
- Sanitize input where needed
- Protect against Mongo operator injection through validation
- Never expose password hashes
- Never return costs/profit to unauthorized roles
- Use business-scoped queries
- Keep secrets server-side
- Add secure headers through framework best practices
- Log sensitive operational changes
- Do not log credentials

---

# 38. Database Indexes

At minimum consider:

```ts
Order:
{ businessId: 1, orderNumber: 1 } unique
{ businessId: 1, createdAt: -1 }
{ businessId: 1, status: 1, createdAt: -1 }
{ businessId: 1, orderType: 1, createdAt: -1 }

Product:
{ businessId: 1, name: 1 }
{ businessId: 1, categoryId: 1, isAvailable: 1 }

Customer:
{ businessId: 1, phone: 1 }
{ businessId: 1, name: 1 }

Payment:
{ businessId: 1, paidAt: -1 }
{ businessId: 1, orderId: 1 }

Expense:
{ businessId: 1, expenseDate: -1 }

AuditLog:
{ businessId: 1, createdAt: -1 }
```

---

# 39. Data Consistency

For order completion/payment, use a MongoDB transaction when supported and practical.

Operations may include:

1. validate order
2. create payment
3. update paid amount
4. mark completed
5. update timestamps
6. write audit log

Avoid a state where payment exists but order remains unpaid due to a partial failure.

---

# 40. Performance

POS catalog should feel instant.

Recommendations:

- Query only active/available categories/products
- Optimize images
- Use lazy loading
- Cache static-ish menu reads appropriately, while making availability updates refresh correctly
- Do not reload the whole page after each cart action
- Keep cart state local until saving/confirming
- Use debounced customer search
- Paginate sales history
- Aggregate reports on server

---

# 41. PWA / Installation

Strongly recommended for tablet/mobile usage:

- Add web app manifest
- App icons
- Standalone display
- Installable PWA
- Mobile viewport
- Optional service worker later

Do not implement complex offline order synchronization in V1 unless specifically requested.

The app can still be installable without full offline transaction support.

---

# 42. Error Handling

Use user-friendly errors.

Bad:

```text
MongoServerError E11000
```

Good:

```text
This product name/SKU already exists.
```

For POS:

```text
Order could not be saved.
Your cart is still available.
[Try Again]
```

Printer:

```text
Order was saved, but Kitchen Receipt did not print.
[Try Kitchen Print]
```

Printing failure must NOT undo a successfully saved order.

---

# 43. Confirmation Dialogs

Require confirmation for:

- Clear cart
- Cancel order
- Delete/deactivate master data
- Remove an item if accidental removal is likely
- Complete payment if amount is unusual
- Change printer configuration
- Reset password

Keep routine POS actions fast; do not show unnecessary confirmation for every tap.

---

# 44. Notifications

Use toast/snackbar for:

- Product saved
- Order sent to kitchen
- Payment completed
- Receipt printed
- Printer error
- Expense saved

Do not cover important POS controls with notifications.

---

# 45. Accessibility

- Keyboard support on desktops
- Visible focus states
- Semantic buttons
- Labels
- Good contrast
- Avoid color as the only status signal
- Use `aria-label` for icon-only secondary buttons

---

# 46. Testing Strategy

## Unit tests

Prioritize:

- money calculations
- discounts
- taxes
- deal cost calculation
- P&L
- order validation
- role authorization helpers

## Integration tests

- create order
- complete payment
- cancel order
- business isolation
- report aggregation

## E2E tests

Key flows:

### Flow A — Dine-In

1. login
2. select Dine-In
3. choose table
4. choose waiter
5. add items
6. send kitchen
7. pay
8. customer receipt

### Flow B — Takeaway

1. select Takeaway
2. add deal
3. confirm
4. pay
5. print

### Flow C — Delivery

1. select Delivery
2. choose/create customer
3. address
4. delivery charge
5. send kitchen
6. pay

---

# 47. Seed Data

Create a development seed script.

Example:

Categories:

- Burgers
- Pizza
- BBQ
- Drinks
- Deals

Products:

- Zinger Burger
- Beef Burger
- Chicken Pizza
- Fries
- Cola

Tables:

- Table 1
- Table 2
- Table 3
- Table 4
- Table 5

Waiters:

- Ali
- Ahmed
- Bilal

Never run seed automatically in production.

---

# 48. Phase-by-Phase Implementation Plan

Codex should work in this order.

---

## PHASE 0 — Inspect Existing Starter

Before editing:

1. inspect `package.json`
2. detect Next.js version
3. detect App Router/Pages Router
4. inspect TypeScript
5. inspect CSS/UI setup
6. inspect auth if present
7. inspect MongoDB setup if present
8. inspect environment files
9. inspect eslint/prettier
10. inspect tests

Create a short internal implementation note.

Do not delete working starter features without a reason.

---

## PHASE 1 — Foundation

Implement:

- MongoDB connection
- Mongoose
- environment validation
- auth
- session
- business model
- user model
- business registration
- login/logout
- username-based authentication without requiring email
- protected business profile form after registration
- editable business name, address, contact information, and logo upload
- protected dashboard layout
- role helpers
- base audit logging

Acceptance:

- Owner can register
- Business is created
- Owner can register and log in with a username instead of email
- Owner/admin can update business name, address, contact number, related profile information, and business logo after login
- Owner can login/logout
- Unauthorized user cannot open dashboard
- Business context is available server-side

---

## PHASE 2 — Master Data

Implement:

- Categories
- Products
- Product image upload
- Deals
- Deal image upload
- Customers
- Staff/waiters
- Tables

Required Phase 2 UI structure:

- Full-width master-data lists
- Add/update modal forms
- Embedded category manager opened beside the Product category dropdown
- No separate Categories page in navigation
- No Short Name, SKU, or Kitchen Station product fields

Acceptance:

- CRUD works
- soft deactivate works
- search/filter works
- tablet/mobile views are usable
- images upload and display correctly
- all data is business-scoped

---

## PHASE 3 — POS UI

Build touch-first POS.

Implementation status: the touch-first POS catalog, order-type flows, cart controls, line notes, table/waiter/customer selectors, delivery details, responsive mobile cart, and server-authoritative totals preview are implemented. Order persistence, kitchen submission, and payment remain intentionally reserved for Phases 4 and 5.

POS refinements: POS runs full-screen without the dashboard sidebar; table and waiter selection are optional; deal cards list their included items; customer selection has no synthetic walk-in option; and customers can be added or updated inside POS with name/mobile fields plus address/area for Delivery.

POS navigation and density: provide a direct Dashboard return action, keep customer add/edit icons clearly visible, accept any non-empty mobile number, and display at least five included deal items directly on a deal card without an internal scrollbar.

POS submission behavior: keep Clear and Save visible in a fixed cart footer while order lines scroll; default the existing Counter customer for Dine-In and Takeaway; and make Save atomically persist, confirm, and send the order to kitchen before resetting POS for a new order.

Implement:

- order type selector
- category selector
- product/deal grid
- search
- cart
- quantity changes
- line notes
- table selector
- waiter selector
- customer selector
- delivery details
- server total preview/validation architecture

Acceptance:

- can build Dine-In order
- can build Takeaway order
- can build Delivery order
- mobile/tablet layout works

Do not implement payment before order data model is stable.

---

## PHASE 4 — Order Engine

Implement:

- Phase 4 implementation status: persistent business-scoped orders, atomic per-business order numbers, product/deal and cost snapshots, centralized server recalculation, order history/detail views, open-order editing, controlled kitchen status transitions, and audited cancellation with a required reason are implemented. Payment and completion remain reserved for Phase 6.
- order number generation
- create/save order
- item snapshots
- cost snapshots
- calculations
- status changes
- confirm/send kitchen
- order detail page
- edit open order
- cancel order with reason

Acceptance:

- historical prices are preserved
- cost is preserved
- server recalculates totals
- business isolation is verified
- cancelled order remains in history

---

## PHASE 5 — Receipts & Printing

Implementation status: separate authenticated customer and kitchen receipt routes, 58mm/80mm print CSS, browser print and reprint controls, one/two-printer settings, and a shared Browser/QZ adapter boundary are implemented. Browser jobs are intentionally not marked as confirmed because the browser cannot report physical print success; the QZ adapter fails visibly until a local bridge is connected, without changing order state.

Implement first:

- customer printable receipt
- kitchen printable receipt
- 58mm/80mm layout
- browser printing

Then implement printing adapter abstraction.

Then optional/recommended:

- QZ Tray adapter
- printer detection/list
- saved printer names
- test print
- one-printer mode
- two-printer mode
- print retry

Acceptance:

- customer and kitchen receipts have different content
- can print each manually
- one printer can produce both receipts
- two printer routing is supported through direct-print adapter
- printer failure does not lose order

---

## PHASE 6 — Payment & Completion

Implement:

- payment modal
- cash/card/bank/other
- amount
- change calculation for cash
- Payment collection
- complete order
- customer receipt auto-print setting

For V1, optionally require full payment only.

Acceptance:

- completed orders become sales
- duplicate payment submissions are prevented
- customer receipt can print after payment

---

## PHASE 7 — Sales & Reporting

Implement:

- sales history
- order search
- filters
- daily dashboard
- sales report
- product report
- deal report
- waiter report
- order-type report
- CSV export if easy and stable

Acceptance:

- totals match stored completed orders
- cancelled orders excluded
- historical snapshots used

---

## PHASE 8 — Expenses & Profit/Loss

Implement:

- expense categories
- expense CRUD
- date filter
- gross profit
- expense totals
- net profit/loss

Acceptance:

```text
Net Sales
COGS
Gross Profit
Expenses
Net Profit/Loss
```

All calculations are server-side.

---

## PHASE 9 — Settings & Users

Implement:

- business profile
- receipt settings
- tax/settings
- printer settings
- admin/cashier account management
- role checks
- active/inactive users

Acceptance:

- changes apply without code edits
- user permissions are enforced server-side

---

## PHASE 10 — Hardening

Perform:

- responsive testing
- touch testing
- authorization review
- error states
- loading states
- empty states
- indexes
- performance
- form validation
- print layout checks
- production env checks
- build
- lint
- tests

---

# 49. Initial Routes / Screens

Create or adapt these:

```text
/login
/signup

/dashboard

/pos

/orders
/orders/[id]

/sales

/products
/deals

/customers

/staff
/tables

/expenses

/reports
/reports/sales
/reports/profit-loss

/settings
/settings/business
/settings/pos
/settings/receipt
/settings/printers
/settings/users

/print/order/[id]/customer
/print/order/[id]/kitchen
```

---

# 50. Suggested Dashboard Layout

Desktop/tablet:

```text
-------------------------------------------------------
 Restaurant POS                           User / Logout
-------------------------------------------------------
 Sidebar | Today's Sales      Orders
         | Gross Profit       Expenses
         |
         | [ Sales Chart ]
         |
         | Top Products
         | Recent Orders
-------------------------------------------------------
```

On mobile:

Stack cards vertically.

---

# 51. Suggested POS Tablet Layout

```text
----------------------------------------------------------------
 [DINE-IN] [TAKEAWAY] [DELIVERY]      Table 5 | Waiter: Ali
----------------------------------------------------------------
 Search...
 [All] [Burgers] [Pizza] [BBQ] [Drinks] [Deals]

 Product Grid                         CART
 -------------------------            --------------------------
 [img] Zinger  Rs 550                 2 x Zinger        1100
 [img] Fries   Rs 300                 1 x Fries          300
 [img] Cola    Rs 150
 [img] Deal A  Rs 1999                Subtotal          1400
                                      Discount             0
                                      Tax                  0
                                      TOTAL              1400

                                      [Send Kitchen]
                                      [Pay Rs 1,400]
----------------------------------------------------------------
```

---

# 52. Touchscreen Rules

Codex must specifically check:

- no critical button smaller than touch target
- no tiny +/- controls
- category list horizontal swipe
- product cards easy to tap
- cart can scroll independently
- sticky total/payment area
- virtual keyboard does not hide required controls on phone
- dialogs do not exceed viewport
- numeric inputs use numeric keyboard
- modals/sheets can close safely
- loading does not cause double order submission

---

# 53. Double-Submission Protection

Important in POS systems.

Disable action while saving.

Use server protections/idempotency where practical for:

- order creation
- payment
- order completion

Never create duplicate sales because cashier double-tapped.

---

# 54. Order Number Generation

Do not generate final order numbers only in the browser.

Use atomic server-side sequence logic.

Example collection:

```ts
Counter {
  businessId
  key: "ORDER"
  seq
}
```

Atomic increment:

```ts
findOneAndUpdate(
  { businessId, key: "ORDER" },
  { $inc: { seq: 1 } },
  { new: true, upsert: true }
)
```

Format with business setting prefix.

---

# 55. Money Utility

Create one utility.

Examples:

```ts
formatMoney(amount, currency)
roundMoney(amount)
calculateLine(...)
calculateOrder(...)
```

Do not scatter `toFixed(2)` business logic throughout components.

---

# 56. Timezone

Store timestamps in UTC.

Display using business timezone.

Reports such as "Today" must use restaurant/business timezone, not blindly server UTC.

Default business timezone can initially be:

```text
Asia/Karachi
```

but should be configurable.

---

# 57. Image Storage

GridFS uses the existing MongoDB connection and requires no third-party image-service credentials:

```env
MONGODB_URI=
AUTH_SECRET=

NEXT_PUBLIC_APP_NAME="Restaurant POS"
```

Use a dedicated GridFS bucket named `images`. Keep binary files out of normal application documents and apply business-scoped access checks when serving them.

---

# 58. Printer Environment / Local Configuration

Printer names are machine-specific and should normally be configured in application settings, not environment variables.

For QZ Tray or local bridge:

- keep adapter isolated
- document setup
- provide connection status
- handle missing local service gracefully
- browser printing must remain usable

---

# 59. Production Deployment Considerations

The Next.js application can be deployed to:

- VPS
- Docker server
- Vercel + MongoDB Atlas
- local restaurant server

However, direct local receipt-printer access is tied to the restaurant device/network.

Recommended practical deployment:

```text
Hosted Next.js App
       |
       +-- MongoDB Atlas / MongoDB Server
       |
Restaurant POS PC/Tablet Browser
       |
       +-- QZ Tray/local print bridge
             |
             +-- Customer Printer
             +-- Kitchen Printer
```

If restaurant internet reliability is poor, a future phase should consider local deployment/offline strategy.

---

# 60. Backup

For production:

- use managed MongoDB backups or scheduled backups
- document restore procedure
- do not rely on browser storage as source of truth

---

# 61. Audit Requirements

At least audit:

- login
- product price change
- product cost change
- deal price change
- order cancellation
- completed sale
- discount override if significant
- expense creation/change
- printer/settings changes
- user creation/deactivation

---

# 62. Permission-Sensitive Fields

Product `costPrice` and report profit should be hidden from waiters/kitchen.

Do not return sensitive fields in API responses to roles that should not see them.

This is more secure than merely hiding UI columns.

---

# 63. Common POS Edge Cases

Codex should handle these deliberately:

1. Product becomes inactive after it was added to an old order.
2. Product price changes after an order was completed.
3. Deal components change next week.
4. Waiter is deactivated but old orders still need waiter name.
5. Table is renamed but old receipt should retain old table name if snapshot policy is used.
6. Customer is deleted/deactivated but old order still needs customer snapshot.
7. Printer is disconnected.
8. Kitchen printer works but customer printer fails.
9. Cashier double-clicks Pay.
10. Page refreshes before order is submitted.
11. Delivery order has no address.
12. Dine-in order has no table when settings require one.
13. Order is cancelled after kitchen print.
14. Discount makes total invalid/negative.
15. Cost price is missing.
16. Report range crosses midnight/timezone boundaries.

---

# 64. Acceptance Test Checklist

## Authentication

- [ ] Owner registration works
- [ ] Signup asks for business name, owner name, username, and password only
- [ ] Username login works without an email address
- [ ] Logout works
- [ ] Protected routes work
- [ ] Invalid business access is blocked
- [ ] Owner/admin can update the protected business profile
- [ ] Business address and contact number can be saved after login
- [ ] Business logo upload stores a URL rather than image binary in MongoDB

## Products

- [ ] Add category
- [ ] Add product
- [ ] Upload image
- [ ] Edit price
- [ ] Edit cost
- [ ] Mark unavailable
- [ ] Deactivate

## Deals

- [ ] Create deal
- [ ] Add multiple products
- [ ] Upload image
- [ ] Set price
- [ ] Add to POS

## Staff/Tables

- [ ] Add waiter
- [ ] Add table
- [ ] Select in POS

## Customers

- [ ] Add customer
- [ ] Search phone
- [ ] Delivery address

## POS

- [ ] Dine-In
- [ ] Takeaway
- [ ] Delivery
- [ ] Product search
- [ ] Category filter
- [ ] Add/remove item
- [ ] Quantity
- [ ] Notes
- [ ] Discount
- [ ] Correct total

## Orders

- [ ] Unique order number
- [ ] Save order
- [ ] Send to kitchen
- [ ] Cancel with reason
- [ ] Historical snapshots correct

## Printing

- [ ] Customer receipt
- [ ] Kitchen receipt
- [ ] 58mm
- [ ] 80mm
- [ ] Browser print
- [ ] One-printer mode
- [ ] Two-printer configuration
- [ ] Print failure message
- [ ] Reprint

## Payment

- [ ] Cash
- [ ] Card
- [ ] Bank/other
- [ ] Completion
- [ ] No double payment

## Reports

- [ ] Today's sales
- [ ] Date range
- [ ] Product sales
- [ ] Waiter sales
- [ ] Order type
- [ ] Gross profit
- [ ] Expenses
- [ ] Net profit/loss

## Responsive

- [ ] 360px
- [ ] 768px
- [ ] 1024px
- [ ] 1366px
- [ ] Touch controls

---

# 65. UI Copy Guidelines

Use simple wording.

Prefer:

```text
Add Product
Save
Cancel
Send to Kitchen
Pay Now
Print Receipt
Try Again
Table
Waiter
Customer
Dine-In
Takeaway
Delivery
```

Avoid developer language such as:

```text
Persist Entity
Execute Mutation
Transaction Payload
```

---

# 66. Empty States

Examples:

Products:

```text
No products yet.
Add your first menu item to start taking orders.
[Add Product]
```

Orders:

```text
No orders found for this date.
```

Customers:

```text
No customer found.
[Add New Customer]
```

---

# 67. Loading States

Use skeletons for dashboard/catalog.

On order submit:

```text
Saving Order...
```

On payment:

```text
Completing Payment...
```

Disable repeated taps.

---

# 68. Product Availability Shortcut

Restaurant admins need quick temporary availability changes.

On Products page provide:

```text
Available / Unavailable
```

without requiring full edit form.

Potential future POS-manager shortcut:

press-and-hold/admin action to mark sold out.

---

# 69. Search

POS product search should match:

- item name

Customer search:

- phone
- name

Order search:

- order number
- customer phone/name

---

# 70. Data Export

If added in V1, provide simple CSV export for:

- sales
- expenses
- P&L detail

Exports must respect active filters/date range and user permissions.

---

# 71. Codex Coding Rules

When generating code:

1. Do not use `any` unless unavoidable and justified.
2. Keep models strongly typed.
3. Keep route handlers small.
4. Put business logic in services/utilities.
5. Put validation in schemas.
6. Reuse money calculation function.
7. Reuse permission helpers.
8. Reuse business-scoping helpers.
9. Avoid copying receipt calculation logic.
10. Keep printer adapter modular.
11. Add comments only where logic is not obvious.
12. Prefer readable code over clever code.
13. Use consistent naming.
14. Use async error handling consistently.
15. Never expose stack traces to normal users in production.

---

# 72. Definition of Done for Each Feature

A feature is not done when only its UI exists.

It is done when:

- UI works
- mobile/tablet works
- server validation works
- authorization works
- MongoDB operation works
- errors are handled
- loading state exists
- success feedback exists
- business scoping is correct
- lint/typecheck passes
- basic manual test steps are documented

---

# 73. First Codex Task

Start with this exact task:

```text
Read RESTAURANT_POS_CODEX_PLAN.md completely.

Inspect the existing Next.js project before making changes.

Report:
1. Next.js version
2. React version
3. App Router or Pages Router
4. TypeScript status
5. Existing UI/styling libraries
6. Existing authentication
7. Existing MongoDB/database setup
8. Existing important folders
9. Missing dependencies needed for Phase 1
10. Any conflict between the starter and this plan

Then implement only PHASE 1 — Foundation.

Phase 1 authentication uses username and password, not email. Keep signup limited to business name, owner full name, username, and password. After registration provide a protected Business Profile form for address, contact number, related business details, and logo upload.

Do not start Products, Deals, POS, Orders, or Printing yet.

After implementation:
- run lint
- run typecheck/build as appropriate
- fix errors
- summarize files changed
- provide manual test steps
```

---

# 74. Second Codex Task

After Phase 1 is tested:

```text
Continue using RESTAURANT_POS_CODEX_PLAN.md.

Implement PHASE 2 — Master Data only:
- categories
- products
- product image upload
- deals
- deal image upload
- customers
- staff/waiters
- restaurant tables

Preserve business scoping, validation, responsive touch-friendly UI, and audit requirements.

Do not start the POS order engine yet.

Run lint/typecheck/build and provide manual testing steps.
```

---

# 75. Third Codex Task

After Phase 2 is tested:

```text
Continue using RESTAURANT_POS_CODEX_PLAN.md.

Implement PHASE 3 — POS UI.

Focus heavily on:
- tablet
- mobile
- touch screens
- large buttons
- fast product selection
- cart usability
- dine-in/takeaway/delivery
- table/waiter/customer selection

Do not implement fake client-side-only final totals. Prepare the UI to use the centralized order calculation rules.

Run quality checks and provide manual tests at 360px, 768px, 1024px, and desktop.
```

---

# 76. Fourth Codex Task

```text
Implement PHASE 4 — Order Engine.

Requirements:
- atomic order number
- server-authoritative price/cost lookup
- immutable item snapshots
- centralized calculation
- create/save/confirm order
- kitchen-send status
- edit open order
- cancel with reason
- audit logs
- business isolation

Write tests for money/order calculations before moving on.
```

---

# 77. Fifth Codex Task

```text
Implement PHASE 5 — Receipts & Printing.

First implement reliable browser print pages for customer and kitchen receipts.

Then implement PrinterAdapter abstraction.

Add:
- 58mm and 80mm
- one-printer mode
- two-printer configuration
- manual reprint
- printer status/errors
- QZ Tray adapter if the environment supports it

Do not allow printing failures to destroy or roll back saved orders.
```

---

# 78. Important Product Decision: Printing

For this application, use this rule:

### Minimum guaranteed functionality

Browser-based printing must always work.

### Recommended restaurant functionality

Use QZ Tray/local print bridge for:

- customer printer auto-routing
- kitchen printer auto-routing
- silent/direct receipt printing

### If one printer exists

Settings allow both receipt types to print from the same configured printer.

### If two printers exist

Customer and Kitchen printer names can be different.

This requirement must remain independent of receipt rendering logic.

---

# 79. Important Product Decision: Sales vs Orders

Do not create a completely separate duplicate `Sale` document unless there is a strong technical reason.

For V1:

- `Order` contains the full transaction
- completed paid orders are the sales source
- `Payment` stores payment events

Reports aggregate completed orders.

This avoids duplicated data becoming inconsistent.

If future accounting integration requires a Sale ledger, add it later with transaction-safe posting.

---

# 80. Important Product Decision: Profit

To produce useful profit figures:

Every sold product/deal line must preserve sale-time cost.

Without this, changing Product.costPrice later will corrupt historical profit reports.

Expenses must be recorded separately for net P&L.

---

# 81. Important Product Decision: Images

MongoDB stores image metadata/URL.

Image binary files are stored in MongoDB GridFS using dedicated `images.files` and `images.chunks` collections. GridFS file metadata must include `businessId` for tenant isolation.

Business, Product, and Deal documents store only the protected internal image URL. Do not save image buffers or base64 strings directly in those documents.

---

# 82. Important Product Decision: Ease of Use

Whenever there is a choice between:

```text
more advanced configuration
```

and

```text
fewer taps for restaurant staff
```

prefer fewer taps for routine POS actions.

Advanced settings can remain under Settings for owner/admin.

---

# 83. Future Architecture Hooks

Prepare clean extension points for:

- branches
- inventory
- ingredients
- kitchen display
- riders
- online ordering
- loyalty
- coupon system
- split bills
- refunds
- shifts
- cash drawer
- offline sync

Do not fully build them now.

---

# 84. Final Instruction to Codex

This POS will be used in a real restaurant environment.

Priorities, in order:

1. **Correct transactions**
2. **Easy touch-screen operation**
3. **Reliable receipt printing**
4. **Security and business data isolation**
5. **Fast order entry**
6. **Accurate historical reporting**
7. **Responsive design**
8. **Maintainable architecture**
9. **Advanced features**

Do not sacrifice transaction correctness for visual effects.

Do not create an over-designed dashboard while the POS workflow is incomplete.

The POS order screen, order calculations, payment safety, and printing reliability are the most important parts of the system.

---

# 85. Recommended Immediate Workflow for the Developer

1. Save this file in the project root as:

```text
RESTAURANT_POS_CODEX_PLAN.md
```

2. Open the project in VS Code.

3. Open Codex.

4. Give Codex this instruction:

```text
Read RESTAURANT_POS_CODEX_PLAN.md and execute the "First Codex Task".
Inspect my existing project first. Do not rewrite the starter unnecessarily.
```

5. Test Phase 1 manually.

6. Commit.

7. Ask Codex to execute the Second Codex Task.

8. Continue one phase at a time.

Do not ask Codex to build all ten phases in one uncontrolled prompt.

---

## End of Plan
