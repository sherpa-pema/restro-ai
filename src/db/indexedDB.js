/**
 * IndexedDB Database Manager — TableCraft OS
 * 
 * Offline-first local database using the `idb` wrapper.
 * All data is persisted locally and synced to Supabase via the sync engine.
 */

import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';
import { getLocalDateString } from '../state.js';

const DB_NAME = 'tablecraft-os';
const DB_VERSION = 4;

/** @type {import('idb').IDBPDatabase | null} */
let db = null;

// ─────────────────────────────────────────────
// Database Initialization
// ─────────────────────────────────────────────

/**
 * Opens (or upgrades) the IndexedDB database and returns the instance.
 * Stores the instance in a module-level variable for reuse.
 */
export async function initDB() {
  if (db) return db;

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // Tables store — restaurant floor tables
      if (!database.objectStoreNames.contains('tables')) {
        database.createObjectStore('tables', { keyPath: 'id' });
      }

      // Menu Items store
      if (!database.objectStoreNames.contains('menuItems')) {
        database.createObjectStore('menuItems', { keyPath: 'id' });
      }

      // Orders store — indexed by table_id for quick lookup
      if (!database.objectStoreNames.contains('orders')) {
        const orderStore = database.createObjectStore('orders', { keyPath: 'id' });
        orderStore.createIndex('table_id', 'table_id', { unique: false });
      }

      // Order Items store — indexed by order_id
      if (!database.objectStoreNames.contains('orderItems')) {
        const orderItemStore = database.createObjectStore('orderItems', { keyPath: 'id' });
        orderItemStore.createIndex('order_id', 'order_id', { unique: false });
      }

      // Transactions store — indexed by paid_at for date queries
      if (!database.objectStoreNames.contains('transactions')) {
        const txStore = database.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('paid_at', 'paid_at', { unique: false });
      }

      // Sync Queue — auto-incrementing key for FIFO processing
      if (!database.objectStoreNames.contains('syncQueue')) {
        database.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }

      // Inventory store
      if (!database.objectStoreNames.contains('inventory')) {
        database.createObjectStore('inventory', { keyPath: 'id' });
      }

      // Waste store — indexed by wasted_at for date queries
      if (!database.objectStoreNames.contains('waste')) {
        const wasteStore = database.createObjectStore('waste', { keyPath: 'id' });
        wasteStore.createIndex('wasted_at', 'wasted_at', { unique: false });
      }

      // Suppliers store
      if (!database.objectStoreNames.contains('suppliers')) {
        database.createObjectStore('suppliers', { keyPath: 'id' });
      }

      // Recipes store — indexed by menu_item_id
      if (!database.objectStoreNames.contains('recipes')) {
        const recipeStore = database.createObjectStore('recipes', { keyPath: 'id' });
        recipeStore.createIndex('menu_item_id', 'menu_item_id', { unique: false });
      }

      // Restaurants store
      if (!database.objectStoreNames.contains('restaurants')) {
        database.createObjectStore('restaurants', { keyPath: 'id' });
      }
    },
  });


  return db;
}

/**
 * Returns the current database instance.
 * Throws if initDB() hasn't been called yet.
 */
export function getDB() {
  if (!db) {
    throw new Error('IndexedDB not initialized. Call initDB() first.');
  }
  return db;
}

// ─────────────────────────────────────────────
// Tables CRUD
// ─────────────────────────────────────────────

/** Get all restaurant tables. */
export async function getAllTables() {
  const database = getDB();
  return database.getAll('tables');
}

/** Get a single table by ID. */
export async function getTable(id) {
  const database = getDB();
  return database.get('tables', id);
}

/** Insert or update a table record. */
export async function upsertTable(table) {
  const database = getDB();
  await database.put('tables', table);
}

/** Delete a table by ID. */
export async function deleteTable(id) {
  const database = getDB();
  await database.delete('tables', id);
}

// ─────────────────────────────────────────────
// Menu Items CRUD
// ─────────────────────────────────────────────

