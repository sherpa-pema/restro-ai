/**
 * Command Executor — TableCraft OS
 * 
 * Takes a parsed intent (from Cerebras AI or regex fallback) and
 * executes the corresponding data operations across IndexedDB,
 * sync queue, and app state.
 */

import { v4 as uuidv4 } from 'uuid';

import {
  getOrderByTable,
  createOrder,
  updateOrder,
  deleteOrder,
  getOrderItems,
  addOrderItem,
  removeOrderItem,
  addMenuItem,
  deleteMenuItem as deleteMenuItemFromDB,
  getAllMenuItems,
  upsertTable,
  addTransaction,
  getTodayTransactions,
  getAllTables,
  getChannelFromTableName,
  deleteTable,
  isTakeawayTable,
  deductInventoryForOrder,
  getAllInventory,
  getOrCreateTakeawayArchiveTable,
} from '../db/indexedDB.js';

import { queueSync } from '../db/syncEngine.js';
import { getState, setState, formatPrice } from '../state.js';

// ─────────────────────────────────────────────
// Main Executor
// ─────────────────────────────────────────────

/**
 * Execute a parsed command intent.
 * @param {object} intent — structured intent from AI or regex parser
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function executeCommand(intent) {
  if (!intent || !intent.action) {
    return { success: false, message: 'No valid intent provided.' };
  }

  try {
    switch (intent.action) {
      case 'ADD_ITEM':
        return await handleAddItem(intent);
      case 'REMOVE_ITEM':
        return await handleRemoveItem(intent);
      case 'PAY_TABLE':
        return await handlePayTable(intent);
      case 'CLEAR_TABLE':
        return await handleClearTable(intent);
      case 'APPLY_DISCOUNT':
        return await handleApplyDiscount(intent);
      case 'ADD_MENU_ITEM':
        return await handleAddMenuItem(intent);
      case 'DELETE_MENU_ITEM':
        return await handleDeleteMenuItem(intent);
      case 'GET_STATUS':
        return await handleGetStatus(intent);
      case 'TRANSFER_TABLE':
        return await handleTransferTable(intent);
      case 'UPDATE_MENU_PRICE':
        return await handleUpdateMenuPrice(intent);
      case 'UPDATE_ITEM_QUANTITY':
        return await handleUpdateItemQuantity(intent);
      case 'CHAT':
        return { success: true, message: intent.message, isChat: true };
      case 'UNKNOWN':
        return { success: false, message: intent.message || 'Could not understand command.' };
      default:
        return { success: false, message: `Unknown action: ${intent.action}` };
    }
  } catch (err) {
    console.error('[CommandExecutor] Error executing command:', err);
    return { success: false, message: `Error: ${err.message}` };
  }
}

// ─────────────────────────────────────────────
// Action Handlers
// ─────────────────────────────────────────────

/**
 * ADD_ITEM — Add item(s) to a table's order.
 */
