-- 1. Create transactions_backup table mirroring the transactions table
--    but adding a business_date column to track which closing day it belongs to.
CREATE TABLE IF NOT EXISTS transactions_backup (
  id UUID PRIMARY KEY,
  order_id UUID,
  table_name TEXT,
  bill_number TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NPR',
  category TEXT DEFAULT 'Dine-in',
  waiter_name TEXT,
  paid_at TIMESTAMPTZ,
  business_date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Enable RLS for transactions_backup
ALTER TABLE transactions_backup ENABLE ROW LEVEL SECURITY;

-- Create open policy
DROP POLICY IF EXISTS "Allow all on transactions_backup" ON transactions_backup;
CREATE POLICY "Allow all on transactions_backup" ON transactions_backup FOR ALL USING (true) WITH CHECK (true);
