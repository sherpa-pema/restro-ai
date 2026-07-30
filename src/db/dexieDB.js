/**
 * Dexie.js Database Instance — TableCraft OS
 * 
 * Provides typed, high-performance IndexedDB store abstractions,
 * rich range queries, reactive live query capabilities, and ACID multi-store transactions.
 */

import Dexie from 'dexie';

export const db = new Dexie('tablecraft-os');

// Database Version 8: Added orderVoids store for void/cancellation logging
db.version(8).stores({
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
  currentSession: 'id',
  orderVoids: 'id, order_id'
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
