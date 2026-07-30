/**
 * Sync Engine — TableCraft OS
 * 
 * Manages the bidirectional sync between IndexedDB (local) and Supabase (cloud).
 * Implements an offline-first queue that replays operations when connectivity returns.
 */

import {
  addToSyncQueue as addToQueue,
  getSyncQueue,
  clearSyncQueueEntry,
  clearSyncQueue,
  getAllTables,
  getAllMenuItems,
  upsertTable,
  getAllOrders,
  getAllTransactions,
} from './indexedDB.js';

import {
  pushTable,
  pushMenuItem,
  pushOrder,
  pushOrderItem,
  pushTransaction,
  deleteFromSupabase,
  pullTables,
  pullMenuItems,
  pullTransactions,
  pushInventory,
  pullInventory,
  pushWaste,
  pullWaste,
  pullOrders,
  pushSupplier,
  pullSuppliers,
  pushRecipe,
  pullRecipes,
  pushRestaurantProfile,
  pullRestaurantProfile,
  pushStaffProfile,
  pullStaffProfiles,
  pushOrderVoid
} from './supabase.js';

import { setState, getState } from '../state.js';

/** Sync interval handle for cleanup */
let syncIntervalId = null;

/** Map sync queue table names to their corresponding push functions */
const PUSH_FN_MAP = {
  tables: pushTable,
  menu_items: pushMenuItem,
  orders: pushOrder,
  order_items: pushOrderItem,
  transactions: pushTransaction,
  inventory: pushInventory,
  waste: pushWaste,
  suppliers: pushSupplier,
  recipes: pushRecipe,
  restaurants: pushRestaurantProfile,
  staff_profiles: pushStaffProfile,
  order_voids: pushOrderVoid
};

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

/**
 * Initialize the sync engine:
 * 1. Detect initial connectivity status
 * 2. Set up online/offline event listeners
 * 3. Start periodic sync interval (every 30s)
 */
export function initSyncEngine() {
  // Set initial sync status based on connectivity
  const isOnline = navigator.onLine;
  setState('syncStatus', isOnline ? 'synced' : 'offline');
  console.log(`[SyncEngine] Initialized — ${isOnline ? 'online' : 'offline'}`);

  // Listen for connectivity changes
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Periodic sync check every 30 seconds
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(() => {
    if (navigator.onLine) {
      syncNow();
    }
  }, 30_000);

  // If we're online, do an initial sync
  if (isOnline) {
    syncNow();
  }
}

/** Handle coming back online. */
function handleOnline() {
  console.log('[SyncEngine] Back online — triggering sync');
  setState('syncStatus', 'pending');
  syncNow();
}

/** Handle going offline. */
function handleOffline() {
  console.log('[SyncEngine] Gone offline');
  setState('syncStatus', 'offline');
}

// ─────────────────────────────────────────────
// Sync Operations
// ─────────────────────────────────────────────

let isSyncing = false;
let retrySyncAfterCurrent = false;

/**
 * Process all items in the sync queue one by one.
 * On success, each entry is removed from the queue.
 * Sets syncStatus to 'synced' when complete, or 'pending' on failure.
 */
export async function syncNow() {
  if (!navigator.onLine) {
    setState('syncStatus', 'offline');
    return;
  }

  if (isSyncing) {
    console.log('[SyncEngine] Sync already in progress, queuing retry.');
    retrySyncAfterCurrent = true;
    return;
  }

  isSyncing = true;
  retrySyncAfterCurrent = false;

  try {
    setState('syncStatus', 'syncing');
    const queue = await getSyncQueue();

    if (queue.length === 0) {
      setState('syncStatus', 'synced');
      isSyncing = false;
      return;
    }

    console.log(`[SyncEngine] Processing ${queue.length} queued operations...`);
    let hadFailure = false;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const entry of queue) {
      const result = await processQueueEntry(entry);
      if (result === true) {
        await clearSyncQueueEntry(entry.id);
      } else if (result === 'DISCARD') {
        // Permanently unresolvable (FK violation, missing parent, conflict after cloud reset)
        console.warn(`[SyncEngine] Discarding unresolvable queue entry ${entry.id} (${entry.table}/${entry.action}) — parent record no longer exists in cloud.`);
        await clearSyncQueueEntry(entry.id);
      } else {
        const entryAge = entry.created_at ? new Date(entry.created_at).getTime() : 0;
        if (entryAge < oneDayAgo) {
          // Stale entry — discard silently
          console.warn(`[SyncEngine] Discarding stale queue entry ${entry.id} (${entry.table}/${entry.action}, created ${entry.created_at})`);
          await clearSyncQueueEntry(entry.id);
        } else {
          hadFailure = true;
          console.warn(`[SyncEngine] Failed to sync entry ${entry.id}:`, entry);
        }
      }
    }

    setState('syncStatus', hadFailure ? 'pending' : 'synced');
    console.log(`[SyncEngine] Sync complete — ${hadFailure ? 'some failures' : 'all clear'}`);
  } catch (err) {
    console.error('[SyncEngine] syncNow error:', err);
    setState('syncStatus', 'pending');
  } finally {
    isSyncing = false;
    if (retrySyncAfterCurrent) {
      console.log('[SyncEngine] Retrying sync due to queued operations.');
      syncNow();
    }
  }
}