async function handleAddItem(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  // Get or create an open order for this table
  let order = await getOrderByTable(table.id);
  if (!order) {
    order = {
      id: uuidv4(),
      table_id: table.id,
      table_name: table.name,
      status: 'open',
      subtotal: 0,
      tax: 0,
      service_charge: 0,
      discount: 0,
      total: 0,
      created_at: new Date().toISOString(),
    };
    await createOrder(order);
    await queueSync('orders', 'INSERT', order);
  }

  const menuItems = getState().menuItems || [];
  let addedCount = 0;

  for (const intentItem of intent.items) {
    // Fuzzy-match the menu item
    const menuItem = findMenuItemByName(intentItem.name, menuItems);
    if (!menuItem) {
      console.warn(`[CommandExecutor] Menu item not found: ${intentItem.name}`);
      continue;
    }

    // Check if the item already exists in the order
    const existingItems = await getOrderItems(order.id);
    const existingItem = existingItems.find(
      (oi) => oi.menu_item_id === menuItem.id
    );

    if (existingItem) {
      // Increment quantity (defensive parsing)
      existingItem.quantity += parseInt(intentItem.qty, 10) || 1;
      await addOrderItem(existingItem); // put (upsert)
      await queueSync('order_items', 'UPDATE', existingItem);
    } else {
      // Create new order item
      const orderItem = {
        id: uuidv4(),
        order_id: order.id,
        menu_item_id: menuItem.id,
        name: menuItem.name,
        emoji: menuItem.emoji || '🍽️',
        price: menuItem.price,
        quantity: parseInt(intentItem.qty, 10) || 1,
        notes: '',
        created_at: new Date().toISOString(),
      };
      await addOrderItem(orderItem);
      await queueSync('order_items', 'INSERT', orderItem);
    }

    addedCount += intentItem.qty;
  }

  if (addedCount === 0) {
    return { success: false, message: 'No matching menu items found.' };
  }

  // Recalculate order totals
  const allOrderItems = await getOrderItems(order.id);
  const discountPercent = order.discount && order.subtotal > 0
    ? (order.discount / order.subtotal) * 100
    : 0;
  const updatedOrder = recalculateOrder(order, allOrderItems, discountPercent);
  await updateOrder(updatedOrder);
  await queueSync('orders', 'UPDATE', updatedOrder);

  // Update table status
  table.status = 'occupied';
  table.current_order_id = updatedOrder.id;
  await upsertTable(table);
  await queueSync('tables', 'UPDATE', table);

  // Update app state
  await refreshState(table);

  return {
    success: true,
    message: `Added ${addedCount} item${addedCount > 1 ? 's' : ''} to T${intent.table}`,
  };
}

/**
 * REMOVE_ITEM — Remove an item from a table's order.
 */
async function handleRemoveItem(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  const order = await getOrderByTable(table.id);
  if (!order) {
    return { success: false, message: `No open order on T${intent.table}.` };
  }

  const orderItems = await getOrderItems(order.id);
  const itemName = (intent.item_name || '').toLowerCase();
  const targetItem = orderItems.find(
    (oi) => oi.name.toLowerCase().includes(itemName)
  );

  if (!targetItem) {
    return { success: false, message: `Item "${intent.item_name}" not found in order.` };
  }

  // Remove the order item
  await removeOrderItem(targetItem.id);
  await queueSync('order_items', 'DELETE', { id: targetItem.id });

  // Recalculate order totals
  const remainingItems = orderItems.filter((oi) => oi.id !== targetItem.id);
  const discountPercent = order.discount && order.subtotal > 0
    ? (order.discount / order.subtotal) * 100
    : 0;
  
  if (remainingItems.length === 0) {
    // No items left -> delete order, mark table as available
    await deleteOrder(order.id);
    await queueSync('orders', 'DELETE', { id: order.id });

    if (isTakeawayTable(table)) {
      await deleteTable(table.id);
      await queueSync('tables', 'DELETE', { id: table.id });
    } else {
      table.status = 'available';
      table.current_order_id = null;
      await upsertTable(table);
      await queueSync('tables', 'UPDATE', table);
    }
  } else {
    const updatedOrder = recalculateOrder(order, remainingItems, discountPercent);
    await updateOrder(updatedOrder);
    await queueSync('orders', 'UPDATE', updatedOrder);
  }

  // Update app state
  await refreshState(table);

  return {
    success: true,
    message: `Removed ${targetItem.name} from T${intent.table}`,
  };
}

/**
 * PAY_TABLE — Pay and close a table's order.
 */
