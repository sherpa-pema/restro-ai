// Application Entry Point — TableCraft OS

import './styles/index.css';
import { 
  initDB, 
  getAllTables, 
  upsertTable, 
  deleteTable,
  getAllMenuItems, 
  addMenuItem, 
  deleteMenuItem,
  getTodayTransactions, 
  getAllOrders, 
  getOrder,
  createOrder,
  deleteOrder,
  getAllInventory, 
  getAllWaste,
  getTodayWaste, 
  upsertInventory, 
  addWasteLog,
  getOrderByTable,
  getOrderItems,
  addOrderItem,
  removeOrderItem,
  getAllSuppliers,
  upsertSupplier,
  deleteSupplier,
  getAllRecipes,
  upsertRecipe,
  deleteRecipe,
  getOrCreateTakeawayArchiveTable,
  updateOrder,
  getDB,
  isTakeawayTable
} from './db/indexedDB.js';
import { initSupabase, subscribeToChanges } from './db/supabase.js';
import { initSyncEngine, pullAllFromCloud, queueSync } from './db/syncEngine.js';
import { setState, getState } from './state.js';
import { initSidebar } from './ui/sidebar.js';
import { initFloorMap, renderFloorMap } from './ui/floorMap.js';
import { initMenuPanel, renderMenuPanel } from './ui/menuPanel.js';
import { initBillingPanel } from './ui/billingPanel.js';
import { initRevenueDashboard, renderRevenueDashboard } from './ui/revenueDashboard.js';
import { initKitchenDashboard } from './ui/kitchenDashboard.js';
import { initInventoryPanel } from './ui/inventoryPanel.js';
import { initCommandBar } from './ui/commandBar.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Perform initial database seeding if IndexedDB stores are empty.
 */
async function seedDefaultData() {
  const currentTables = await getAllTables();
  if (currentTables.length === 0) {
    console.log('[Seed] Seeding default tables...');
    const defaultTables = [
      { id: uuidv4(), name: 'T1', seats: 2, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T2', seats: 4, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T3', seats: 4, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T4', seats: 6, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T5', seats: 2, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T6', seats: 4, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T7', seats: 6, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T8', seats: 4, status: 'available', category: 'Indoor', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T9', seats: 4, status: 'available', category: 'Patio', current_order_id: null, updated_at: new Date().toISOString() },
      { id: uuidv4(), name: 'T10', seats: 6, status: 'available', category: 'VIP', current_order_id: null, updated_at: new Date().toISOString() }
    ];
    for (const t of defaultTables) {
      await upsertTable(t);
    }
  }

  const currentMenuItems = await getAllMenuItems();
  if (currentMenuItems.length === 0) {
    console.log('[Seed] Seeding default menu items...');
    const defaultMenuItems = [
      { name: 'Chicken Burger', emoji: '🍔', price: 8.50, category: 'Main', is_active: true, created_at: new Date().toISOString() },
      { name: 'Veg Pizza', emoji: '🍕', price: 11.00, category: 'Main', is_active: true, created_at: new Date().toISOString() },
      { name: 'Chicken Momo', emoji: '🥟', price: 6.50, category: 'Starter', is_active: true, created_at: new Date().toISOString() },
      { name: 'French Fries', emoji: '🍟', price: 3.50, category: 'Side', is_active: true, created_at: new Date().toISOString() },
      { name: 'Coke', emoji: '🥤', price: 2.00, category: 'Beverage', is_active: true, created_at: new Date().toISOString() },
      { name: 'Chicken Biryani', emoji: '🍛', price: 12.50, category: 'Main', is_active: true, created_at: new Date().toISOString() },
      { name: 'Caesar Salad', emoji: '🥗', price: 7.00, category: 'Starter', is_active: true, created_at: new Date().toISOString() },
      { name: 'Margherita Pizza', emoji: '🍕', price: 10.00, category: 'Main', is_active: true, created_at: new Date().toISOString() },
      { name: 'Lemonade', emoji: '🍋', price: 2.50, category: 'Beverage', is_active: true, created_at: new Date().toISOString() },
      { name: 'Chocolate Cake', emoji: '🍰', price: 5.00, category: 'Dessert', is_active: true, created_at: new Date().toISOString() }
    ];
    for (const item of defaultMenuItems) {
      await addMenuItem(item);
    }
  }

  // Seed inventory and waste (non-critical — wrapped to avoid breaking core boot)
  try {
    const currentInventory = await getAllInventory();
    if (currentInventory.length === 0) {
      console.log('[Seed] Seeding default inventory ingredients...');
      const defaultInventory = [
        { id: uuidv4(), ingredient_name: 'Chicken Breast', current_stock: 15.00, unit: 'kg', reorder_threshold: 20.00, unit_cost: 450.00, updated_at: new Date().toISOString() },
        { id: uuidv4(), ingredient_name: 'Fresh Dairy', current_stock: 8.00, unit: 'liters', reorder_threshold: 10.00, unit_cost: 110.00, updated_at: new Date().toISOString() },
        { id: uuidv4(), ingredient_name: 'Burger Buns', current_stock: 120.00, unit: 'pcs', reorder_threshold: 50.00, unit_cost: 15.00, updated_at: new Date().toISOString() },
        { id: uuidv4(), ingredient_name: 'Potatoes', current_stock: 80.00, unit: 'kg', reorder_threshold: 30.00, unit_cost: 40.00, updated_at: new Date().toISOString() },
        { id: uuidv4(), ingredient_name: 'Tomatoes', current_stock: 12.00, unit: 'kg', reorder_threshold: 15.00, unit_cost: 80.00, updated_at: new Date().toISOString() },
        { id: uuidv4(), ingredient_name: 'Cheese Slices', current_stock: 200.00, unit: 'pcs', reorder_threshold: 100.00, unit_cost: 12.00, updated_at: new Date().toISOString() }
      ];
      for (const item of defaultInventory) {
        await upsertInventory(item);
      }
    }

    const currentWaste = await getAllWaste();
    if (currentWaste.length === 0) {
      console.log('[Seed] Seeding default waste logs...');
      const defaultWaste = [
        { id: uuidv4(), ingredient_name: 'Chicken Breast', quantity: 2.00, cost: 900.00, wasted_at: new Date().toISOString(), reason: 'Spoiled due to freezer outage' },
        { id: uuidv4(), ingredient_name: 'Fresh Dairy', quantity: 1.50, cost: 165.00, wasted_at: new Date().toISOString(), reason: 'Expired date' }
      ];
      for (const log of defaultWaste) {
        await addWasteLog(log);
      }
    }
  } catch (e) {
    console.warn('[Seed] Inventory/waste seeding skipped:', e.message);
  }
}

