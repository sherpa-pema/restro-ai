// Menu Management Panel Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, upsertTable, getAllMenuItems, addMenuItem, deleteMenuItem, getOrderByTable, createOrder, updateOrder, getOrderItems, addOrderItem, updateOrderItem, isTakeawayTable, getChannelFromTableName } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Menu panel controls.
 */
export function initMenuPanel() {
  const btnAddMenuItem = document.getElementById('btn-add-menu-item');
  const addMenuForm = document.getElementById('add-menu-form');
  const btnSaveMenuItem = document.getElementById('btn-save-menu-item');
  const btnCancelMenuItem = document.getElementById('btn-cancel-menu-item');

  // Toggle add item form
  if (btnAddMenuItem && addMenuForm) {
    btnAddMenuItem.addEventListener('click', () => {
      addMenuForm.classList.toggle('hidden');
      if (!addMenuForm.classList.contains('hidden')) {
        const nameInput = document.getElementById('menu-name-input');
        if (nameInput) nameInput.focus();
      }
    });
  }

  // Hide form and clear inputs
  const resetForm = () => {
    if (addMenuForm) addMenuForm.classList.add('hidden');
    const emojiInput = document.getElementById('menu-emoji-input');
    const nameInput = document.getElementById('menu-name-input');
    const priceInput = document.getElementById('menu-price-input');
    if (emojiInput) emojiInput.value = '🍽️';
    if (nameInput) nameInput.value = '';
    if (priceInput) priceInput.value = '';
  };

  if (btnCancelMenuItem) btnCancelMenuItem.addEventListener('click', resetForm);

  // Save new menu item
  if (btnSaveMenuItem) {
    btnSaveMenuItem.addEventListener('click', async () => {
      const emojiInput = document.getElementById('menu-emoji-input');
      const nameInput = document.getElementById('menu-name-input');
      const priceInput = document.getElementById('menu-price-input');

      if (!nameInput || !nameInput.value.trim()) {
        showToast('Item name is required', 'error');
        return;
      }
      if (!priceInput || isNaN(parseFloat(priceInput.value)) || parseFloat(priceInput.value) < 0) {
        showToast('Valid item price is required', 'error');
        return;
      }

      const name = nameInput.value.trim();
      const emoji = emojiInput ? emojiInput.value.trim() || '🍽️' : '🍽️';
      const price = parseFloat(priceInput.value);

      const newItem = {
        id: uuidv4(),
        name,
        emoji,
        price,
        category: 'General',
        is_active: true,
        created_at: new Date().toISOString()
      };

      try {
        await addMenuItem(newItem);
        await queueSync('menu_items', 'INSERT', newItem);

        // Refresh state
        const allItems = await getAllMenuItems();
        setState('menuItems', allItems);

        showToast(`${name} added to menu`, 'success');
        resetForm();
      } catch (err) {
        console.error(err);
        showToast('Failed to add menu item', 'error');
      }
    });
  }

  // Subscribe to changes
  on('menuItems', renderMenuPanel);
  on('currency', renderMenuPanel);
}

/**
 * Render Menu Grid cards.
 */