/** Get all menu items. */
export async function getAllMenuItems() {
  const database = getDB();
  return database.getAll('menuItems');
}

/** Add a menu item. Generates an ID if not provided. Returns the ID. */
export async function addMenuItem(item) {
  const database = getDB();
  const record = { ...item, id: item.id || uuidv4() };
  await database.put('menuItems', record);
  return record.id;
}

/** Delete a menu item by ID. */
export async function deleteMenuItem(id) {
  const database = getDB();
  await database.delete('menuItems', id);
}

// ─────────────────────────────────────────────
// Orders CRUD
// ─────────────────────────────────────────────

/** Get a single order by ID. */
export async function getOrder(id) {
  const database = getDB();
  return database.get('orders', id);
}

/**
 * Find the open order for a given table.
 * Uses the 'table_id' index and filters for status === 'open'.
 */
export async function getOrderByTable(tableId) {
  const database = getDB();
  const allForTable = await database.getAllFromIndex('orders', 'table_id', tableId);
  return allForTable.find((order) => order.status === 'open') || null;
}

/** Create a new order (put). */
export async function createOrder(order) {
  const database = getDB();
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
      const all = await database.getAll('orders');
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
  await database.put('orders', record);
}

/** Update an existing order (put). */
export async function updateOrder(order) {
  const database = getDB();
  await database.put('orders', order);
}

/** Delete an order by ID. */
export async function deleteOrder(id) {
  const database = getDB();
  await database.delete('orders', id);
}

/** Get all orders. */
export async function getAllOrders() {
  const database = getDB();
  return database.getAll('orders');
}

// ─────────────────────────────────────────────
// Order Items CRUD
// ─────────────────────────────────────────────

/**
 * Get all order items for a specific order.
 * Uses the 'order_id' index.
 */
export async function getOrderItems(orderId) {
  const database = getDB();
  return database.getAllFromIndex('orderItems', 'order_id', orderId);
}

/** Add an order item (put). Generates ID if not provided. */
export async function addOrderItem(item) {
  const database = getDB();
  const record = { ...item, id: item.id || uuidv4() };
  await database.put('orderItems', record);
}

/** Remove an order item by ID. */
export async function removeOrderItem(id) {
  const database = getDB();
  await database.delete('orderItems', id);
}

/** Update an existing order item (put). */
export async function updateOrderItem(item) {
  const database = getDB();
  await database.put('orderItems', item);
}

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────

/** Get all transactions. */
export async function getAllTransactions() {
  const database = getDB();
  return database.getAll('transactions');
}

/** Add a transaction record. Generates ID if not provided. */
export async function addTransaction(tx) {
  const database = getDB();
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
      const all = await database.getAll('transactions');
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
  await database.put('transactions', record);
}

/**
 * Get all transactions from today.
 * Filters by comparing the date portion of paid_at to today's date.
 */
export async function getTodayTransactions() {
  const database = getDB();
  const all = await database.getAll('transactions');
  const todayStr = getLocalDateString(new Date());
  return all.filter((tx) => {
    if (!tx.paid_at) return false;
    return getLocalDateString(tx.paid_at) === todayStr;
  });
}

/** Delete a transaction by ID. */
export async function deleteTransaction(id) {
  const database = getDB();
  await database.delete('transactions', id);
}

// ─────────────────────────────────────────────
// Sync Queue
// ─────────────────────────────────────────────

/**
 * Add an entry to the sync queue.
 * @param {{ table: string, action: 'INSERT'|'UPDATE'|'DELETE', data: object, created_at: string }} entry
 */
export async function addToSyncQueue(entry) {
  const database = getDB();
  await database.add('syncQueue', entry);
}

/** Get all pending sync queue entries. */
export async function getSyncQueue() {
  const database = getDB();
  return database.getAll('syncQueue');
}

/** Remove a single entry from the sync queue by ID. */
export async function clearSyncQueueEntry(id) {
  const database = getDB();
  await database.delete('syncQueue', id);
}