/**
 * Main application boostrapper.
 */
async function bootstrap() {
  try {
    // 1. Open/Create Local database
    await initDB();
    
    // 2. Hydrate defaults if required
    await seedDefaultData();
    
    // 3. Load records from IndexedDB to memory (offline first)
    const tables = await getAllTables();
    const menuItems = await getAllMenuItems();
    const transactions = await getTodayTransactions();
    
    setState('tables', tables);
    setState('menuItems', menuItems);
    setState('transactions', transactions);
    
    // Load overview-specific data (non-critical — wrapped to protect core boot)
    try {
      const orders = await getAllOrders();
      const inventory = await getAllInventory();
      const waste = await getTodayWaste();
      const suppliers = await getAllSuppliers();
      const recipes = await getAllRecipes();
      setState('orders', orders);
      setState('inventory', inventory);
      setState('waste', waste);
      setState('suppliers', suppliers);
      setState('recipes', recipes);
    } catch (e) {
      console.warn('[App] Overview and inventory data load skipped:', e.message);
    }
    
    // 4. Initialize UI listeners and controls
    initSidebar();
    initFloorMap();
    initMenuPanel();
    initBillingPanel();
    initRevenueDashboard();
    try { initKitchenDashboard(); } catch (e) { console.error('[App] Kitchen dashboard init failed:', e); }
    try { initInventoryPanel(); } catch (e) { console.error('[App] Inventory panel init failed:', e); }
    initCommandBar();
    
    // 5. Initial UI Render
    await renderFloorMap();
    renderMenuPanel();
    try { renderRevenueDashboard(); } catch (e) { console.warn('[App] Overview dashboard render failed:', e); }
    
    // 6. Connect to Supabase Cloud & trigger pull (non-blocking, async background)
    initSupabase().then(async (success) => {
      if (success) {
        console.log('[App] Connected to Supabase Cloud — syncing latest state...');
        await pullAllFromCloud();
        
        // Refresh local cache representation in memory and re-render
        const syncedTables = await getAllTables();
        const syncedMenu = await getAllMenuItems();
        const syncedTx = await getTodayTransactions();
        const syncedOrders = await getAllOrders();
        const syncedInventory = await getAllInventory();
        const syncedWaste = await getTodayWaste();
        const syncedSuppliers = await getAllSuppliers();
        const syncedRecipes = await getAllRecipes();

        setState('tables', syncedTables);
        setState('menuItems', syncedMenu);
        setState('transactions', syncedTx);
        setState('orders', syncedOrders);
        setState('inventory', syncedInventory);
        setState('waste', syncedWaste);
        setState('suppliers', syncedSuppliers);
        setState('recipes', syncedRecipes);
        
        await renderFloorMap();
        renderMenuPanel();
        renderRevenueDashboard();

        // 7. Cleanup any orphaned/stuck takeaway tables (soft cleanup of database state)
        try {
          // Ensure Takeaway-Archive table exists locally and in the cloud
          const { table: archiveTable } = await getOrCreateTakeawayArchiveTable();
          // Always queue an update/sync for the archive table on startup to guarantee it exists in Supabase
          await queueSync('tables', 'UPDATE', archiveTable);

          await cleanupOrphanedTakeaways();
        } catch (cleanupErr) {
          console.error('[App] Orphaned takeaway cleanup failed:', cleanupErr);
        }

        // 8. Subscribe to realtime cloud changes
        subscribeToChanges({
          onTableChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await upsertTable(payload.new);
            } else if (payload.eventType === 'DELETE') {
              await deleteTable(payload.old.id);
            }
            const current = await getAllTables();
            setState('tables', current);
            await renderFloorMap();
          },
          onMenuChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await addMenuItem(payload.new);
            } else if (payload.eventType === 'DELETE') {
              await deleteMenuItem(payload.old.id);
            }
            const current = await getAllMenuItems();
            setState('menuItems', current);
            renderMenuPanel();
          },
          onOrderChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const local = await getOrder(payload.new.id);
              const merged = {
                ...payload.new,
                kitchen_status: local ? (local.kitchen_status || 'cooking') : 'cooking'
              };
              await createOrder(merged);
            } else if (payload.eventType === 'DELETE') {
              await deleteOrder(payload.old.id);
            }
            const current = await getAllOrders();
            setState('orders', current);
            // Refresh billing active order if loaded
            const activeTableId = getState().selectedTableId;
            if (activeTableId) {
              const order = await getOrderByTable(activeTableId);
              setState('currentOrder', order || null);
              if (order) {
                const items = await getOrderItems(order.id);
                setState('currentOrderItems', items);
              } else {
                setState('currentOrderItems', []);
              }
            }
            renderRevenueDashboard();
          },
          onOrderItemChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await addOrderItem(payload.new);
            } else if (payload.eventType === 'DELETE') {
              await removeOrderItem(payload.old.id);
            }
            // Trigger orders state update so kitchen and dashboards re-render
            const currentOrders = await getAllOrders();
            setState('orders', currentOrders);

            const activeTableId = getState().selectedTableId;
            if (activeTableId) {
              const order = await getOrderByTable(activeTableId);
              setState('currentOrder', order || null);
              if (order) {
                const items = await getOrderItems(order.id);
                setState('currentOrderItems', items);
              } else {
                setState('currentOrderItems', []);
              }
            }
            renderRevenueDashboard();
          },
          onInventoryChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await upsertInventory(payload.new);
            }
            const current = await getAllInventory();
            setState('inventory', current);
            renderRevenueDashboard();
          },
          onWasteChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await addWasteLog(payload.new);
            }
            const current = await getTodayWaste();
            setState('waste', current);
            renderRevenueDashboard();
          },
          onSupplierChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await upsertSupplier(payload.new);
            } else if (payload.eventType === 'DELETE') {
              await deleteSupplier(payload.old.id);
            }
            const current = await getAllSuppliers();
            setState('suppliers', current);
          },
          onRecipeChange: async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              await upsertRecipe(payload.new);
            } else if (payload.eventType === 'DELETE') {
              await deleteRecipe(payload.old.id);
            }
            const current = await getAllRecipes();
            setState('recipes', current);
          }
        });
      }
    });

    // 7. Start the FIFO Sync Engine queue processing
    initSyncEngine();

    console.log('[App] TableCraft OS bootstrapped successfully!');
  } catch (err) {
    console.error('[App] Failed to initialize application:', err);
  }
}

