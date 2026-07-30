-- 1. Category snapshot on order_items, so reporting isn't broken if a menu 
--    item's category changes later. Backfill existing rows by joining to 
--    menu_items on menu_item_id where possible.
ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';

UPDATE order_items oi
SET category = mi.category
FROM menu_items mi
WHERE oi.menu_item_id = mi.id AND oi.category = 'General';

-- 2. Discount typing on orders — distinguishes employee discount / 
--    complimentary / promotional from a generic discount.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'none' 
  CHECK (discount_type IN ('none', 'employee', 'complimentary', 'promotional', 'other')),
ADD COLUMN IF NOT EXISTS discount_reason TEXT,
ADD COLUMN IF NOT EXISTS discount_applied_by TEXT;

-- 3. Voids/cancellations log — currently cancelling an order just flips 
--    status with zero record of amount/reason/who. This table is the log.
CREATE TABLE IF NOT EXISTS order_voids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  table_name TEXT,
  void_type TEXT NOT NULL DEFAULT 'order_cancelled' 
    CHECK (void_type IN ('order_cancelled', 'item_removed')),
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  voided_by TEXT,
  voided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_voids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on order_voids" ON order_voids;
CREATE POLICY "Allow all on order_voids" ON order_voids FOR ALL USING (true) WITH CHECK (true);

-- 4. Payment method constraint on transactions — enumerate expected values. 
--    Note: does NOT change any app code, only documents/enforces valid values 
--    at the DB level going forward.
ALTER TABLE transactions
ADD CONSTRAINT transactions_payment_method_check 
  CHECK (payment_method IN ('cash', 'card', 'esewa', 'khalti', 'fonepay', 'other'))
  NOT VALID;
-- NOT VALID = won't fail on existing rows, only enforced for new inserts.

-- 5. Expand daily_closing_reports to hold the richer report. Keep all 
--    existing columns (total_revenue, transaction_count, 
--    breakdown_by_payment_method, opening/closing_bill_number, pdf_url, 
--    generated_at, status) exactly as-is for backward compatibility.
ALTER TABLE daily_closing_reports
ADD COLUMN IF NOT EXISTS gross_sales NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS net_sales NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS sales_by_category JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS total_tax NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_service_charge NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_discounts NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_complimentary NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_log JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS voided_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS voided_amount NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS void_log JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS cancelled_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cancelled_amount NUMERIC(10, 2) DEFAULT 0;
