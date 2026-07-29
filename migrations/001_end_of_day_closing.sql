-- 1. Alter restaurants table to add end of day fields
ALTER TABLE restaurants 
ADD COLUMN IF NOT EXISTS closing_time TIME DEFAULT '21:00',
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kathmandu';

-- 2. Create daily_closing_reports table
CREATE TABLE IF NOT EXISTS daily_closing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  opening_bill_number TEXT,
  closing_bill_number TEXT,
  total_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  breakdown_by_payment_method JSONB DEFAULT '{}'::jsonb,
  pdf_url TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed'))
);

-- Enable RLS for daily_closing_reports
ALTER TABLE daily_closing_reports ENABLE ROW LEVEL SECURITY;

-- Create policy
DROP POLICY IF EXISTS "Allow all on daily_closing_reports" ON daily_closing_reports;
CREATE POLICY "Allow all on daily_closing_reports" ON daily_closing_reports FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for daily_closing_reports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'daily_closing_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE daily_closing_reports;
  END IF;
END $$;

-- 3. Create an RPC function to read and increment the bill number sequence
CREATE OR REPLACE FUNCTION get_next_bill_number()
RETURNS TEXT AS $$
BEGIN
  RETURN lpad(nextval('orders_bill_number_seq')::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- 4. Create an RPC function to reset the bill sequence to 1
CREATE OR REPLACE FUNCTION reset_bill_sequence()
RETURNS void AS $$
BEGIN
  ALTER SEQUENCE orders_bill_number_seq RESTART WITH 1;
END;
$$ LANGUAGE plpgsql;