// Boot application
bootstrap();

/**
 * Scans and cleans up virtual takeaway tables that have no open orders.
 * Re-routes historical orders to Takeaway-Archive and deletes the tables from local and cloud DB.
 */
async function cleanupOrphanedTakeaways() {
  try {
    const tables = await getAllTables();
    const takeaways = tables.filter(t => isTakeawayTable(t) && t.name !== 'Takeaway-Archive');
    if (takeaways.length === 0) return;

    console.log(`[Cleanup] Found ${takeaways.length} potential takeaway tables. Checking for active orders...`);
    let cleanedCount = 0;

    for (const takeaway of takeaways) {
      const openOrder = await getOrderByTable(takeaway.id);
      if (!openOrder) {
        console.log(`[Cleanup] Cleaning up orphaned takeaway table: ${takeaway.name} (ID: ${takeaway.id})`);
        
        // Re-route referencing paid/cancelled orders to the archive table
        const { table: archiveTable, isNew } = await getOrCreateTakeawayArchiveTable();
        if (isNew) {
          await queueSync('tables', 'UPDATE', archiveTable);
        }

        const database = getDB();
        const referencingOrders = await database.getAllFromIndex('orders', 'table_id', takeaway.id);

        for (const order of referencingOrders) {
          console.log(`[Cleanup] Re-routing order ${order.id} to Takeaway-Archive`);
          const archivedOrder = {
            ...order,
            table_id: archiveTable.id
          };
          await updateOrder(archivedOrder);
          await queueSync('orders', 'UPDATE', archivedOrder);
        }

        // Delete from local DB and queue DELETE to Supabase
        await deleteTable(takeaway.id);
        await queueSync('tables', 'DELETE', { id: takeaway.id });
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      const currentTables = await getAllTables();
      setState('tables', currentTables);
      await renderFloorMap();
      console.log(`[Cleanup] Successfully cleaned up ${cleanedCount} takeaway tables.`);
    }
  } catch (err) {
    console.error('[Cleanup] Error running orphaned takeaway cleanup:', err);
  }
}