async function handlePayTable(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  const order = await getOrderByTable(table.id);
  if (!order) {
    return { success: false, message: `No open order on T${intent.table}.` };
  }

  const state = getState();
  const now = new Date().toISOString();

  // Create transaction record
  const transaction = {
    id: uuidv4(),
    order_id: order.id,
    table_name: table.name,
    amount: order.total,
    subtotal: order.subtotal,
    tax: order.tax,
    service_charge: order.service_charge,
    discount: order.discount || 0,
    payment_method: 'cash',
    currency: state.currency || 'USD',
    paid_at: now,
  };
  await addTransaction(transaction);
  await queueSync('transactions', 'INSERT', transaction);

  try {
    const updatedInv = await deductInventoryForOrder(order.id);
    for (const item of updatedInv) {
      await queueSync('inventory', 'UPDATE', item);
    }
    if (updatedInv.length > 0) {
      const allInv = await getAllInventory();
      setState('inventory', allInv);
    }
  } catch (depletionErr) {
    console.warn('[CommandExecutor] Inventory stock depletion failed:', depletionErr);
  }

  // Close the order
  order.status = 'paid';
  order.paid_at = now;
  
  if (isTakeawayTable(table)) {
    const { table: archiveTable, isNew } = await getOrCreateTakeawayArchiveTable();
    if (isNew) {
      await queueSync('tables', 'UPDATE', archiveTable);
    }
    order.table_id = archiveTable.id;
    
    await updateOrder(order);
    await queueSync('orders', 'UPDATE', order);

    await deleteTable(table.id);
    await queueSync('tables', 'DELETE', { id: table.id });
  } else {
    await updateOrder(order);
    await queueSync('orders', 'UPDATE', order);

    // Reset the table
    table.status = 'available';
    table.current_order_id = null;
    await upsertTable(table);
    await queueSync('tables', 'UPDATE', table);
  }

  // Update app state
  const allTables = await getAllTables();
  setState('tables', allTables);

  const allTransactions = await getTodayTransactions();
  setState('transactions', allTransactions);

  // If this was the selected table, update current order state
  if (state.selectedTableId === table.id) {
    setState('currentOrder', null);
    setState('currentOrderItems', []);
  }

  return {
    success: true,
    message: `Table T${intent.table} paid — ${formatPrice(order.total)}`,
  };
}

/**
 * CLEAR_TABLE — Clear all items and the order from a table.
 */
async function handleClearTable(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  const order = await getOrderByTable(table.id);
  if (!order) {
    return { success: false, message: `No open order on T${intent.table}.` };
  }

  // Delete all order items
  const orderItems = await getOrderItems(order.id);
  for (const item of orderItems) {
    await removeOrderItem(item.id);
    await queueSync('order_items', 'DELETE', { id: item.id });
  }

  // Delete the order
  await deleteOrder(order.id);
  await queueSync('orders', 'DELETE', { id: order.id });

  // Reset the table
  table.status = 'available';
  table.current_order_id = null;
  await upsertTable(table);
  await queueSync('tables', 'UPDATE', table);

  // Update app state
  await refreshState(table);

  return {
    success: true,
    message: `Table T${intent.table} cleared`,
  };
}

/**
 * APPLY_DISCOUNT — Apply a percentage discount to a table's order.
 */
async function handleApplyDiscount(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  const order = await getOrderByTable(table.id);
  if (!order) {
    return { success: false, message: `No open order on T${intent.table}.` };
  }

  const orderItems = await getOrderItems(order.id);
  const discountPercent = parseFloat(intent.discount_percent) || 0;
  const updatedOrder = recalculateOrder(order, orderItems, discountPercent);
  await updateOrder(updatedOrder);
  await queueSync('orders', 'UPDATE', updatedOrder);

  // Update app state
  await refreshState(table);

  return {
    success: true,
    message: `${discountPercent}% discount applied to T${intent.table}`,
  };
}

/**
 * ADD_MENU_ITEM — Add a new item to the menu.
 */
async function handleAddMenuItem(intent) {
  const price = parseFloat(intent.price) || 0;
  const newItem = {
    id: uuidv4(),
    name: intent.name,
    price: price,
    emoji: intent.emoji || '🍽️',
    category: 'Other',
    is_active: true,
    created_at: new Date().toISOString(),
  };

  await addMenuItem(newItem);
  await queueSync('menu_items', 'INSERT', newItem);

  // Update state
  const allMenuItems = await getAllMenuItems();
  setState('menuItems', allMenuItems);

  return {
    success: true,
    message: `${intent.name} added to menu at ${formatPrice(price)}`,
  };
}

