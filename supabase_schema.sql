-- TableCraft OS — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Tables (floor map)
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  seats INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied')),
  category TEXT NOT NULL DEFAULT 'Indoor',
  type TEXT,
  channel TEXT,
  current_order_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Menu Items
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price NUMERIC(10, 2) NOT NULL,
  category TEXT DEFAULT 'General',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Orders
CREATE SEQUENCE IF NOT EXISTS orders_bill_number_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  bill_number TEXT NOT NULL DEFAULT lpad(nextval('orders_bill_number_seq')::text, 3, '0'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(10, 2) NOT NULL DEFAULT 0,
  service_charge NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  waiter_id UUID,
  waiter_name TEXT,
  channel TEXT
);

-- 4. Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
);

-- 5. Transactions (payment history)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  bill_number TEXT,
  table_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  currency TEXT NOT NULL DEFAULT 'NPR',
  category TEXT NOT NULL DEFAULT 'Dine-in',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (allow all for internal POS)
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: allow full access for anon key (internal tool)
CREATE POLICY "Allow all on tables" ON tables FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on menu_items" ON menu_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE tables;
ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;

-- Seed: Default 10 tables
INSERT INTO tables (name, seats, status, category) VALUES
  ('T1', 2, 'available', 'Indoor'),
  ('T2', 4, 'available', 'Indoor'),
  ('T3', 4, 'available', 'Indoor'),
  ('T4', 6, 'available', 'Indoor'),
  ('T5', 2, 'available', 'Indoor'),
  ('T6', 4, 'available', 'Indoor'),
  ('T7', 6, 'available', 'Indoor'),
  ('T8', 4, 'available', 'Indoor'),
  ('T9', 4, 'available', 'Patio'),
  ('T10', 6, 'available', 'VIP')
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, seats = EXCLUDED.seats;

-- Seed: Default menu items
INSERT INTO menu_items (name, emoji, price, category) VALUES
  ('Chicken Burger', '🍔', 8.50, 'Main'),
  ('Veg Pizza', '🍕', 11.00, 'Main'),
  ('Chicken Momo', '🥟', 6.50, 'Starter'),
  ('French Fries', '🍟', 3.50, 'Side'),
  ('Coke', '🥤', 2.00, 'Beverage'),
  ('Chicken Biryani', '🍛', 12.50, 'Main'),
  ('Caesar Salad', '🥗', 7.00, 'Starter'),
  ('Margherita Pizza', '🍕', 10.00, 'Main'),
  ('Lemonade', '🍋', 2.50, 'Beverage'),
  ('Chocolate Cake', '🍰', 5.00, 'Dessert')
ON CONFLICT DO NOTHING;

-- 6. Suppliers (vendor profiles)
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  delivery_days TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Inventory (ingredients list)
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'General',
  current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  reorder_threshold NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Waste Log
CREATE TABLE IF NOT EXISTS waste (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID REFERENCES inventory(id) ON DELETE SET NULL,
  ingredient_name TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  wasted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Recipes (menu item ingredients mapping)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, ingredient_id)
);

-- Enable Row Level Security
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Allow all on suppliers" ON suppliers;
CREATE POLICY "Allow all on suppliers" ON suppliers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on inventory" ON inventory;
CREATE POLICY "Allow all on inventory" ON inventory FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on waste" ON waste;
CREATE POLICY "Allow all on waste" ON waste FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on recipes" ON recipes;
CREATE POLICY "Allow all on recipes" ON recipes FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'suppliers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE suppliers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'inventory'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'waste'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE waste;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'recipes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE recipes;
  END IF;
END $$;

-- 10. Add Variants support
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;

-- 11. Restaurants (Client Onboarding Information)
CREATE TABLE IF NOT EXISTS restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  pan_vat_number TEXT,
  telephone_number TEXT,
  email TEXT,
  service_charge NUMERIC(5, 2) DEFAULT 0,
  tax_percent NUMERIC(5, 2) DEFAULT 0,
  contact_person TEXT,
  contact_person_number TEXT,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Allow all on restaurants" ON restaurants;
CREATE POLICY "Allow all on restaurants" ON restaurants FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'restaurants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE restaurants;
  END IF;
END $$;

-- 12. Trigger to sync bill_number from orders to transactions
CREATE OR REPLACE FUNCTION set_transaction_bill_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bill_number IS NULL THEN
    SELECT bill_number INTO NEW.bill_number
    FROM orders
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_transaction_bill_number ON transactions;
CREATE TRIGGER trg_set_transaction_bill_number
BEFORE INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION set_transaction_bill_number();

-- 13. Staff Profiles
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'waiter', 'kitchen', 'cashier')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all profiles (so Admin can list staff, Waiter can see others, etc.)
CREATE POLICY "Allow authenticated to read staff_profiles" ON staff_profiles FOR SELECT TO authenticated USING (true);

-- Allow users to update their own profile, or admins to update anyone
CREATE POLICY "Allow admin and self to update staff_profiles" ON staff_profiles FOR UPDATE TO authenticated USING (
  auth.uid() = id OR EXISTS (
    SELECT 1 FROM staff_profiles sp WHERE sp.id = auth.uid() AND sp.role = 'admin'
  )
);

-- Allow authenticated to insert (when first signing up, or admin creating a new user)
CREATE POLICY "Allow authenticated to insert staff_profiles" ON staff_profiles FOR INSERT TO authenticated WITH CHECK (true);

-- Allow admin to delete
CREATE POLICY "Allow admin to delete staff_profiles" ON staff_profiles FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM staff_profiles sp WHERE sp.id = auth.uid() AND sp.role = 'admin'
  )
);

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    WHERE p.pubname = 'supabase_realtime' AND c.relname = 'staff_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE staff_profiles;
  END IF;
END $$;

