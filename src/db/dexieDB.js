/**
 * Dexie.js Database Instance — TableCraft OS
 * 
 * Provides typed, high-performance IndexedDB store abstractions,
 * rich range queries, reactive live query capabilities, and ACID multi-store transactions.
 */

import Dexie from 'dexie';

export const db = new Dexie('tablecraft-os');

// Database Version 7: Added waiter_id and waiter_name to orders, and waiter_name to transactions
db.version(7).stores({
  tables: 'id',
  menuItems: 'id',
  orders: 'id, table_id, status, bill_number, waiter_id',
  orderItems: 'id, order_id',
  transactions: 'id, paid_at, bill_number',
  syncQueue: '++id, table, action',
  inventory: 'id',
  waste: 'id, wasted_at',
  suppliers: 'id',
  recipes: 'id, menu_item_id',
  restaurants: 'id',
  staffProfiles: 'id, role',
  currentSession: 'id'
});

/**
 * Ensures the Dexie database is ready and opened.
 */
export async function initDexieDB() {
  if (!db.isOpen()) {
    await db.open();
  }
  return db;
}