/**
 * DELETE_MENU_ITEM — Remove an item from the menu.
 */
async function handleDeleteMenuItem(intent) {
  const menuItems = getState().menuItems || [];
  const itemName = (intent.name || '').toLowerCase();
  const target = menuItems.find(
    (item) => item.name.toLowerCase().includes(itemName)
  );

  if (!target) {
    return { success: false, message: `Menu item "${intent.name}" not found.` };
  }

  await deleteMenuItemFromDB(target.id);
  await queueSync('menu_items', 'DELETE', { id: target.id });

  // Update state
  const allMenuItems = await getAllMenuItems();
  setState('menuItems', allMenuItems);

  return {
    success: true,
    message: `${target.name} removed from menu`,
  };
}

/**
 * GET_STATUS — Return status information about a table or revenue.
 */
async function handleGetStatus(intent) {
  if (intent.target === 'table' && intent.table) {
    const table = findTableByNumber(intent.table);
    if (!table) {
      return { success: false, message: `Table T${intent.table} not found.` };
    }

    const order = await getOrderByTable(table.id);
    if (!order) {
      return {
        success: true,
        message: `T${intent.table}: ${table.status}, no open order`,
      };
    }

    const orderItems = await getOrderItems(order.id);
    const itemCount = orderItems.reduce((sum, oi) => sum + oi.quantity, 0);

    return {
      success: true,
      message: `T${intent.table}: ${table.status}, ${itemCount} item${itemCount !== 1 ? 's' : ''}, total: ${formatPrice(order.total)}`,
    };
  }

  if (intent.target === 'revenue' || intent.target === 'all') {
    const todayTx = await getTodayTransactions();
    const totalRevenue = todayTx.reduce((sum, tx) => sum + (tx.amount || 0), 0);

    const allTables = await getAllTables();
    const occupiedTables = allTables.filter(t => t.status === 'occupied');
    
    let regularCount = 0;
    const channels = {};

    for (const t of occupiedTables) {
      const channel = getChannelFromTableName(t.name);
      if (channel === 'Regular') {
        regularCount++;
      } else {
        channels[channel] = (channels[channel] || 0) + 1;
      }
    }

    let statsArr = [];
    if (regularCount > 0) statsArr.push(`Tables Occupied - ${regularCount}`);
    for (const [ch, count] of Object.entries(channels)) {
      statsArr.push(`${ch} - ${count}`);
    }

    const occupiedStr = statsArr.length > 0 
      ? statsArr.join(', ')
      : 'No tables occupied';

    return {
      success: true,
      message: `${occupiedStr}. Today's daily revenue: ${formatPrice(totalRevenue)}.`,
    };
  }

  return { success: false, message: 'Unknown status target.' };
}

/**
 * TRANSFER_TABLE — Transfer an order from one table to another.
 */
async function handleTransferTable(intent) {
  const fromTable = findTableByNumber(intent.from_table);
  const toTable = findTableByNumber(intent.to_table);

  if (!fromTable) return { success: false, message: `Source table T${intent.from_table} not found.` };
  if (!toTable) return { success: false, message: `Destination table T${intent.to_table} not found.` };

  if (fromTable.status !== 'occupied' || !fromTable.current_order_id) {
    return { success: false, message: `Table T${intent.from_table} has no active order to transfer.` };
  }
  if (toTable.status === 'occupied') {
    return { success: false, message: `Table T${intent.to_table} is already occupied.` };
  }

  const order = await getOrderByTable(fromTable.id);
  if (!order) return { success: false, message: `No active order found for T${intent.from_table}.` };

  // Update order's table reference
  order.table_id = toTable.id;
  order.table_name = toTable.name;
  await updateOrder(order);
  await queueSync('orders', 'UPDATE', order);

  // Mark destination as occupied
  toTable.status = 'occupied';
  toTable.current_order_id = order.id;
  await upsertTable(toTable);
  await queueSync('tables', 'UPDATE', toTable);

  // Mark source as available
  fromTable.status = 'available';
  fromTable.current_order_id = null;
  await upsertTable(fromTable);
  await queueSync('tables', 'UPDATE', fromTable);

  // Update state
  await refreshState(toTable);
  await refreshState(fromTable);

  return {
    success: true,
    message: `Transferred order from T${intent.from_table} to T${intent.to_table}`,
  };
}

