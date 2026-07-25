/**
 * Dexie.js Database Instance — TableCraft OS
 * 
 * Provides typed, high-performance IndexedDB store abstractions,
 * rich range queries, reactive live query capabilities, and ACID multi-store transactions.
 */

import Dexie from 'dexie';

export const db = new Dexie('tablecraft-os');

// Database Version 5: Ensures IndexedDB triggers upgrade from legacy version 4 databases
db.version(5).stores({
  tables: 'id',
  menuItems: 'id',
  orders: 'id, table_id, status, bill_number',
  orderItems: 'id, order_id',
  transactions: 'id, paid_at, bill_number',
  syncQueue: '++id, table, action',
  inventory: 'id',
  waste: 'id, wasted_at',
  suppliers: 'id',
  recipes: 'id, menu_item_id',
  restaurants: 'id'
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
