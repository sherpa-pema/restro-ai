// Billing Panel Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, deleteTable, upsertTable, getOrderByTable, updateOrder, deleteOrder, getOrderItems, removeOrderItem, updateOrderItem, addTransaction, getAllTransactions, getTodayTransactions, deductInventoryForOrder, getAllInventory, getOrCreateTakeawayArchiveTable, isTakeawayTable, getChannelFromTableName } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Billing panel and setup button listeners.
 */
export function initBillingPanel() {
  const btnPay = document.getElementById('btn-pay');
  const btnClear = document.getElementById('btn-clear');
  const btnPrint = document.getElementById('btn-print');

  // Handle Pay and Close action
  if (btnPay) {
    btnPay.addEventListener('click', async () => {
      const state = getState();
      const order = state.currentOrder;
      const selectedTableId = state.selectedTableId;
      
      if (!order || !selectedTableId) return;

      const table = await getTable(selectedTableId);
      if (!table) return;

      try {
        const now = new Date().toISOString();
        
        let txCategory = 'Dine-in';
        if (order.channel === 'Takeout') txCategory = 'Regular';
        else if (order.channel === 'PathaoFood') txCategory = 'Pathao';
        else if (order.channel) txCategory = order.channel;

        // 1. Create Transaction
        const transaction = {
          id: uuidv4(),
          order_id: order.id,
          table_name: table.name,
          amount: order.total,
          payment_method: 'cash',
          currency: state.currency,
          category: txCategory,
          paid_at: now
        };
        await addTransaction(transaction);
        await queueSync('transactions', 'INSERT', transaction);

        // 1.5 Deduct Inventory stock (if recipe config exists)
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
          console.warn('[Billing] Inventory stock depletion failed:', depletionErr);
        }

        // 2. Complete Order
        let updatedOrder = {
          ...order,
          status: 'paid',
          paid_at: now
        };
        
        // 3. Mark Table as Available (or delete if takeaway slot and re-route order)
        if (isTakeawayTable(table)) {
          // Re-route order to the permanent Takeaway-Archive table to avoid foreign key errors on delete
          const { table: archiveTable, isNew } = await getOrCreateTakeawayArchiveTable();
          if (isNew) {
            await queueSync('tables', 'UPDATE', archiveTable);
          }
          updatedOrder.table_id = archiveTable.id;
          
          await updateOrder(updatedOrder);
          await queueSync('orders', 'UPDATE', updatedOrder);

          await deleteTable(table.id);
          await queueSync('tables', 'DELETE', { id: table.id });
        } else {
          await updateOrder(updatedOrder);
          await queueSync('orders', 'UPDATE', updatedOrder);

          const updatedTable = {
            ...table,
            status: 'available',
            current_order_id: null,
            updated_at: now
          };
          await upsertTable(updatedTable);
          await queueSync('tables', 'UPDATE', updatedTable);
        }

        // 4. Update reactive state
        const allTables = await getAllTables();
        const todayTx = await getTodayTransactions();
        
        setState('tables', allTables);
        setState('transactions', todayTx);
        setState('selectedTableId', null); // deselect table

        showToast(`Table ${table.name} paid: ${formatPrice(order.total)}`, 'success');
      } catch (err) {
        console.error(err);
        showToast('Payment processing failed', 'error');
      }
    });
  }

  // Handle Clear action (cancels/deletes current order)
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      const state = getState();
      const order = state.currentOrder;
      const selectedTableId = state.selectedTableId;

      if (!order || !selectedTableId) return;

      const table = await getTable(selectedTableId);
      if (!table) return;

      if (confirm(`Clear all items and cancel the order for Table ${table.name}?`)) {
        try {
          const now = new Date().toISOString();

          // 1. Delete order (cascade will delete items or we delete them in sync)
          await deleteOrder(order.id);
          await queueSync('orders', 'DELETE', { id: order.id });

          // 2. Mark table as available (or delete if takeaway slot)
          if (isTakeawayTable(table)) {
            await deleteTable(table.id);
            await queueSync('tables', 'DELETE', { id: table.id });
          } else {
            const updatedTable = {
              ...table,
              status: 'available',
              current_order_id: null,
              updated_at: now
            };
            await upsertTable(updatedTable);
            await queueSync('tables', 'UPDATE', updatedTable);
          }

          // 3. Update reactive state
          const allTables = await getAllTables();
          setState('tables', allTables);
          setState('selectedTableId', null);

          showToast(`Table ${table.name} order cleared`, 'info');
        } catch (err) {
          console.error(err);
          showToast('Failed to clear table order', 'error');
        }
      }
    });
  }

  // Handle Print Action (FastAPI print server connection)
  if (btnPrint) {
    btnPrint.addEventListener('click', async () => {
      const state = getState();
      const order = state.currentOrder;
      const orderItems = state.currentOrderItems;
      const selectedTableId = state.selectedTableId;

      if (!order || !selectedTableId) return;
      const table = await getTable(selectedTableId);
      if (!table) return;

      btnPrint.disabled = true;
      btnPrint.innerHTML = '<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> Sending to printer...';

      try {
        const payload = {
          order_id: order.id,
          table_name: table.name,
          currency: state.currency,
          subtotal: order.subtotal,
          tax: order.tax,
          service_charge: order.service_charge,
          discount: order.discount,
          total: order.total,
          items: orderItems.map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price
          })),
          timestamp: new Date().toISOString()
        };

        const res = await fetch('http://127.0.0.1:8000/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          showToast('Sent to printer successfully', 'success');
        } else {
          showToast(`Printer returned error: ${res.statusText}`, 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('FastAPI print server unreachable. Start server on localhost:8000', 'error');
      } finally {
        btnPrint.disabled = false;
        btnPrint.innerHTML = '<span class="material-symbols-outlined text-[18px]">print</span> Send to Printer';
      }
    });
  }

  // Handle discount input change dynamically
  const discountInput = document.getElementById('billing-discount-input');
  if (discountInput) {
    discountInput.addEventListener('input', async () => {
      const state = getState();
      const order = state.currentOrder;
      const items = state.currentOrderItems;
      if (!order) return;

      const discountPercent = discountInput.value !== '' ? (parseFloat(discountInput.value) || 0) : 0;
      
      const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const taxConfig = state.taxConfig;
      const tax = subtotal * (taxConfig.vat / 100);
      const service = subtotal * (taxConfig.service / 100);
      const discount = subtotal * (discountPercent / 100);
      const total = subtotal + tax + service - discount;

      const updatedOrder = {
        ...order,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        service_charge: Math.round(service * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        total: Math.round(total * 100) / 100
      };

      try {
        await updateOrder(updatedOrder);
        await queueSync('orders', 'UPDATE', updatedOrder);
        
        setState('currentOrder', updatedOrder);
        
        const allTables = await getAllTables();
        setState('tables', allTables);
      } catch (err) {
        console.error(err);
        showToast('Failed to update discount', 'error');
      }
    });
  }

  // Bind state listeners
  on('selectedTableId', loadSelectedTableOrder);
  on('currentOrder', renderBillingPanel);
  on('currentOrderItems', renderBillingPanel);
  on('currency', renderBillingPanel);
}

