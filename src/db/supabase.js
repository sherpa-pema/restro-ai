/**
 * Supabase Client & Cloud Operations — TableCraft OS
 * 
 * Handles all communication with the Supabase backend:
 * push (upsert/insert), pull (select), and realtime subscriptions.
 */

import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// Client Initialization
// ─────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ahfuhaujycwnztryzpab.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

/**
 * Test the Supabase connection and perform initial setup.
 * @returns {Promise<boolean>} true if connection is successful
 */
export async function initSupabase() {
  try {
    // Simple connectivity test — query the tables table with a limit of 1
    const { error } = await supabase.from('tables').select('id').limit(1);
    if (error) {
      console.warn('[Supabase] Connection test returned error:', error.message);
      // Non-fatal — table might not exist yet
      return true;
    }
    console.log('[Supabase] Connection established successfully.');
    return true;
  } catch (err) {
    console.error('[Supabase] Failed to initialize:', err);
    return false;
  }
}

// ─────────────────────────────────────────────
// Push Functions (Local → Cloud)
// ─────────────────────────────────────────────

/** Upsert a table record to Supabase. */
export async function pushTable(table) {
  try {
    const dbTable = {
      id: table.id,
      name: table.name,
      seats: table.seats,
      status: table.status,
      category: table.category || 'Indoor',
      type: table.type || null,
      channel: table.channel || null,
      current_order_id: table.current_order_id,
      updated_at: table.updated_at
    };
    const { error } = await supabase
      .from('tables')
      .upsert(dbTable, { onConflict: 'id' });
    if (error) {
      console.error('[Supabase] pushTable database error:', error.message, '| Details:', error.details, '| Hint:', error.hint);
      throw error;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] pushTable failed for table:', table, 'Error:', err);
    throw err;
  }
}