/** Clear the entire sync queue. */
export async function clearSyncQueue() {
  const database = getDB();
  await database.clear('syncQueue');
}

// ─────────────────────────────────────────────
// Inventory CRUD
// ─────────────────────────────────────────────

/** Get all inventory items. */
export async function getAllInventory() {
  const database = getDB();
  return database.getAll('inventory');
}

/** Insert or update an inventory item. */
export async function upsertInventory(item) {
  const database = getDB();
  await database.put('inventory', item);
}

// ─────────────────────────────────────────────
// Waste Log CRUD
// ─────────────────────────────────────────────

/** Get all waste logs. */
export async function getAllWaste() {
  const database = getDB();
  return database.getAll('waste');
}

/** Log a waste item. Generates an ID if not provided. */
export async function addWasteLog(log) {
  const database = getDB();
  const record = { ...log, id: log.id || uuidv4() };
  await database.put('waste', record);
  return record.id;
}

/**
 * Get all waste logs from today.
 */
export async function getTodayWaste() {
  const database = getDB();
  const all = await database.getAll('waste');
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
  const database = getDB();
  return database.getAll('suppliers');
}

/** Insert or update a supplier. */
export async function upsertSupplier(supplier) {
  const database = getDB();
  const record = { ...supplier, id: supplier.id || uuidv4(), updated_at: new Date().toISOString() };
  await database.put('suppliers', record);
  return record;
}

/** Delete a supplier by ID. */
export async function deleteSupplier(id) {
  const database = getDB();
  await database.delete('suppliers', id);
}

// ─────────────────────────────────────────────
// Recipes CRUD
// ─────────────────────────────────────────────

/** Get all recipes. */
export async function getAllRecipes() {
  const database = getDB();
  return database.getAll('recipes');
}

/** Get recipes for a specific menu item. */
export async function getRecipesByMenuItem(menuItemId) {
  const database = getDB();
  return database.getAllFromIndex('recipes', 'menu_item_id', menuItemId);
}

/** Insert or update a recipe mapping. */
export async function upsertRecipe(recipe) {
  const database = getDB();
  const record = { ...recipe, id: recipe.id || uuidv4(), updated_at: new Date().toISOString() };
  await database.put('recipes', record);
  return record;
}

/** Delete a recipe item */
export async function deleteRecipe(id) {
  const database = getDB();
  await database.delete('recipes', id);
}

// ─────────────────────────────────────────────
// Restaurant Settings CRUD
// ─────────────────────────────────────────────

/** Get the first restaurant profile. */
export async function getRestaurantProfile() {
  const database = getDB();
  const allProfiles = await database.getAll('restaurants');
  return allProfiles.length > 0 ? allProfiles[0] : null;
}

/** Insert or update a restaurant profile. */
export async function upsertRestaurant(restaurant) {
  const database = getDB();
  const record = { ...restaurant, id: restaurant.id || uuidv4() };
  await database.put('restaurants', record);
  return record.id;
}

// ─────────────────────────────────────────────
// Inventory Depletion Helper
// ─────────────────────────────────────────────

/**
 * Deducts stock from inventory based on recipe mappings of ordered items.
 * Returns the list of updated inventory items to be queued for sync.
 * @param {string} orderId
 * @returns {Promise<Array<object>>}
 */
export async function deductInventoryForOrder(orderId) {
  const database = getDB();
  const orderItems = await getOrderItems(orderId);
  const recipes = await getAllRecipes();
  const inventory = await getAllInventory();
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
        await database.put('inventory', invItem);
        updatedItems.push(invItem);
      }
    }
  }

  return updatedItems;
}

/** Get or create the permanent system table for takeaway order history. */
export async function getOrCreateTakeawayArchiveTable() {
  const database = getDB();
  const ARCHIVE_ID = 'da7e5a00-1ecc-4a41-b0e7-4581f1e7370a';
  let archiveTable = await database.get('tables', ARCHIVE_ID);
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
    await database.put('tables', archiveTable);
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



