// Kitchen Display System (KDS) Module for TableCraft OS
import { getState, setState, on } from '../state.js';
import { 
  getOrderItems, 
  getAllMenuItems, 
  addMenuItem, 
  updateOrder, 
  getAllOrders,
  getOrder
} from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';

// Local list of recently bumped order IDs to support "Recall" functionality
let recentlyBumpedOrders = [];

// Periodic timer interval handle
let timerIntervalId = null;

/**
 * Initialize KDS dashboard controls, modal overlays, and listeners.
 */
export function initKitchenDashboard() {
  const btnKds86 = document.getElementById('btn-kds-86');
  const btnClose86 = document.getElementById('btn-close-86');
  const btnKdsRecall = document.getElementById('btn-kds-recall');
  const kds86Overlay = document.getElementById('kds-86-overlay');

  // Open 86 modal
  if (btnKds86) {
    btnKds86.addEventListener('click', () => {
      open86Modal();
    });
  }

  // Close 86 modal
  if (btnClose86) {
    btnClose86.addEventListener('click', () => {
      close86Modal();
    });
  }

  if (kds86Overlay) {
    kds86Overlay.addEventListener('click', () => {
      close86Modal();
    });
  }

  // Recall Last order
  if (btnKdsRecall) {
    btnKdsRecall.addEventListener('click', () => {
      recallLastOrder();
    });
  }

  // Subscribe to state updates
  on('orders', () => renderKitchenDashboard());
  on('menuItems', () => renderKitchenDashboard());

  // Setup periodic 1-second timer loop for ticket rail cards
  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateAllKdsTimers, 1000);

  // Initial render call
  renderKitchenDashboard();
}

/**
 * Open the 86 items control modal and load list.
 */
function open86Modal() {
  const modal = document.getElementById('kds-86-modal');
  if (modal) modal.classList.remove('hidden');
  render86ItemList();
}

/**
 * Close the 86 items control modal.
 */