/**
 * Loads order details when a new table is selected.
 * @param {string|null} tableId 
 */
async function loadSelectedTableOrder(tableId) {
  const placeholder = document.getElementById('billing-placeholder');
  const content = document.getElementById('billing-content');
  const tableNameSpan = document.getElementById('billing-table-name');
  const statusSpan = document.getElementById('billing-status');

  if (!tableId) {
    if (placeholder) placeholder.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    if (tableNameSpan) tableNameSpan.innerText = 'Select Table';
    if (statusSpan) statusSpan.innerText = '';
    
    const discountInput = document.getElementById('billing-discount-input');
    if (discountInput) discountInput.value = '';

    setState('currentOrder', null);
    setState('currentOrderItems', []);
    return;
  }

  try {
    const table = await getTable(tableId);
    if (!table) return;

    if (tableNameSpan) tableNameSpan.innerText = table.name;
    if (statusSpan) {
      if (isTakeawayTable(table)) {
        const channel = table.channel || getChannelFromTableName(table.name);
        const channelLabel = channel ? channel.toUpperCase() : 'TAKEAWAY';
        statusSpan.innerText = `(${channelLabel})`;
        statusSpan.className = `font-label-md text-[10px] uppercase font-bold tracking-widest text-purple-600 dark:text-purple-400`;
      } else {
        statusSpan.innerText = `(${table.status.toUpperCase()})`;
        statusSpan.className = `font-label-md text-[10px] uppercase font-bold tracking-widest ${table.status === 'occupied' ? 'text-primary' : 'text-secondary'}`;
      }
    }

    const order = await getOrderByTable(tableId);
    if (order) {
      const items = await getOrderItems(order.id);
      setState('currentOrder', order);
      setState('currentOrderItems', items);

      // Populate discount input field
      const discountInput = document.getElementById('billing-discount-input');
      if (discountInput) {
        const discountPercent = order.subtotal > 0 ? (order.discount / order.subtotal) * 100 : 0;
        discountInput.value = discountPercent > 0 ? Math.round(discountPercent) : '';
      }
      
      if (placeholder) placeholder.classList.add('hidden');
      if (content) content.classList.remove('hidden');
    } else {
      setState('currentOrder', null);
      setState('currentOrderItems', []);
      
      const discountInput = document.getElementById('billing-discount-input');
      if (discountInput) discountInput.value = '';

      if (placeholder) placeholder.classList.remove('hidden');
      if (content) content.classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to load table billing data', 'error');
  }
}

/**
 * Render order items, calculated pricing subtotals and action buttons.
 */
export function renderBillingPanel() {
  const order = getState().currentOrder;
  const items = getState().currentOrderItems;
  const placeholder = document.getElementById('billing-placeholder');
  const content = document.getElementById('billing-content');
  const itemsContainer = document.getElementById('billing-items');

  if (!order || items.length === 0) {
    if (placeholder) placeholder.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    return;
  }

  if (placeholder) placeholder.classList.add('hidden');
  if (content) content.classList.remove('hidden');

  // Update order channel display text
  const billingChannelDisplay = document.getElementById('billing-channel-display');
  if (billingChannelDisplay) {
    let displayVal = order.channel || 'Dine-in';
    if (displayVal === 'PathaoFood') displayVal = 'Pathao';
    billingChannelDisplay.innerText = displayVal;
  }

  // Helper to parse notes in parentheses from item names
  function parseItemName(fullName) {
    const match = fullName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      return { baseName: match[1].trim(), note: match[2].trim() };
    }
    return { baseName: fullName, note: '' };
  }

  // Action to edit item note
  async function editItemNote(itemId) {
    const currentItems = getState().currentOrderItems;
    const orderItem = currentItems.find(i => i.id === itemId);
    if (!orderItem) return;

    const { baseName, note } = parseItemName(orderItem.name);
    const newNote = prompt(`Enter special instructions for ${baseName} (e.g. NO ONIONS, ALLERGY: GLUTEN):`, note);
    
    if (newNote === null) return; // cancelled

    const trimmed = newNote.trim();
    const newFullName = trimmed ? `${baseName} (${trimmed.toUpperCase()})` : baseName;

    try {
      const updated = {
        ...orderItem,
        name: newFullName
      };
      await updateOrderItem(updated);
      await queueSync('order_items', 'UPDATE', updated);

      // Refresh state
      const currentOrder = getState().currentOrder;
      if (currentOrder) {
        const allItems = await getOrderItems(currentOrder.id);
        setState('currentOrderItems', allItems);
        
        // Also trigger orders update to refresh other dashboards
        const allOrders = await getAllOrders();
        setState('orders', allOrders);
      }
      showToast('Special instructions updated', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update special instructions', 'error');
    }
  }

  // Render items rows
  if (itemsContainer) {
    itemsContainer.innerHTML = items.map(item => {
      const { baseName, note } = parseItemName(item.name);
      return `
        <div class="group flex flex-col py-2 hover:bg-surface-container rounded-lg px-2 transition-all border-b border-outline-variant/30">
          <div class="flex justify-between items-center w-full">
            <div class="flex items-center gap-sm">
              <span class="font-mono-md text-primary font-bold">${item.quantity}×</span>
              <span class="font-body-lg text-body-lg text-primary font-medium">${baseName}</span>
            </div>
            <div class="flex items-center gap-sm">
              <span class="font-mono-md font-bold text-primary">${formatPrice(item.price * item.quantity)}</span>
              <button class="remove-item-btn w-6 h-6 rounded-full bg-error/10 text-error flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 hover:!opacity-100 transition-opacity" data-remove-item-id="${item.id}" title="Reduce Quantity">
                <span class="material-symbols-outlined text-[14px]">remove</span>
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between pl-6 text-xs text-on-surface-variant gap-2 mt-1">
            <span class="italic text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              ${note ? `Instructions: ${note}` : 'No instructions'}
            </span>
            <button class="edit-note-btn text-[10px] text-primary hover:underline font-semibold" data-edit-note-id="${item.id}" title="Edit Instructions">
              Edit Note
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners for decrementing quantity
    itemsContainer.querySelectorAll('[data-remove-item-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-remove-item-id');
        decrementItem(itemId);
      });
    });

    // Attach listeners for editing notes
    itemsContainer.querySelectorAll('[data-edit-note-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-edit-note-id');
        editItemNote(itemId);
      });
    });
  }

  // Update calculation texts
  const subtotalText = document.getElementById('billing-subtotal');
  const vatText = document.getElementById('billing-vat');
  const serviceText = document.getElementById('billing-service');
  const discountRow = document.getElementById('billing-discount-row');
  const discountText = document.getElementById('billing-discount');
  const totalText = document.getElementById('billing-total');

  if (subtotalText) subtotalText.innerText = formatPrice(order.subtotal);
  if (vatText) vatText.innerText = formatPrice(order.tax);
  if (serviceText) serviceText.innerText = formatPrice(order.service_charge);
  
  if (order.discount > 0) {
    if (discountRow) discountRow.classList.remove('hidden');
    if (discountText) discountText.innerText = `-${formatPrice(order.discount)}`;
  } else {
    if (discountRow) discountRow.classList.add('hidden');
  }

  if (totalText) totalText.innerText = formatPrice(order.total);
}

/**
 * Decrement the quantity of a selected order item.
 * @param {string} itemId 
 */
async function decrementItem(itemId) {
  const state = getState();
  const order = state.currentOrder;
  const items = state.currentOrderItems;
  const selectedTableId = state.selectedTableId;
  
  if (!order || !selectedTableId) return;

  const item = items.find(i => i.id === itemId);
  if (!item) return;

  try {
    const now = new Date().toISOString();

    if (item.quantity > 1) {
      // 1. Decrement Quantity
      item.quantity -= 1;
      await updateOrderItem(item);
      await queueSync('order_items', 'UPDATE', item);
    } else {
      // 2. Remove Item completely
      await removeOrderItem(itemId);
      await queueSync('order_items', 'DELETE', { id: itemId });
    }

    // 3. Recalculate
    const allItems = await getOrderItems(order.id);
    
    if (allItems.length === 0) {
      // No items left -> delete order, mark table as available
      await deleteOrder(order.id);
      await queueSync('orders', 'DELETE', { id: order.id });

      const table = await getTable(selectedTableId);
      if (table) {
        if (isTakeawayTable(table)) {
          await deleteTable(table.id);
          await queueSync('tables', 'DELETE', { id: table.id });
        } else {
          const updatedTable = {
            ...table,
            status: 'available',
            current_order_id: null,
            updated_at: now
          };
          await upsertTable(updatedTable);
          await queueSync('tables', 'UPDATE', updatedTable);
        }
      }

      const allTables = await getAllTables();
      setState('tables', allTables);
      
      if (table && isTakeawayTable(table)) {
        setState('selectedTableId', null);
      } else {
        setState('selectedTableId', selectedTableId); // Reload table order
      }
    } else {
      // Recalculate order values
      const subtotal = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const taxConfig = state.taxConfig;
      const tax = subtotal * (taxConfig.vat / 100);
      const service = subtotal * (taxConfig.service / 100);
      
      const discountInput = document.getElementById('billing-discount-input');
      const discountPercent = discountInput && discountInput.value !== '' ? (parseFloat(discountInput.value) || 0) : (order.subtotal > 0 ? (order.discount / order.subtotal) * 100 : 0);
      const discount = subtotal * (discountPercent / 100);
      const total = subtotal + tax + service - discount;

      const updatedOrder = {
        ...order,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        service_charge: Math.round(service * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        total: Math.round(total * 100) / 100
      };
      await updateOrder(updatedOrder);
      await queueSync('orders', 'UPDATE', updatedOrder);

      // Update state
      setState('currentOrder', updatedOrder);
      setState('currentOrderItems', allItems);
      
      // Update floor plan pricing display
      const allTables = await getAllTables();
      setState('tables', allTables);
    }

    showToast('Order item updated', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to update item quantity', 'error');
  }
}
