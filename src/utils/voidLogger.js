/**
 * Void Logger — TableCraft OS
 * 
 * Centralized helper for logging voids/cancellations to IndexedDB + sync queue.
 * Used by both UI (billingPanel) and AI (commandExecutor) code paths.
 */

import { v4 as uuidv4 } from 'uuid';
import { addOrderVoid } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';

/**
 * Log a void/cancellation record.
 * @param {object} params
 * @param {string} params.orderId — the order ID (may be null if order was deleted)
 * @param {string} params.tableName — display name of the table (e.g. "T3")
 * @param {'item_removed'|'order_cancelled'} params.voidType — type of void
 * @param {number} params.amount — monetary amount voided
 * @param {string|null} [params.reason] — optional reason text
 * @param {string|null} [params.voidedBy] — optional staff name or "AI Command"
 */
export async function logVoid({ orderId, tableName, voidType, amount, reason = null, voidedBy = null }) {
  const record = {
    id: uuidv4(),
    order_id: orderId || null,
    table_name: tableName || null,
    void_type: voidType,
    amount: Math.round((amount || 0) * 100) / 100,
    reason: reason || null,
    voided_by: voidedBy || null,
    voided_at: new Date().toISOString()
  };

  try {
    await addOrderVoid(record);
    await queueSync('order_voids', 'INSERT', record);
  } catch (err) {
    console.error('[VoidLogger] Failed to log void:', err);
  }
}
