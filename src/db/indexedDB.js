/**
 * IndexedDB Database Manager — TableCraft OS
 * 
 * High-performance local storage powered by Dexie.js.
 * All data is persisted locally and synced to Supabase via the sync engine.
 */

import { v4 as uuidv4 } from 'uuid';
import { getLocalDateString } from '../state.js';
import { db, initDexieDB } from './dexieDB.js';

export { db };

// ─────────────────────────────────────────────
// Database Initialization & Backward Compatibility
// ─────────────────────────────────────────────

/**
 * Ensures the Dexie database is ready and returns the instance.
 */
export async function initDB() {
  await initDexieDB();
  return getDB();
}

/**
 * Returns the current database instance with backward compatibility helpers.
 */
export function getDB() {
  if (!db) {
    throw new Error('IndexedDB not initialized. Call initDB() first.');
  }

  // Attach legacy idb helper methods onto db object if not present
  if (!db.getAll) {
    db.getAll = (storeName) => db.table(storeName).toArray();
    db.get = (storeName, id) => db.table(storeName).get(id);
    db.put = (storeName, val) => db.table(storeName).put(val);
    db.add = (storeName, val) => db.table(storeName).add(val);
    db.delete = (storeName, id) => db.table(storeName).delete(id);
    db.clear = (storeName) => db.table(storeName).clear();
    db.getAllFromIndex = (storeName, indexName, key) =>
      db.table(storeName).where(indexName).equals(key).toArray();
  }

  return db;
}

// ─────────────────────────────────────────────
// Tables CRUD
// ─────────────────────────────────────────────

/** Get all restaurant tables. */
export async function getAllTables() {
  return db.table('tables').toArray();
}

/** Get a single table by ID. */
export async function getTable(id) {
  return db.table('tables').get(id);
}

/** Insert or update a table record. */
export async function upsertTable(table) {
  await db.table('tables').put(table);
}

/** Delete a table by ID. */
export async function deleteTable(id) {
  await db.table('tables').delete(id);
}

// ─────────────────────────────────────────────
// Menu Items CRUD
// ─────────────────────────────────────────────

/** Get all menu items. */
export async function getAllMenuItems() {
  return db.table('menuItems').toArray();
}

/** Add a menu item. Generates an ID if not provided. Returns the ID. */
export async function addMenuItem(item) {
  const record = { ...item, id: item.id || uuidv4() };
  await db.table('menuItems').put(record);
  return record.id;
}

/** Delete a menu item by ID. */
export async function deleteMenuItem(id) {
  await db.table('menuItems').delete(id);
}

// ─────────────────────────────────────────────
// Orders CRUD
// ─────────────────────────────────────────────

/** Get a single order by ID. */
export async function getOrder(id) {
  return db.table('orders').get(id);
}

/**
 * Find the open order for a given table.
 * Uses the 'table_id' index and filters for status === 'open'.
 */
export async function getOrderByTable(tableId) {
  if (!tableId) return null;
  try {
    const allForTable = await db.table('orders').where('table_id').equals(tableId).toArray();
    return allForTable.find((order) => order.status === 'open') || null;
  } catch (err) {
    console.warn('[IndexedDB] getOrderByTable fallback:', err);
    const all = await db.table('orders').toArray();
    return all.find((order) => order.table_id === tableId && order.status === 'open') || null;
  }
}

/**
 * Get all orders for a specific table ID.
 */
export async function getAllOrdersByTable(tableId) {
  if (!tableId) return [];
  try {
    return await db.table('orders').where('table_id').equals(tableId).toArray();
  } catch (err) {
    console.warn('[IndexedDB] getAllOrdersByTable fallback:', err);
    const all = await db.table('orders').toArray();
    return all.filter((order) => order.table_id === tableId);
  }
}