/**
 * UPDATE_MENU_PRICE — Update the price of a menu item.
 */
async function handleUpdateMenuPrice(intent) {
  const menuItems = getState().menuItems || [];
  const itemName = (intent.name || '').toLowerCase();
  const target = menuItems.find(
    (item) => item.name.toLowerCase().includes(itemName)
  );

  if (!target) {
    return { success: false, message: `Menu item "${intent.name}" not found.` };
  }

  const newPrice = parseFloat(intent.price) || 0;
  target.price = newPrice;
  await addMenuItem(target);
  await queueSync('menu_items', 'UPDATE', target);

  // Update state
  const allMenuItems = await getAllMenuItems();
  setState('menuItems', allMenuItems);

  return {
    success: true,
    message: `Updated price of ${target.name} to ${formatPrice(newPrice)}`,
  };
}

/**
 * UPDATE_ITEM_QUANTITY — Modify the quantity of an item already ordered.
 */
async function handleUpdateItemQuantity(intent) {
  const table = findTableByNumber(intent.table);
  if (!table) {
    return { success: false, message: `Table T${intent.table} not found.` };
  }

  const order = await getOrderByTable(table.id);
  if (!order) {
    return { success: false, message: `No open order on T${intent.table}.` };
  }

  // Need updateOrderItem inside commandExecutor imports? 
  // Wait, I didn't import updateOrderItem at the top of this file.
  // I will import it in the first chunk, or use another approach.
  // Actually, I can use addOrderItem instead since it uses database.put
  // Let me just import updateOrderItem at the top.
  
  const orderItems = await getOrderItems(order.id);
  const itemName = (intent.item_name || '').toLowerCase();
  const targetItem = orderItems.find(
    (oi) => oi.name.toLowerCase().includes(itemName)
  );

  if (!targetItem) {
    return { success: false, message: `Item "${intent.item_name}" not found in order on T${intent.table}.` };
  }

  const qty = parseInt(intent.qty, 10) || 0;

  if (qty <= 0) {
    // Treat as removal
    await removeOrderItem(targetItem.id);
    await queueSync('order_items', 'DELETE', { id: targetItem.id });
  } else {
    targetItem.quantity = qty;
    // Using addOrderItem which works like upsert
    await addOrderItem(targetItem);
    await queueSync('order_items', 'UPDATE', targetItem);
  }

  // Recalculate totals
  const allOrderItems = await getOrderItems(order.id);
  const discountPercent = order.discount && order.subtotal > 0
    ? (order.discount / order.subtotal) * 100
    : 0;

  if (allOrderItems.length === 0) {
    await deleteOrder(order.id);
    await queueSync('orders', 'DELETE', { id: order.id });

    if (isTakeawayTable(table)) {
      await deleteTable(table.id);
      await queueSync('tables', 'DELETE', { id: table.id });
    } else {
      table.status = 'available';
      table.current_order_id = null;
      await upsertTable(table);
      await queueSync('tables', 'UPDATE', table);
    }
  } else {
    const updatedOrder = recalculateOrder(order, allOrderItems, discountPercent);
    await updateOrder(updatedOrder);
    await queueSync('orders', 'UPDATE', updatedOrder);
  }

  await refreshState(table);

  return {
    success: true,
    message: `Updated quantity of ${targetItem.name} to ${qty} on T${intent.table}`,
  };
}

// ─────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────