/** Upsert a menu item to Supabase. */
export async function pushMenuItem(item) {
  try {
    const dbItem = {
      id: item.id,
      name: item.name,
      description: item.description || null,
      image_url: item.image_url || null,
      price: item.price,
      category: item.category,
      variants: item.variants || [],
      is_active: item.is_active,
      created_at: item.created_at
    };
    const { error } = await supabase
      .from('menu_items')
      .upsert(dbItem, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushMenuItem failed:', err);
    throw err;
  }
}

/** Upload an image for a menu item to Supabase Storage */
export async function uploadMenuImage(file, category, itemName) {
  try {
    // Sanitize category and name for safe file paths
    const safeCategory = (category || 'Uncategorized').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const safeName = (itemName || 'item').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileExt = file.name.split('.').pop();
    
    // Create a path like: "drinks/mojito_16843920.jpg" to avoid collisions if name is same
    const fileName = `${safeCategory}/${safeName}_${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('menu-images')
      .upload(fileName, file, { upsert: true });
      
    if (error) throw error;
    
    // Get the public URL
    const { data: publicUrlData } = supabase.storage
      .from('menu-images')
      .getPublicUrl(fileName);
      
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('[Supabase] uploadMenuImage failed:', err);
    return null;
  }
}

/** Upsert an order to Supabase. */
export async function pushOrder(order) {
  try {
    // Include channel so it persists in Supabase
    const dbOrder = {
      id: order.id,
      table_id: order.table_id,
      bill_number: order.bill_number,
      status: order.status,
      subtotal: order.subtotal,
      tax: order.tax,
      service_charge: order.service_charge,
      discount: order.discount,
      discount_type: order.discount_type || 'none',
      discount_reason: order.discount_reason || null,
      discount_applied_by: order.discount_applied_by || null,
      total: order.total,
      waiter_id: order.waiter_id || null,
      waiter_name: order.waiter_name || null,
      channel: order.channel || null,
      created_at: order.created_at,
      paid_at: order.paid_at
    };
    const { error } = await supabase
      .from('orders')
      .upsert(dbOrder, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushOrder failed:', err);
    throw err;
  }
}


/** Upsert an order item to Supabase. */
export async function pushOrderItem(item) {
  try {
    const dbItem = {
      id: item.id,
      order_id: item.order_id,
      menu_item_id: item.menu_item_id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      category: item.category || 'General'
    };
    const { error } = await supabase
      .from('order_items')
      .upsert(dbItem, { onConflict: 'id' });

    if (error) {
      if (error.code === '23503' || (error.message && error.message.includes('order_items_order_id_fkey'))) {
        const { getOrder } = await import('./indexedDB.js');
        const parentOrder = await getOrder(item.order_id);
        if (parentOrder) {
          const parentSuccess = await pushOrder(parentOrder);
          if (parentSuccess) {
            const { error: retryErr } = await supabase
              .from('order_items')
              .upsert(dbItem, { onConflict: 'id' });
            if (!retryErr) return true;
          }
        }
      }
      throw error;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] pushOrderItem failed:', err);
    throw err;
  }
}

/** Insert a transaction record to Supabase. */
export async function pushTransaction(tx) {
  try {
    const dbTx = {
      id: tx.id,
      order_id: tx.order_id,
      table_name: tx.table_name,
      amount: tx.amount,
      payment_method: tx.payment_method,
      currency: tx.currency,
      category: tx.category || 'Dine-in',
      waiter_name: tx.waiter_name || null,
      paid_at: tx.paid_at
    };
    const { error } = await supabase
      .from('transactions')
      .upsert(dbTx, { onConflict: 'id' });

    if (error) {
      if (error.code === '23503' || (error.message && error.message.includes('transactions_order_id_fkey'))) {
        if (tx.order_id) {
          const { getOrder } = await import('./indexedDB.js');
          const parentOrder = await getOrder(tx.order_id);
          if (parentOrder) {
            const parentSuccess = await pushOrder(parentOrder);
            if (parentSuccess) {
              const { error: retryErr } = await supabase
                .from('transactions')
                .upsert(dbTx, { onConflict: 'id' });
              if (!retryErr) return true;
            }
          }
        }
      }
      throw error;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] pushTransaction failed:', err);
    throw err;
  }
}

/** Upsert a void/cancellation log record to Supabase. */
export async function pushOrderVoid(record) {
  try {
    const dbRecord = {
      id: record.id,
      order_id: record.order_id || null,
      table_name: record.table_name || null,
      void_type: record.void_type,
      amount: record.amount,
      reason: record.reason || null,
      voided_by: record.voided_by || null,
      voided_at: record.voided_at
    };
    const { error } = await supabase
      .from('order_voids')
      .upsert(dbRecord, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushOrderVoid failed:', err);
    throw err;
  }
}

/** Delete a record by ID from the specified Supabase table. */
export async function deleteFromSupabase(tableName, id) {
  try {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`[Supabase] deleteFromSupabase(${tableName}) failed:`, err);
    return null;
  }
}

// ─────────────────────────────────────────────
// Pull Functions (Cloud → Local)
// ─────────────────────────────────────────────

/** Pull all tables from Supabase. */
export async function pullTables() {
  try {
    const { data, error } = await supabase
      .from('tables')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullTables failed:', err);
    return null;
  }
}

/** Pull active menu items from Supabase. */
export async function pullMenuItems() {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_active', true);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullMenuItems failed:', err);
    return null;
  }
}

/** Pull all orders from Supabase. */
export async function pullOrders() {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullOrders failed:', err);
    return null;
  }
}

/** Pull order items for a specific order from Supabase. */
export async function pullOrderItems(orderId) {
  try {
    const { data, error } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullOrderItems failed:', err);
    return null;
  }
}

/** Pull recent transactions from Supabase (fetches up to 1000 to ensure all of today's and recent history are included). */
export async function pullTransactions() {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('paid_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullTransactions failed:', err);
    return null;
  }
}

/** Upsert an inventory item to Supabase. */
export async function pushInventory(item) {
  try {
    const dbItem = {
      id: item.id,
      ingredient_name: item.ingredient_name,
      category: item.category || 'General',
      current_stock: item.current_stock,
      unit: item.unit,
      reorder_threshold: item.reorder_threshold,
      unit_cost: item.unit_cost,
      supplier_id: item.supplier_id || null,
      updated_at: item.updated_at
    };
    const { error } = await supabase
      .from('inventory')
      .upsert(dbItem, { onConflict: 'id' });

    if (error) {
      if (error.code === '23505' || (error.message && error.message.includes('inventory_ingredient_name_key'))) {
        const { error: updateErr } = await supabase
          .from('inventory')
          .update({
            current_stock: dbItem.current_stock,
            unit: dbItem.unit,
            reorder_threshold: dbItem.reorder_threshold,
            unit_cost: dbItem.unit_cost,
            supplier_id: dbItem.supplier_id,
            updated_at: dbItem.updated_at
          })
          .eq('ingredient_name', item.ingredient_name);
        if (!updateErr) return true;
      }
      throw error;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] pushInventory failed:', err);
    throw err;
  }
}

/** Pull all inventory items from Supabase. */
export async function pullInventory() {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullInventory failed:', err);
    return null;
  }
}

/** Insert a waste log to Supabase. */
export async function pushWaste(log) {
  try {
    const dbLog = {
      id: log.id,
      ingredient_id: log.ingredient_id,
      ingredient_name: log.ingredient_name,
      quantity: log.quantity,
      cost: log.cost,
      wasted_at: log.wasted_at,
      reason: log.reason
    };
    const { error } = await supabase
      .from('waste')
      .upsert(dbLog, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushWaste failed:', err);
    throw err;
  }
}

/** Pull recent waste logs from Supabase. */
export async function pullWaste() {
  try {
    const { data, error } = await supabase
      .from('waste')
      .select('*')
      .order('wasted_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullWaste failed:', err);
    return null;
  }
}

/** Upsert a supplier to Supabase. */
export async function pushSupplier(supplier) {
  try {
    const dbSupplier = {
      id: supplier.id,
      name: supplier.name,
      contact_person: supplier.contact_person,
      phone: supplier.phone,
      email: supplier.email,
      delivery_days: supplier.delivery_days,
      updated_at: supplier.updated_at
    };
    const { error } = await supabase
      .from('suppliers')
      .upsert(dbSupplier, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushSupplier failed:', err);
    throw err;
  }
}

/** Pull all suppliers from Supabase. */
export async function pullSuppliers() {
  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullSuppliers failed:', err);
    return null;
  }
}

/** Upsert a recipe to Supabase. */
export async function pushRecipe(recipe) {
  try {
    const dbRecipe = {
      id: recipe.id,
      menu_item_id: recipe.menu_item_id,
      ingredient_id: recipe.ingredient_id,
      quantity: recipe.quantity,
      updated_at: recipe.updated_at
    };
    const { error } = await supabase
      .from('recipes')
      .upsert(dbRecipe, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushRecipe failed:', err);
    throw err;
  }
}

/** Pull all recipes from Supabase. */
export async function pullRecipes() {
  try {
    const { data, error } = await supabase
      .from('recipes')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullRecipes failed:', err);
    return null;
  }
}

/** Pull restaurant profile from Supabase. */
export async function pullRestaurantProfile() {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.error('[Supabase] pullRestaurantProfile failed:', err);
    return null;
  }
}

/** Push restaurant profile to Supabase. */
export async function pushRestaurantProfile(restaurant) {
  try {
    const dbRestaurant = {
      id: restaurant.id,
      business_name: restaurant.business_name,
      address: restaurant.address,
      pan_vat_number: restaurant.pan_vat_number,
      telephone_number: restaurant.telephone_number,
      email: restaurant.email,
      service_charge: restaurant.service_charge,
      tax_percent: restaurant.tax_percent,
      contact_person: restaurant.contact_person,
      contact_person_number: restaurant.contact_person_number,
      updated_at: new Date().toISOString()
    };
    
    // We expect only 1 row typically, so upsert handles it via the id
    const { error } = await supabase
      .from('restaurants')
      .upsert(dbRestaurant, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushRestaurantProfile failed:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// Auth / Staff Profiles
// ─────────────────────────────────────────────

/** Pull all staff profiles from Supabase. */
export async function pullStaffProfiles() {
  try {
    const { data, error } = await supabase
      .from('staff_profiles')
      .select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] pullStaffProfiles failed:', err);
    return null;
  }
}

/** Push a staff profile to Supabase. */
export async function pushStaffProfile(profile) {
  try {
    const dbProfile = {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      is_active: profile.is_active,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('staff_profiles')
      .upsert(dbProfile, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] pushStaffProfile failed:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// Realtime Subscriptions
// ─────────────────────────────────────────────

/**
 * Subscribe to realtime changes on all core tables.
 * @param {{ onTableChange: Function, onMenuChange: Function, onOrderChange: Function, onOrderItemChange: Function, onInventoryChange: Function, onWasteChange: Function, onSupplierChange: Function, onRecipeChange: Function, onRestaurantChange: Function, onStaffProfileChange: Function }} callbacks
 * @returns {import('@supabase/supabase-js').RealtimeChannel} The channel for cleanup
 */
export function subscribeToChanges(callbacks) {
  const { onTableChange, onMenuChange, onOrderChange, onOrderItemChange, onInventoryChange, onWasteChange, onSupplierChange, onRecipeChange, onRestaurantChange, onStaffProfileChange } = callbacks;

  const channel = supabase
    .channel('tablecraft-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tables' },
      (payload) => {
        console.log('[Realtime] tables change:', payload.eventType);
        if (onTableChange) onTableChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_items' },
      (payload) => {
        console.log('[Realtime] menu_items change:', payload.eventType);
        if (onMenuChange) onMenuChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('[Realtime] orders change:', payload.eventType);
        if (onOrderChange) onOrderChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      (payload) => {
        console.log('[Realtime] order_items change:', payload.eventType);
        if (onOrderItemChange) onOrderItemChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory' },
      (payload) => {
        console.log('[Realtime] inventory change:', payload.eventType);
        if (onInventoryChange) onInventoryChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'waste' },
      (payload) => {
        console.log('[Realtime] waste change:', payload.eventType);
        if (onWasteChange) onWasteChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'suppliers' },
      (payload) => {
        console.log('[Realtime] suppliers change:', payload.eventType);
        if (onSupplierChange) onSupplierChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'recipes' },
      (payload) => {
        console.log('[Realtime] recipes change:', payload.eventType);
        if (onRecipeChange) onRecipeChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'restaurants' },
      (payload) => {
        console.log('[Realtime] restaurants change:', payload.eventType);
        if (onRestaurantChange) onRestaurantChange(payload);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'staff_profiles' },
      (payload) => {
        console.log('[Realtime] staff_profiles change:', payload.eventType);
        if (onStaffProfileChange) onStaffProfileChange(payload);
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Subscription status:', status);
    });

  return channel;
}

/**
 * Check if the day is already closed (has a 'sent' report) for the current business date.
 * Uses a heuristic: if a 'sent' report was generated within the last 16 hours, it's considered closed.
 */
export async function checkIfDayClosed(restaurantId) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from('daily_closing_reports')
      .select('business_date, status, generated_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'sent')
      .order('generated_at', { ascending: false })
      .limit(1);
      
    if (error) throw error;
    
    if (data && data.length > 0) {
      const generated = new Date(data[0].generated_at);
      const now = new Date();
      const diffHours = (now - generated) / (1000 * 60 * 60);
      if (diffHours < 16) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('[Supabase] Failed to check if day closed:', err);
    return false;
  }
}

// ─────────────────────────────────────────────
// End of Day Closing Ops (Client-Side DB ops)
// ─────────────────────────────────────────────

/**
 * Generate a comprehensive closing report from Supabase records.
 */
export async function generateClosingReport(restaurantId) {
  try {
    // 1. Get transactions for today
    const { data: txData } = await supabase.from('transactions').select('*');
    // 2. Get completed orders today
    const { data: orderData } = await supabase.from('orders').select('*');
    const completedOrders = (orderData || []).filter(o => o.status === 'paid');
    
    // 3. Get order_items for completed orders
    const orderIds = completedOrders.map(o => o.id);
    let orderItemsData = [];
    if (orderIds.length > 0) {
      const { data: items } = await supabase.from('order_items').select('*').in('order_id', orderIds);
      orderItemsData = items || [];
    }
    
    // 4. Get order_voids
    const { data: voidsData } = await supabase.from('order_voids').select('*');
    
    // Aggregations
    let grossSales = 0;
    let netSales = 0;
    let totalTax = 0;
    let totalServiceCharge = 0;
    let totalDiscounts = 0;
    const salesByCategory = {};
    const paymentBreakdown = {};
    const discountLogs = [];
    let voidedCount = 0;
    let voidedAmount = 0;
    let complimentaryCount = 0;
    let complimentaryAmount = 0;
    
    // Categories
    orderItemsData.forEach(item => {
      const cat = item.category || 'General';
      salesByCategory[cat] = (salesByCategory[cat] || 0) + Number(item.price || 0) * (item.quantity || 1);
    });
    
    // Orders / Discounts
    completedOrders.forEach(o => {
      grossSales += Number(o.subtotal || 0);
      totalTax += Number(o.tax || 0);
      totalServiceCharge += Number(o.service_charge || 0);
      
      const disc = Number(o.discount || 0);
      totalDiscounts += disc;
      if (disc > 0 && o.discount_type !== 'none') {
        discountLogs.push({
          order_id: o.id,
          amount: disc,
          type: o.discount_type,
          reason: o.discount_reason,
          by: o.discount_applied_by
        });
      }
      
      if (o.discount_type === 'complimentary') {
        complimentaryCount++;
        complimentaryAmount += disc;
      }
    });
    netSales = Math.max(0, grossSales - totalDiscounts);
    
    // Payments
    (txData || []).forEach(tx => {
      const pm = tx.payment_method || 'other';
      paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + Number(tx.amount || 0);
    });
    
    // Voids
    const voids = voidsData || [];
    voidedCount = voids.length;
    voidedAmount = voids.reduce((sum, v) => sum + Number(v.amount || 0), 0);
    
    return {
      restaurant_id: restaurantId,
      business_date: new Date().toISOString().split('T')[0],
      total_revenue: netSales + totalTax + totalServiceCharge,
      transaction_count: (txData || []).length,
      gross_sales: grossSales,
      net_sales: netSales,
      total_tax: totalTax,
      total_service_charge: totalServiceCharge,
      total_discounts: totalDiscounts,
      total_complimentary: complimentaryAmount,
      sales_by_category: salesByCategory,
      breakdown_by_payment_method: paymentBreakdown,
      discount_log: discountLogs,
      voided_count: voidedCount,
      voided_amount: voidedAmount,
      void_log: voids,
      status: 'sent'
    };
  } catch (err) {
    console.error('[Supabase] generateClosingReport failed:', err);
    throw err;
  }
}

/**
 * Move all transactions to transactions_backup and empty transactions table.
 */
export async function archiveTransactions(businessDate) {
  try {
    // 1. Fetch all transactions
    const { data: txData, error: fetchErr } = await supabase.from('transactions').select('*');
    if (fetchErr) throw fetchErr;
    if (!txData || txData.length === 0) return true; // Nothing to archive
    
    // 2. Add business_date and insert to backup
    const backupData = txData.map(tx => ({ ...tx, business_date: businessDate }));
    const { error: insertErr } = await supabase.from('transactions_backup').insert(backupData);
    if (insertErr) throw insertErr;
    
    // 3. Delete from transactions in batches if necessary, but typically < 1000 so one go is fine
    const txIds = txData.map(t => t.id);
    const { error: deleteErr } = await supabase.from('transactions').delete().in('id', txIds);
    if (deleteErr) throw deleteErr;
    
    return true;
  } catch (err) {
    console.error('[Supabase] archiveTransactions failed:', err);
    throw err;
  }
}

/**
 * Save the generated report to daily_closing_reports.
 */
export async function saveClosingReport(reportData) {
  try {
    const { error } = await supabase.from('daily_closing_reports').insert([reportData]);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] saveClosingReport failed:', err);
    throw err;
  }
}