export function renderMenuPanel() {
  const grid = document.getElementById('menu-grid');
  const countSpan = document.getElementById('menu-count');
  if (!grid) return;

  const menuItems = getState().menuItems.filter(item => item.is_active !== false);
  if (countSpan) countSpan.innerText = menuItems.length;

  grid.innerHTML = menuItems.map(item => {
    return `
      <div class="group flex items-center justify-between p-md border border-outline-variant rounded-xl hover:border-primary transition-all bg-surface-container-lowest">
        <div class="flex items-center gap-md">
          <div class="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center">
            <span class="text-2xl">${item.emoji}</span>
          </div>
          <div>
            <h4 class="font-headline-md text-headline-md text-primary">${item.name}</h4>
            <p class="font-mono-md text-mono-md text-on-surface-variant">${formatPrice(item.price)}</p>
          </div>
        </div>
        <div class="flex items-center gap-xs">
          <button class="delete-menu-btn w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-delete-menu-id="${item.id}" title="Delete Item">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
          <button class="add-to-order-btn w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary transition-transform active:scale-90 group-hover:shadow-lg" data-add-menu-id="${item.id}">
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Setup click listeners for "+" buttons
  grid.querySelectorAll('[data-add-menu-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-add-menu-id');
      const item = menuItems.find(i => i.id === id);
      if (item) addItemToTable(item);
    });
  });

  // Setup click listeners for delete buttons
  grid.querySelectorAll('[data-delete-menu-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-menu-id');
      const item = menuItems.find(i => i.id === id);
      if (!item) return;

      if (confirm(`Remove "${item.name}" from the menu?`)) {
        try {
          await deleteMenuItem(id);
          await queueSync('menu_items', 'DELETE', { id });

          // Refresh state
          const allItems = await getAllMenuItems();
          setState('menuItems', allItems);

          showToast(`"${item.name}" removed from menu`, 'info');
        } catch (err) {
          console.error(err);
          showToast('Failed to remove menu item', 'error');
        }
      }
    });
  });
}

/**
 * Core business logic to append a menu item to the currently selected table's order.
 * @param {object} menuItem 
 */
async function addItemToTable(menuItem) {
  const state = getState();
  const selectedId = state.selectedTableId;
  
  if (!selectedId) { 
    showToast('Select a table first', 'error'); 
    return; 
  }
  
  const table = await getTable(selectedId);
  if (!table) return;
  
  try {
    // 1. Get or create open order
    let order = await getOrderByTable(selectedId);
    let isNewOrder = false;

    if (!order) {
      isNewOrder = true;
      const orderId = uuidv4();
      
      let orderChannel = 'Dine-in';
      if (isTakeawayTable(table)) {
        const channel = table.channel || getChannelFromTableName(table.name);
        if (channel === 'Regular') orderChannel = 'Takeout';
        else if (channel === 'Foodmandu') orderChannel = 'Foodmandu';
        else if (channel === 'Pathao') orderChannel = 'PathaoFood';
        else if (channel === 'BhojDeals' || channel === 'Bhojdeals') orderChannel = 'BhojDeals';
      }

      order = { 
        id: orderId, 
        table_id: selectedId, 
        status: 'open', 
        channel: orderChannel,
        subtotal: 0, 
        tax: 0, 
        service_charge: 0, 
        discount: 0, 
        total: 0, 
        created_at: new Date().toISOString() 
      };
      await createOrder(order);
      await queueSync('orders', 'INSERT', order);
    }
    
    // 2. Check if item already exists in order
    const existingItems = await getOrderItems(order.id);
    const existing = existingItems.find(i => i.menu_item_id === menuItem.id);
    
    if (existing) {
      existing.quantity += 1;
      await updateOrderItem(existing);
      await queueSync('order_items', 'UPDATE', existing);
    } else {
      const orderItem = { 
        id: uuidv4(), 
        order_id: order.id, 
        menu_item_id: menuItem.id, 
        name: menuItem.name, 
        price: menuItem.price, 
        quantity: 1 
      };
      await addOrderItem(orderItem);
      await queueSync('order_items', 'INSERT', orderItem);
    }
    
    // 3. Recalculate order totals
    const allItems = await getOrderItems(order.id);
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
    
    // 4. Update table status to occupied
    const updatedTable = { 
      ...table, 
      status: 'occupied', 
      current_order_id: order.id, 
      updated_at: new Date().toISOString() 
    };
    await upsertTable(updatedTable);
    await queueSync('tables', 'UPDATE', updatedTable);
    
    // 5. Update application reactive state to trigger UI rendering
    const tables = await getAllTables();
    setState('tables', tables);
    
    // If the affected table is currently selected, trigger sidebar/billing refresh
    if (selectedId === state.selectedTableId) {
      setState('currentOrder', updatedOrder);
      setState('currentOrderItems', allItems);
    }
    
    showToast(`${menuItem.name} added to ${table.name}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to add item to table', 'error');
  }
}