/**
 * Process a single sync queue entry.
 * @param {{ table: string, action: string, data: object }} entry
 * @returns {Promise<boolean>} true if the operation succeeded
 */
async function processQueueEntry(entry) {
  const { table, action, data } = entry;

  try {
    if (action === 'DELETE') {
      const result = await deleteFromSupabase(table, data.id);
      return result !== null;
    }

    // INSERT or UPDATE — use the appropriate push function
    const pushFn = PUSH_FN_MAP[table];
    if (!pushFn) {
      console.warn(`[SyncEngine] No push function for table: ${table}`);
      return false;
    }

    // ── PRE-PUSH REPAIR FOR ORDERS ──────────────────────────────────────────
    if (table === 'orders' && action !== 'DELETE' && data.table_id) {
      const { supabase } = await import('./supabase.js');
      const { data: remoteTable, error: tableErr } = await supabase
        .from('tables')
        .select('id, name')
        .eq('id', data.table_id)
        .maybeSingle();

      if (tableErr || !remoteTable) {
        console.warn(`[SyncEngine] Order ${data.id} references missing table_id ${data.table_id}. Attempting repair...`);
        const { getTable, createOrder } = await import('./indexedDB.js');
        const localTable = await getTable(data.table_id);
        let remapped = false;

        if (localTable && localTable.name) {
          const { data: matchingTable } = await supabase
            .from('tables')
            .select('id, name')
            .eq('name', localTable.name)
            .maybeSingle();
          
          if (matchingTable) {
            console.log(`[SyncEngine] Remapping order ${data.id} to new table ID for ${localTable.name}`);
            data.table_id = matchingTable.id;
            remapped = true;
            await createOrder(data); // update locally
          }
        }

        if (!remapped) {
           console.warn(`[SyncEngine] Discarding unresolvable queue entry ${entry.id} (orders/${action}) — table_id no longer exists in Supabase and could not be remapped.`);
           return 'DISCARD';
        }
      }
    }

    // Execute the push operation; errors will be thrown and caught below
    await pushFn(data);
    return true;
  } catch (err) {
    // Detect permanent FK violation (parent deleted upstream)
    if (err && (err.code === '23503' || (err.message && err.message.includes('fkey')))) {
      console.warn(`[SyncEngine] FK violation for ${table}/${action} — discarding entry.`);
      return 'DISCARD';
    }
    // Detect duplicate/conflict on a record whose parent no longer exists
    if (err && (err.code === '23505' || err.status === 409 || err.code === '409')) {
      console.warn(`[SyncEngine] Conflict/duplicate for ${table}/${action} — discarding entry.`);
      return 'DISCARD';
    }

    // ── FALLBACK LOCAL EXISTENCE CHECKS ─────────────────────────────────────
    // If network fails (not FK), we still discard if the parent was deleted locally
    if ((table === 'transactions' || table === 'order_items') && data.order_id) {
      const { getOrder } = await import('./indexedDB.js');
      const parentOrder = await getOrder(data.order_id);
      if (!parentOrder) {
        console.warn(`[SyncEngine] Parent order missing locally for ${table}/${action} — discarding entry.`);
        return 'DISCARD';
      }
    }
    
    if (table === 'orders' && data.table_id) {
      const { getTable } = await import('./indexedDB.js');
      const parentTable = await getTable(data.table_id);
      if (!parentTable) {
        console.warn(`[SyncEngine] Parent table missing locally for ${table}/${action} — discarding entry.`);
        return 'DISCARD';
      }
    }

    console.error(`[SyncEngine] processQueueEntry failed for ${table}/${action}:`, err);
    return false;
  }
}