function close86Modal() {
  const modal = document.getElementById('kds-86-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Render all menu items in the 86'ing modal with toggle buttons.
 */
async function render86ItemList() {
  const container = document.getElementById('kds-86-list');
  if (!container) return;

  const items = await getAllMenuItems();
  
  if (items.length === 0) {
    container.innerHTML = `<p class="text-slate-500 text-xs italic py-4">No menu items found.</p>`;
    return;
  }

  // Group items by category for structured layout
  const categories = {};
  items.forEach(item => {
    const cat = item.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  });

  container.innerHTML = Object.keys(categories).map(catName => {
    const catItems = categories[catName];
    const itemRows = catItems.map(item => {
      const isAvailable = item.is_active !== false;
      const btnClass = isAvailable 
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
        : 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30 font-bold';
      const labelText = isAvailable ? 'Available' : '86\'D (OUT)';
      const indicatorClass = isAvailable ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse';

      return `
        <div class="flex justify-between items-center py-2 border-b border-slate-800/40">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${indicatorClass}"></span>
            <span class="text-xs text-slate-100 font-medium">${item.emoji} ${item.name}</span>
          </div>
          <button class="toggle-86-btn border text-[10px] px-3 py-1.5 rounded-lg transition-colors font-semibold ${btnClass}" data-item-id="${item.id}" data-active="${isAvailable}">
            ${labelText}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="mb-4">
        <h4 class="text-[10px] text-slate-500 uppercase tracking-widest font-black mb-2">${catName}</h4>
        <div class="space-y-1">${itemRows}</div>
      </div>
    `;
  }).join('');

  // Attach toggle event handlers
  container.querySelectorAll('.toggle-86-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.getAttribute('data-item-id');
      const currentActive = btn.getAttribute('data-active') === 'true';
      await toggleItemAvailability(itemId, !currentActive);
    });
  });
}

/**
 * Toggle menu item is_active state and sync to cloud.
 */
async function toggleItemAvailability(itemId, newStatus) {
  try {
    const items = await getAllMenuItems();
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const updatedItem = {
      ...item,
      is_active: newStatus
    };

    await addMenuItem(updatedItem);
    await queueSync('menu_items', 'UPDATE', updatedItem);

    // Update global state and re-render local lists
    const freshItems = await getAllMenuItems();
    setState('menuItems', freshItems);
    
    // Refresh 86 list display
    render86ItemList();

    showToast(`"${item.name}" availability updated successfully`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to toggle item availability', 'error');
  }
}

/**
 * Recall the last bumped order back to the active kitchen queue.
 */
async function recallLastOrder() {
  if (recentlyBumpedOrders.length === 0) return;

  const orderId = recentlyBumpedOrders.pop();
  try {
    const order = await getOrder(orderId);
    if (order) {
      const restoredOrder = {
        ...order,
        kitchen_status: 'cooking'
      };
      await updateOrder(restoredOrder);
      await queueSync('orders', 'UPDATE', restoredOrder);

      // Trigger state change
      const allOrders = await getAllOrders();
      setState('orders', allOrders);

      showToast('Recalled last ticket back to cooking queue', 'info');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to recall order', 'error');
  }

  // Update recall button status
  updateRecallButton();
}

/**
 * Update the state of the Recall button and its count badge.
 */
function updateRecallButton() {
  const btnKdsRecall = document.getElementById('btn-kds-recall');
  const countSpan = document.getElementById('kds-recall-count');
  
  if (btnKdsRecall) {
    const count = recentlyBumpedOrders.length;
    if (countSpan) countSpan.innerText = count;
    btnKdsRecall.disabled = count === 0;
  }
}

/**
 * Render the main KDS Dashboard page.
 */
export async function renderKitchenDashboard() {
  const railContainer = document.getElementById('kds-rail');
  const aggregatorContainer = document.getElementById('kds-aggregator');
  
  if (!railContainer) return;

  const orders = getState().orders;
  const tables = getState().tables;

  // Filter for active tickets: open billing orders that are not marked as ready (cooked)
  const activeOrders = orders.filter(o => o.status === 'open' && o.kitchen_status !== 'ready');

  // Sort by created_at (oldest first / priority queue)
  activeOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Load items asynchronously for all active orders
  const ordersWithItems = await Promise.all(activeOrders.map(async (order) => {
    const items = await getOrderItems(order.id);
    return { ...order, items };
  }));

  // Render All-Day Cooking Matrix (Load Aggregator)
  renderAllDayMatrix(ordersWithItems, aggregatorContainer);

  // Render KDS Ticket Rail Cards
  if (ordersWithItems.length === 0) {
    railContainer.innerHTML = `
      <div class="w-full flex flex-col items-center justify-center py-24 text-slate-600">
        <span class="material-symbols-outlined text-6xl mb-3 text-slate-800">restaurant_menu</span>
        <p class="text-body-md font-medium">Kitchen queue is clear. No active tickets!</p>
      </div>
    `;
    updateRecallButton();
    return;
  }

  railContainer.innerHTML = ordersWithItems.map(order => {
    // Lookup table name
    const table = tables.find(t => t.id === order.table_id);
    const tableName = table ? table.name : 'Unknown';

    // Dine-In vs. Takeout/Delivery badges
    const channel = order.channel || 'Dine-in';
    const isDineIn = channel.toLowerCase() === 'dine-in';
    const channelBadge = isDineIn
      ? `<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]">deck</span> Dine-In</span>`
      : `<span class="bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-widest flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]">takeout_dining</span> Packaging</span>`;

    // Render items list inside ticket card
    const itemsListHtml = order.items.map(item => {
      // Parse modifications in parentheses
      const match = item.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      const itemName = match ? match[1].trim() : item.name;
      const modText = match ? match[2].trim() : '';

      const modBadge = modText
        ? `<div class="text-[10px] bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold px-2 py-1 rounded mt-1 uppercase tracking-wider animate-pulse">⚠️ MOD: ${modText}</div>`
        : '';

      return `
        <div class="py-2 border-b border-slate-800/40 last:border-b-0">
          <div class="flex justify-between items-start gap-1">
            <span class="text-slate-100 font-semibold text-sm">${itemName}</span>
            <span class="bg-slate-800 text-slate-200 font-black text-xs px-2 py-0.5 rounded min-w-[20px] text-center">×${item.quantity}</span>
          </div>
          ${modBadge}
        </div>
      `;
    }).join('');

    // Pre-calculate initial elapsed timer styles
    const elapsedSeconds = Math.floor((new Date() - new Date(order.created_at)) / 1000);
    const initialMin = Math.floor(elapsedSeconds / 60);
    const initialSec = elapsedSeconds % 60;
    const initialTimeStr = `${String(initialMin).padStart(2, '0')}:${String(initialSec).padStart(2, '0')}`;

    // Compute border card color based on initial time
    let cardColors = 'border-emerald-500/30 bg-slate-900/40 text-emerald-400';
    if (initialMin >= 20) {
      cardColors = 'border-rose-500 bg-rose-950/10 text-rose-500 animate-pulse';
    } else if (initialMin >= 15) {
      cardColors = 'border-orange-500/60 bg-orange-950/5 text-orange-500';
    } else if (initialMin >= 10) {
      cardColors = 'border-amber-500/40 bg-slate-900/40 text-amber-400';
    }

    return `
      <div class="kds-card flex flex-col w-[260px] min-w-[260px] bg-slate-900/80 border rounded-2xl shadow-xl transition-all select-none overflow-hidden" data-order-id="${order.id}">
        <!-- Card Header -->
        <div class="kds-card-header px-4 py-3 bg-slate-900 border-b border-slate-800/60 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-headline-lg text-headline-lg font-black text-slate-100">${tableName}</span>
            ${channelBadge}
          </div>
          <div class="kds-timer text-xs font-mono font-bold ${cardColors.split(' ').pop()}" data-created-at="${order.created_at}">
            ${initialTimeStr}
          </div>
        </div>
        
        <!-- Card Body -->
        <div class="flex-1 px-4 py-3 overflow-y-auto max-h-[300px] custom-scrollbar">
          ${itemsListHtml}
        </div>

        <!-- Card Footer -->
        <div class="px-4 py-3 bg-slate-900/60 border-t border-slate-800/40 mt-auto">
          <button class="kds-bump-btn w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 rounded-xl transition-all active:scale-[0.98] text-xs uppercase tracking-widest cursor-pointer" data-bump-order-id="${order.id}">
            Bump / Complete
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach bump action click handlers
  railContainer.querySelectorAll('[data-bump-order-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-bump-order-id');
      bumpOrder(orderId);
    });
  });

  // Update recall button state
  updateRecallButton();
}

/**
 * Render the aggregated cooking matrix list at the top.
 */
function renderAllDayMatrix(ordersWithItems, container) {
  if (!container) return;

  const summary = {};
  
  ordersWithItems.forEach(order => {
    order.items.forEach(item => {
      // Parse modifications for separate aggregation if modifications exist
      const match = item.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      const itemName = match ? match[1].trim() : item.name;
      const modText = match ? match[2].trim() : '';

      const key = modText ? `${itemName} (${modText})` : itemName;

      if (!summary[key]) {
        summary[key] = {
          name: itemName,
          mod: modText,
          qty: 0
        };
      }
      summary[key].qty += item.quantity;
    });
  });

  const keys = Object.keys(summary);
  if (keys.length === 0) {
    container.innerHTML = `<p class="text-xs italic text-slate-500 py-1">No items currently active.</p>`;
    return;
  }

  container.innerHTML = keys.map(key => {
    const entry = summary[key];
    const nameLabel = entry.mod 
      ? `<span>${entry.name} <span class="text-amber-400 text-[10px] font-bold">(${entry.mod})</span></span>`
      : `<span>${entry.name}</span>`;

    return `
      <div class="bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl flex items-center gap-2">
        <span class="bg-emerald-500 text-slate-950 font-black text-xs px-2 py-0.5 rounded">${entry.qty}</span>
        <span class="font-semibold text-slate-200 text-xs">${nameLabel}</span>
      </div>
    `;
  }).join('');
}

/**
 * Bump (complete) an active order in the kitchen and clear it.
 */
async function bumpOrder(orderId) {
  try {
    const order = await getOrder(orderId);
    if (!order) return;

    const updated = {
      ...order,
      kitchen_status: 'ready'
    };

    await updateOrder(updated);
    await queueSync('orders', 'UPDATE', updated);

    // Track recently bumped list (limit to 5)
    if (!recentlyBumpedOrders.includes(orderId)) {
      recentlyBumpedOrders.push(orderId);
      if (recentlyBumpedOrders.length > 5) recentlyBumpedOrders.shift();
    }

    // Refresh state
    const allOrders = await getAllOrders();
    setState('orders', allOrders);

    showToast('Ticket bumped to pass', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to bump order', 'error');
  }
}

/**
 * Iterate over all active KDS cards and update their timers and styling.
 */
function updateAllKdsTimers() {
  const activePage = getState().activePage;
  if (activePage !== 'kitchen') return;

  const timers = document.querySelectorAll('.kds-timer');
  timers.forEach(timer => {
    const createdAt = timer.getAttribute('data-created-at');
    if (!createdAt) return;

    const elapsedSeconds = Math.floor((new Date() - new Date(createdAt)) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    
    // Display time
    timer.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Dynamic styling check
    const card = timer.closest('.kds-card');
    if (!card) return;

    // Reset styles
    timer.className = 'kds-timer text-xs font-mono font-bold';
    card.className = 'kds-card flex flex-col w-[260px] min-w-[260px] bg-slate-900/80 border rounded-2xl shadow-xl transition-all select-none overflow-hidden';

    if (minutes >= 20) {
      // Flashing Red
      timer.classList.add('text-rose-500');
      card.classList.add('border-rose-500', 'bg-rose-950/10', 'text-rose-500', 'animate-pulse');
    } else if (minutes >= 15) {
      // Static Orange/Red
      timer.classList.add('text-orange-500');
      card.classList.add('border-orange-500/60', 'bg-orange-950/5', 'text-orange-500');
    } else if (minutes >= 10) {
      // Yellow warning
      timer.classList.add('text-amber-400');
      card.classList.add('border-amber-500/40', 'bg-slate-900/40', 'text-amber-400');
    } else {
      // Green fresh
      timer.classList.add('text-emerald-400');
      card.classList.add('border-emerald-500/30', 'bg-slate-900/40', 'text-emerald-400');
    }
  });
}