/**
 * Recalculate order totals from its items.
 * @param {object} order — the order to update
 * @param {Array} orderItems — current order items
 * @param {number} discountPercent — discount percentage (0-100)
 * @returns {object} updated order with new totals
 */
function recalculateOrder(order, orderItems, discountPercent = 0) {
  const subtotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const taxConfig = getState().taxConfig || { vat: 10, service: 5 };
  const tax = subtotal * (taxConfig.vat / 100);
  const service = subtotal * (taxConfig.service / 100);
  const discount = subtotal * (discountPercent / 100);
  const total = subtotal + tax + service - discount;

  return {
    ...order,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    service_charge: Math.round(service * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

function findTableByNumber(tableInput) {
  if (tableInput === undefined || tableInput === null) return null;
  
  // Extract number from input (e.g. "T3" -> 3, "Table 5" -> 5)
  const numStr = String(tableInput).replace(/\D/g, '');
  const tableNum = parseInt(numStr);
  const tables = getState().tables || [];
  
  if (isNaN(tableNum)) {
    // If no digits found, check for direct name matches
    const cleanInput = String(tableInput).trim().toUpperCase();
    return tables.find(t => t.name === cleanInput || t.name === `T${cleanInput}`) || null;
  }
  
  const targetName = `T${tableNum}`;
  return tables.find((t) => t.name === targetName) || null;
}

/**
 * Fuzzy-match a menu item by name.
 * @param {string} name — the search name
 * @param {Array<{ name: string }>} menuItems — available items
 * @returns {object|null} matched menu item or null
 */
function findMenuItemByName(name, menuItems) {
  if (!name || !menuItems?.length) return null;

  const lower = name.toLowerCase().trim();

  const checkMatch = (query) => {
    // 1. Exact match
    const exact = menuItems.find((m) => m.name.toLowerCase() === query);
    if (exact) return exact;

    // 2. Contains (e.g. "burger" matches "Chicken Burger")
    const includes = menuItems.find((m) => m.name.toLowerCase().includes(query));
    if (includes) return includes;

    // 3. Reversed contains (e.g. "veg pizza deluxe" matches "Veg Pizza")
    const reverse = menuItems.find((m) => query.includes(m.name.toLowerCase()));
    if (reverse) return reverse;

    // 4. Starts with
    const starts = menuItems.find((m) => m.name.toLowerCase().startsWith(query));
    if (starts) return starts;

    return null;
  };

  // Try original query
  let match = checkMatch(lower);
  if (match) return match;

  // Try singular (remove trailing 's')
  if (lower.endsWith('s') && lower.length > 1) {
    match = checkMatch(lower.slice(0, -1));
    if (match) return match;
  }

  // Try removing trailing 'es' (e.g. fries -> frie, momos -> momo)
  if (lower.endsWith('es') && lower.length > 2) {
    match = checkMatch(lower.slice(0, -2));
    if (match) return match;
  }

  // Try splitting multiple words and checking individual words
  const words = lower.split(/\s+/);
  if (words.length > 1) {
    for (const word of words) {
      if (word.length > 2 && !['and', 'with', 'the', 'for', 'item', 'items'].includes(word)) {
        match = checkMatch(word);
        if (match) return match;
        
        if (word.endsWith('s')) {
          match = checkMatch(word.slice(0, -1));
          if (match) return match;
        }
      }
    }
  }

  return null;
}

/**
 * Refresh app state after a mutation affecting a specific table.
 * Updates tables list, and if the affected table is currently selected,
 * also refreshes the current order and order items.
 */
async function refreshState(table) {
  const allTables = await getAllTables();
  setState('tables', allTables);

  const state = getState();
  if (state.selectedTableId === table.id) {
    const order = await getOrderByTable(table.id);
    setState('currentOrder', order || null);

    if (order) {
      const items = await getOrderItems(order.id);
      setState('currentOrderItems', items);
    } else {
      setState('currentOrderItems', []);
    }
  }
}