// ─────────────────────────────────────────────
// Queue Helper
// ─────────────────────────────────────────────

/**
 * Add an operation to the sync queue and update sync status.
 * @param {string} table — Supabase table name (e.g. 'tables', 'orders')
 * @param {'INSERT'|'UPDATE'|'DELETE'} action
 * @param {object} data — the record data
 */
export async function queueSync(table, action, data) {
  await addToQueue({
    table,
    action,
    data,
    created_at: new Date().toISOString(),
  });

  // Trigger sync immediately if online, otherwise mark as pending
  if (navigator.onLine) {
    syncNow();
  } else if (getState().syncStatus !== 'offline') {
    setState('syncStatus', 'pending');
  }
}

// ─────────────────────────────────────────────
// Cloud → Local Pull
// ─────────────────────────────────────────────

/**
 * Pull all data from Supabase into IndexedDB and update app state.
 * Used on initial load or manual refresh to hydrate the local store.
 */
export async function pullAllFromCloud() {
  if (!navigator.onLine) {
    console.warn('[SyncEngine] Cannot pull — offline');
    return;
  }

  console.log('[SyncEngine] Pulling all data from cloud and reconciling...');

  try {
    const { 
      deleteTable, 
      getOrderByTable, 
      createOrder, 
      deleteMenuItem, 
      addMenuItem, 
      addTransaction,
      getOrderItems,
      addOrderItem,
      upsertInventory,
      addWasteLog,
      getAllOrders,
      upsertSupplier,
      upsertRecipe,
      getAllSuppliers,
      getAllRecipes,
      upsertRestaurant,
      deleteOrder,
      removeOrderItem
    } = await import('./indexedDB.js');

    // 1. Pull and Reconcile Tables
    const cloudTables = await pullTables();
    if (cloudTables && cloudTables.length > 0) {
      const localTables = await getAllTables();

      // Pre-fetch cloud order IDs to cross-check occupied status
      const cloudOrdersForCheck = await pullOrders();
      const cloudOrderIdSet = new Set((cloudOrdersForCheck || []).map(o => o.id));
      
      for (const table of cloudTables) {
        // Find all local tables with same name but different ID
        const localMatches = localTables.filter(t => t.name === table.name && t.id !== table.id);
        
        for (const localMatch of localMatches) {
          console.log(`[SyncEngine] Aligning table ${table.name} ID: ${localMatch.id} -> ${table.id}`);
          
          // Delete old local record
          await deleteTable(localMatch.id);
          
          // Check if there is an active local order pointing to the old table ID
          const openOrder = await getOrderByTable(localMatch.id);
          if (openOrder) {
            console.log(`[SyncEngine] Updating local open order ${openOrder.id} to table ID ${table.id}`);
            
            // Rewrite order pointing to new table ID
            openOrder.table_id = table.id;
            await createOrder(openOrder);
            
            // Also update order items
            const orderItems = await getOrderItems(openOrder.id);
            for (const item of orderItems) {
              await addOrderItem(item);
            }
          }
        }

        // ── Ghost-occupied guard ──────────────────────────────────────────────
        // If the cloud table says 'occupied' but the referenced order no longer
        // exists in Supabase (deleted by the user), reset it to 'available'.
        if (table.status === 'occupied' && table.current_order_id && !cloudOrderIdSet.has(table.current_order_id)) {
          console.warn(`[SyncEngine] Resetting ghost-occupied table ${table.name} — order ${table.current_order_id} not found in cloud.`);
          table.status = 'available';
          table.current_order_id = null;
          // Reset locally and push the correction directly to Supabase
          await upsertTable(table);
          const { pushTable } = await import('./supabase.js');
          await pushTable(table);
        }
        
        // Write/update the cloud table structure in IDB
        await upsertTable(table);
      }
      
      // Reload final tables state
      const finalTables = await getAllTables();
      setState('tables', finalTables);
      console.log(`[SyncEngine] Synced ${cloudTables.length} tables`);
    }

    // 2. Pull and Reconcile Menu Items
    const cloudMenuItems = await pullMenuItems();
    if (cloudMenuItems && cloudMenuItems.length > 0) {
      const localMenu = await getAllMenuItems();
      const reconciledNames = new Set();
      
      for (const item of cloudMenuItems) {
        if (!reconciledNames.has(item.name)) {
          const localMatches = localMenu.filter(m => m.name === item.name && m.id !== item.id);
          for (const localMatch of localMatches) {
            console.log(`[SyncEngine] Aligning menu item "${item.name}" ID: ${localMatch.id} -> ${item.id}`);
            await deleteMenuItem(localMatch.id);
          }
          reconciledNames.add(item.name);
        }
        await addMenuItem(item);
      }
      
      // Reload final menu
      const finalMenu = await getAllMenuItems();
      setState('menuItems', finalMenu);
      console.log(`[SyncEngine] Synced ${cloudMenuItems.length} menu items`);
    }

    // 3. Pull transactions
    const cloudTransactions = await pullTransactions();
    if (cloudTransactions) { // removed .length > 0 check to allow empty cloud state sync
      const { getAllTransactions, deleteTransaction, getSyncQueue, clearSyncQueueEntry: clearEntry } = await import('./indexedDB.js');
      const localTransactions = await getAllTransactions();
      const syncQueue = await getSyncQueue();
      const pendingTxIds = new Set(syncQueue.filter(q => q.table === 'transactions').map(q => q.data.id));
      
      for (const tx of cloudTransactions) {
        // Find local transactions for the same order but with a different ID
        const localMatches = localTransactions.filter(l => l.order_id === tx.order_id && l.id !== tx.id);
        
        for (const localMatch of localMatches) {
          console.log(`[SyncEngine] Aligning transaction for order ${tx.order_id} ID: ${localMatch.id} -> ${tx.id}`);
          await deleteTransaction(localMatch.id);
        }
        
        await addTransaction(tx);
      }

      // Find the oldest timestamp among the fetched cloud transactions
      const oldestCloudTx = cloudTransactions[cloudTransactions.length - 1];
      const oldestCloudDate = oldestCloudTx ? new Date(oldestCloudTx.paid_at).getTime() : 0;

      // Cleanup local orphaned transactions not in cloud and not pending sync
      const cloudTxIds = new Set(cloudTransactions.map(t => t.id));
      for (const localTx of localTransactions) {
        const localDate = new Date(localTx.paid_at).getTime();
        
        // Only consider it an orphan if it's newer or equal to the oldest fetched cloud transaction
        // (If it's older, it simply wasn't fetched due to the limit)
        if (localDate >= oldestCloudDate && !cloudTxIds.has(localTx.id) && !pendingTxIds.has(localTx.id)) {
           console.log(`[SyncEngine] Removing orphaned local transaction: ${localTx.id}`);
           await deleteTransaction(localTx.id);
        }
      }

      // ── Sweep sync queue for orphaned transaction/order_item entries ──────────
      // After a cloud reset (empty orders + empty transactions), any queued
      // INSERT for transactions or order_items whose order_id is not in cloud
      // will never succeed. Discard them now to prevent infinite retry loops.
      if (cloudTransactions.length === 0) {
        const cloudOrderIds = new Set((await pullOrders() || []).map(o => o.id));
        const orphanedQueueEntries = syncQueue.filter(q =>
          (q.table === 'transactions' || q.table === 'order_items') &&
          q.action === 'INSERT' &&
          q.data.order_id &&
          !cloudOrderIds.has(q.data.order_id)
        );
        for (const orphan of orphanedQueueEntries) {
          console.warn(`[SyncEngine] Sweeping orphaned queue entry ${orphan.id} (${orphan.table}) — parent order deleted from cloud.`);
          await clearEntry(orphan.id);
        }
      }
      
      const { getTodayTransactions } = await import('./indexedDB.js');
      const todayTx = await getTodayTransactions();
      setState('transactions', todayTx);
      console.log(`[SyncEngine] Synced ${cloudTransactions.length} transactions`);
    }

    // 4. Pull and Reconcile Orders (Needed for dashboard analytics)
    // NOTE: Guard is intentionally `!= null` (not `length > 0`) so that an empty
    // cloud response correctly sweeps stale local orders after a Supabase reset.
    const cloudOrders = await pullOrders();
    if (cloudOrders != null) {
      const { getOrder, getTable, isTakeawayTable, getChannelFromTableName } = await import('./indexedDB.js');
      const cloudOrderIdSet = new Set(cloudOrders.map(o => o.id));

      // Upsert all cloud orders locally
      for (const order of cloudOrders) {
        const local = await getOrder(order.id);
        
        let channel = local ? local.channel : undefined;
        if (!channel) {
          const table = await getTable(order.table_id);
          if (table && isTakeawayTable(table)) {
            const rawChannel = table.channel || getChannelFromTableName(table.name);
            if (rawChannel === 'Regular') channel = 'Takeout';
            else if (rawChannel === 'Foodmandu') channel = 'Foodmandu';
            else if (rawChannel === 'Pathao') channel = 'Pathao';
            else if (rawChannel === 'BhojDeals' || rawChannel === 'Bhojdeals') channel = 'BhojDeals';
          }
        }

        const merged = {
          ...order,
          kitchen_status: local ? (local.kitchen_status || 'cooking') : 'cooking'
        };
        if (channel) merged.channel = channel;
        
        await createOrder(merged);
      }

      // ── Sweep orphaned local open orders ─────────────────────────────────────
      // Any local order with status 'open' that isn't in the cloud set is stale
      // (e.g. left over after user deleted orders directly in Supabase).
      const localOrders = await getAllOrders();
      for (const localOrder of localOrders) {
        if (localOrder.status === 'open' && !cloudOrderIdSet.has(localOrder.id)) {
          console.warn(`[SyncEngine] Removing orphaned local open order ${localOrder.id} (table: ${localOrder.table_id})`);
          // Delete associated order items first
          const orphanItems = await getOrderItems(localOrder.id);
          for (const item of orphanItems) {
            await removeOrderItem(item.id);
          }
          await deleteOrder(localOrder.id);
        }
      }

      const allOrders = await getAllOrders();
      setState('orders', allOrders);
      console.log(`[SyncEngine] Synced ${cloudOrders.length} orders (swept ${localOrders.filter(o => o.status === 'open' && !cloudOrderIdSet.has(o.id)).length} orphans)`);
    }

    // 5. Pull and Reconcile Inventory
    const cloudInventory = await pullInventory();
    if (cloudInventory && cloudInventory.length > 0) {
      for (const item of cloudInventory) {
        await upsertInventory(item);
      }
      const { getAllInventory } = await import('./indexedDB.js');
      const allInv = await getAllInventory();
      setState('inventory', allInv);
      console.log(`[SyncEngine] Synced ${cloudInventory.length} inventory items`);
    }

    // 6. Pull and Reconcile Waste Logs
    const cloudWaste = await pullWaste();
    if (cloudWaste && cloudWaste.length > 0) {
      for (const log of cloudWaste) {
        await addWasteLog(log);
      }
      const { getTodayWaste } = await import('./indexedDB.js');
      const todayWaste = await getTodayWaste();
      setState('waste', todayWaste);
      console.log(`[SyncEngine] Synced ${cloudWaste.length} waste logs`);
    }

    // 7. Pull and Reconcile Suppliers
    const cloudSuppliers = await pullSuppliers();
    if (cloudSuppliers && cloudSuppliers.length > 0) {
      for (const supplier of cloudSuppliers) {
        await upsertSupplier(supplier);
      }
      const allSuppliers = await getAllSuppliers();
      setState('suppliers', allSuppliers);
      console.log(`[SyncEngine] Synced ${cloudSuppliers.length} suppliers`);
    }

    // 8. Pull and Reconcile Recipes
    const cloudRecipes = await pullRecipes();
    if (cloudRecipes && cloudRecipes.length > 0) {
      for (const recipe of cloudRecipes) {
        await upsertRecipe(recipe);
      }
      const allRecipes = await getAllRecipes();
      setState('recipes', allRecipes);
      console.log(`[SyncEngine] Synced ${cloudRecipes.length} recipes`);
    }

    // 9. Pull Restaurant Profile
    const cloudRestaurant = await pullRestaurantProfile();
    if (cloudRestaurant) {
      await upsertRestaurant(cloudRestaurant);
      setState('restaurant', cloudRestaurant);
      console.log(`[SyncEngine] Synced restaurant profile`);
    }

    // 10. Pull Staff Profiles
    const cloudStaff = await pullStaffProfiles();
    if (cloudStaff && cloudStaff.length > 0) {
      const { upsertStaffProfile, getAllStaffProfiles } = await import('./indexedDB.js');
      for (const profile of cloudStaff) {
        await upsertStaffProfile(profile);
      }
      const allStaff = await getAllStaffProfiles();
      setState('staffProfiles', allStaff);
      console.log(`[SyncEngine] Synced ${cloudStaff.length} staff profiles`);
      
      // Emit custom event so UI can re-render if needed
      setState('staffProfileSync', Date.now());
    }

    setState('syncStatus', 'synced');
    console.log('[SyncEngine] Pull & reconciliation complete');
  } catch (err) {
    console.error('[SyncEngine] pullAllFromCloud error:', err);
  }
}