/** Create a new order (put). */
export async function createOrder(order) {
  order.id = order.id || uuidv4();

  if (!order.bill_number) {
    try {
      const serverHost = window.location.hostname;
      const res = await fetch(`http://${serverHost}:8000/next-bill`);
      if (res.ok) {
        const data = await res.json();
        if (data.bill_no) {
          order.bill_number = data.bill_no;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch bill number from Python server. Falling back to local DB.", err);
    }

    if (!order.bill_number) {
      const all = await db.table('orders').toArray();
      let max = 0;
      for (const o of all) {
        if (o.bill_number) {
          const num = parseInt(o.bill_number, 10);
          if (!isNaN(num) && num > max) {
            max = num;
          }
        }
      }
      order.bill_number = String(max + 1).padStart(3, '0');
    }
  }

  const record = { ...order };
  await db.table('orders').put(record);
}

/** Update an existing order (put). */
export async function updateOrder(order) {
  await db.table('orders').put(order);
}

/** Delete an order by ID. */
export async function deleteOrder(id) {
  await db.table('orders').delete(id);
}

/** Get all orders. */
export async function getAllOrders() {
  return db.table('orders').toArray();
}

// ─────────────────────────────────────────────
// Order Items CRUD
// ─────────────────────────────────────────────

/**
 * Get all order items for a specific order.
 * Uses the 'order_id' index.
 */
export async function getOrderItems(orderId) {
  if (!orderId) return [];
  try {
    return await db.table('orderItems').where('order_id').equals(orderId).toArray();
  } catch (err) {
    console.warn('[IndexedDB] getOrderItems fallback:', err);
    const all = await db.table('orderItems').toArray();
    return all.filter((item) => item.order_id === orderId);
  }
}

/** Add an order item (put). Generates ID if not provided. */
export async function addOrderItem(item) {
  const record = { ...item, id: item.id || uuidv4() };
  await db.table('orderItems').put(record);
}

/** Remove an order item by ID. */
export async function removeOrderItem(id) {
  await db.table('orderItems').delete(id);
}

/** Update an existing order item (put). */
export async function updateOrderItem(item) {
  await db.table('orderItems').put(item);
}

// ─────────────────────────────────────────────
// Order Voids CRUD
// ─────────────────────────────────────────────

/** Add a void/cancellation log record. */
export async function addOrderVoid(record) {
  await db.table('orderVoids').put(record);
}

/** Get all void records. */
export async function getOrderVoids() {
  return db.table('orderVoids').toArray();
}

/** Get void records for a specific order. */
export async function getOrderVoidsByOrder(orderId) {
  if (!orderId) return [];
  try {
    return await db.table('orderVoids').where('order_id').equals(orderId).toArray();
  } catch (err) {
    console.warn('[IndexedDB] getOrderVoidsByOrder fallback:', err);
    const all = await db.table('orderVoids').toArray();
    return all.filter((v) => v.order_id === orderId);
  }
}

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────

/** Get all transactions. */
export async function getAllTransactions() {
  return db.table('transactions').toArray();
}

/** Add a transaction record. Generates ID if not provided. */
export async function addTransaction(tx) {
  tx.id = tx.id || uuidv4();

  if (!tx.bill_number) {
    try {
      const serverHost = window.location.hostname;
      const res = await fetch(`http://${serverHost}:8000/next-bill`);
      if (res.ok) {
        const data = await res.json();
        if (data.bill_no) {
          tx.bill_number = data.bill_no;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch bill number from Python server. Falling back to local DB.", err);
    }

    if (!tx.bill_number) {
      const all = await db.table('transactions').toArray();
      let max = 0;
      for (const t of all) {
        if (t.bill_number) {
          const num = parseInt(t.bill_number, 10);
          if (!isNaN(num) && num > max) {
            max = num;
          }
        }
      }
      tx.bill_number = String(max + 1).padStart(3, '0');
    }
  }

  const record = { ...tx };
  await db.table('transactions').put(record);
}

/**
 * Get all transactions from today.
 * Filters by comparing the date portion of paid_at to today's date.
 */
export async function getTodayTransactions() {
  const all = await db.table('transactions').toArray();
  const todayStr = getLocalDateString(new Date());
  return all.filter((tx) => {
    if (!tx.paid_at) return false;
    return getLocalDateString(tx.paid_at) === todayStr;
  });
}

/** Delete a transaction by ID. */
export async function deleteTransaction(id) {
  await db.table('transactions').delete(id);
}

// ─────────────────────────────────────────────
// Sync Queue
// ─────────────────────────────────────────────

/**
 * Add an entry to the sync queue.
 * @param {{ table: string, action: 'INSERT'|'UPDATE'|'DELETE', data: object, created_at: string }} entry
 */
export async function addToSyncQueue(entry) {
  await db.table('syncQueue').add(entry);
}

/** Get all pending sync queue entries. */
export async function getSyncQueue() {
  return db.table('syncQueue').toArray();
}

/** Remove a single entry from the sync queue by ID. */
export async function clearSyncQueueEntry(id) {
  await db.table('syncQueue').delete(id);
}

/** Clear the entire sync queue. */
export async function clearSyncQueue() {
  await db.table('syncQueue').clear();
}

// ─────────────────────────────────────────────
// Inventory CRUD
// ─────────────────────────────────────────────

/** Get all inventory items. */
export async function getAllInventory() {
  return db.table('inventory').toArray();
}

/** Insert or update an inventory item. */
export async function upsertInventory(item) {
  await db.table('inventory').put(item);
}

/** Delete an inventory item by ID. */
export async function deleteInventory(id) {
  await db.table('inventory').delete(id);
}

// ─────────────────────────────────────────────
// Waste Log CRUD
// ─────────────────────────────────────────────

/** Get all waste logs. */
export async function getAllWaste() {
  return db.table('waste').toArray();
}

/** Log a waste item. Generates an ID if not provided. */
export async function addWasteLog(log) {
  const record = { ...log, id: log.id || uuidv4() };
  await db.table('waste').put(record);
  return record.id;
}

/**
 * Get all waste logs from today.
 */
export async function getTodayWaste() {
  const all = await db.table('waste').toArray();
  const todayStr = getLocalDateString(new Date());
  return all.filter((w) => {
    if (!w.wasted_at) return false;
    return getLocalDateString(w.wasted_at) === todayStr;
  });
}

// ─────────────────────────────────────────────
// Suppliers CRUD
// ─────────────────────────────────────────────

/** Get all suppliers. */
export async function getAllSuppliers() {
  return db.table('suppliers').toArray();
}

/** Insert or update a supplier. */
export async function upsertSupplier(supplier) {
  const record = { ...supplier, id: supplier.id || uuidv4(), updated_at: new Date().toISOString() };
  await db.table('suppliers').put(record);
  return record;
}

/** Delete a supplier by ID. */
export async function deleteSupplier(id) {
  await db.table('suppliers').delete(id);
}

// ─────────────────────────────────────────────
// Recipes CRUD
// ─────────────────────────────────────────────

/** Get all recipes. */
export async function getAllRecipes() {
  return db.table('recipes').toArray();
}

/** Get recipes for a specific menu item. */
export async function getRecipesByMenuItem(menuItemId) {
  if (!menuItemId) return [];
  try {
    return await db.table('recipes').where('menu_item_id').equals(menuItemId).toArray();
  } catch (err) {
    console.warn('[IndexedDB] getRecipesByMenuItem fallback:', err);
    const all = await db.table('recipes').toArray();
    return all.filter((recipe) => recipe.menu_item_id === menuItemId);
  }
}

/** Insert or update a recipe mapping. */
export async function upsertRecipe(recipe) {
  const record = { ...recipe, id: recipe.id || uuidv4(), updated_at: new Date().toISOString() };
  await db.table('recipes').put(record);
  return record;
}

/** Delete a recipe item */
export async function deleteRecipe(id) {
  await db.table('recipes').delete(id);
}

// ─────────────────────────────────────────────
// Restaurant Settings CRUD
// ─────────────────────────────────────────────

/** Get the first restaurant profile. */
export async function getRestaurantProfile() {
  const allProfiles = await db.table('restaurants').toArray();
  return allProfiles.length > 0 ? allProfiles[0] : null;
}

/** Insert or update a restaurant profile. */
export async function upsertRestaurant(restaurant) {
  const record = { ...restaurant, id: restaurant.id || uuidv4() };
  await db.table('restaurants').put(record);
  return record.id;
}

// ─────────────────────────────────────────────
// Inventory Depletion Helper
// ─────────────────────────────────────────────

/**
 * Deducts stock from inventory based on recipe mappings of ordered items.
 * Uses a safe Dexie multi-table transaction.
 * Returns the list of updated inventory items to be queued for sync.
 * @param {string} orderId
 * @returns {Promise<Array<object>>}
 */
export async function deductInventoryForOrder(orderId) {
  return db.transaction('rw', [db.table('orderItems'), db.table('recipes'), db.table('inventory')], async () => {
    const orderItems = await getOrderItems(orderId);
    const recipes = await db.table('recipes').toArray();
    const inventory = await db.table('inventory').toArray();
    const updatedItems = [];

    for (const item of orderItems) {
      // Find recipes matching the item's menu_item_id
      const itemRecipes = recipes.filter(r => r.menu_item_id === item.menu_item_id);
      for (const recipe of itemRecipes) {
        const invItem = inventory.find(inv => inv.id === recipe.ingredient_id);
        if (invItem) {
          const qtyToDeduct = Number(recipe.quantity) * Number(item.quantity);
          invItem.current_stock = Number((Number(invItem.current_stock) - qtyToDeduct).toFixed(2));
          invItem.updated_at = new Date().toISOString();
          await db.table('inventory').put(invItem);
          updatedItems.push(invItem);
        }
      }
    }

    return updatedItems;
  });
}

/** Get or create the permanent system table for takeaway order history. */
export async function getOrCreateTakeawayArchiveTable() {
  const ARCHIVE_ID = 'da7e5a00-1ecc-4a41-b0e7-4581f1e7370a';
  let archiveTable = await db.table('tables').get(ARCHIVE_ID);
  let isNew = false;
  if (!archiveTable) {
    archiveTable = {
      id: ARCHIVE_ID,
      name: 'Takeaway-Archive',
      seats: 0,
      status: 'available',
      category: 'System',
      updated_at: new Date().toISOString()
    };
    await db.table('tables').put(archiveTable);
    isNew = true;
  }
  return { table: archiveTable, isNew };
}

/** Check if a table is a takeaway virtual table. */
export function isTakeawayTable(table) {
  if (!table) return false;
  return (
    table.type === 'takeaway' ||
    table.category === 'Takeaway' ||
    (table.name && (
      table.name.startsWith('TA-') ||
      table.name.startsWith('Foodmandu-') ||
      table.name.startsWith('Pathao-') ||
      table.name.startsWith('BhojDeals-') ||
      table.name.startsWith('Bhojdeals-')
    ))
  );
}

/** Recover takeaway channel from table name. */
export function getChannelFromTableName(name) {
  if (!name) return 'Regular';
  if (name.startsWith('Foodmandu-')) return 'Foodmandu';
  if (name.startsWith('Pathao-')) return 'Pathao';
  if (name.startsWith('BhojDeals-') || name.startsWith('Bhojdeals-')) return 'BhojDeals';
  return 'Regular';
}

// ─────────────────────────────────────────────
// Auth / Staff Profiles CRUD
// ─────────────────────────────────────────────

/** Get all staff profiles. */
export async function getAllStaffProfiles() {
  return db.table('staffProfiles').toArray();
}

/** Get a single staff profile by ID. */
export async function getStaffProfile(id) {
  return db.table('staffProfiles').get(id);
}

/** Insert or update a staff profile. */
export async function upsertStaffProfile(profile) {
  const record = { ...profile, id: profile.id || uuidv4(), updated_at: profile.updated_at || new Date().toISOString() };
  await db.table('staffProfiles').put(record);
  return record.id;
}

/** Delete a staff profile by ID. */
export async function deleteStaffProfile(id) {
  await db.table('staffProfiles').delete(id);
}

// ─────────────────────────────────────────────
// Current Session Cache
// ─────────────────────────────────────────────

/** Get the currently cached auth session. */
export async function getCurrentSession() {
  return db.table('currentSession').get('current');
}

/** Save the current auth session. */
export async function saveCurrentSession(sessionData) {
  const record = { id: 'current', ...sessionData };
  await db.table('currentSession').put(record);
}

/** Clear the current auth session (logout). */
export async function clearCurrentSession() {
  await db.table('currentSession').delete('current');
}

