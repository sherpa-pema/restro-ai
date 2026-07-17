// Revenue & Operations Dashboard Module for TableCraft OS
import { getState, setState, on, formatPrice, getLocalDateString } from '../state.js';
import { getAllTables, getOrderByTable, getOrderItems, getAllOrders, getAllInventory, getTodayWaste, upsertInventory, addWasteLog } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Revenue Dashboard and setup operational bindings.
 */
export function initRevenueDashboard() {
  // Bind state update listeners
  on('transactions', renderRevenueDashboard);
  on('tables', renderRevenueDashboard);
  on('orders', renderRevenueDashboard);
  on('inventory', renderRevenueDashboard);
  on('waste', renderRevenueDashboard);
  on('currency', renderRevenueDashboard);

  // Setup Waste Logging Modal Bindings
  const btnOpenWaste = document.getElementById('btn-open-log-waste');
  const modalWaste = document.getElementById('log-waste-modal');
  const btnCancelWaste = document.getElementById('btn-cancel-waste');
  const overlayWaste = document.getElementById('log-waste-overlay');
  const btnSaveWaste = document.getElementById('btn-save-waste');
  const selectIngredient = document.getElementById('waste-ingredient-select');
  const inputQuantity = document.getElementById('waste-quantity');
  const inputReason = document.getElementById('waste-reason');
  const labelUnit = document.getElementById('waste-unit-label');

  if (btnOpenWaste && modalWaste) {
    btnOpenWaste.addEventListener('click', () => {
      modalWaste.classList.remove('hidden');
      populateWasteModalIngredients();
    });
  }

  const closeWasteModal = () => {
    if (modalWaste) modalWaste.classList.add('hidden');
    if (inputQuantity) inputQuantity.value = 1.0;
    if (inputReason) inputReason.value = '';
  };

  if (btnCancelWaste) btnCancelWaste.addEventListener('click', closeWasteModal);
  if (overlayWaste) overlayWaste.addEventListener('click', closeWasteModal);

  if (selectIngredient && labelUnit) {
    selectIngredient.addEventListener('change', () => {
      const inv = getState().inventory || [];
      const selectedItem = inv.find(i => i.id === selectIngredient.value);
      labelUnit.innerText = selectedItem ? selectedItem.unit : 'units';
    });
  }

  if (btnSaveWaste) {
    btnSaveWaste.addEventListener('click', async () => {
      const ingredientId = selectIngredient.value;
      const quantity = parseFloat(inputQuantity.value);
      const reason = inputReason.value.trim() || 'Unspecified waste';

      if (!ingredientId || isNaN(quantity) || quantity <= 0) {
        showToast('Valid ingredient and quantity are required', 'error');
        return;
      }

      const inv = getState().inventory || [];
      const ingredient = inv.find(i => i.id === ingredientId);
      if (!ingredient) return;

      if (ingredient.current_stock < quantity) {
        showToast(`Cannot waste more than current stock (${ingredient.current_stock} ${ingredient.unit})`, 'error');
        return;
      }

      const cost = Math.round(quantity * ingredient.unit_cost * 100) / 100;
      const now = new Date().toISOString();

      const wasteLog = {
        id: uuidv4(),
        ingredient_id: ingredientId,
        ingredient_name: ingredient.ingredient_name,
        quantity,
        cost,
        reason,
        wasted_at: now
      };

      const updatedIngredient = {
        ...ingredient,
        current_stock: Math.max(0, Math.round((ingredient.current_stock - quantity) * 100) / 100),
        updated_at: now
      };

      try {
        // 1. Save waste log
        await addWasteLog(wasteLog);
        await queueSync('waste', 'INSERT', wasteLog);

        // 2. Update stock level
        await upsertInventory(updatedIngredient);
        await queueSync('inventory', 'UPDATE', updatedIngredient);

        // 3. Update memory state
        const allInv = await getAllInventory();
        const todayWaste = await getTodayWaste();
        setState('inventory', allInv);
        setState('waste', todayWaste);

        showToast(`Logged ${quantity} ${ingredient.unit} of ${ingredient.ingredient_name} wasted (Cost: ${formatPrice(cost)})`, 'info');
        closeWasteModal();
      } catch (err) {
        console.error(err);
        showToast('Failed to log wasted stock', 'error');
      }
    });
  }

  // Setup Inventory Refill Button delegation
  const adjustGrid = document.getElementById('inventory-adjust-grid');
  if (adjustGrid) {
    adjustGrid.addEventListener('click', async (e) => {
      const refillBtn = e.target.closest('[data-refill-id]');
      if (!refillBtn) return;

      const id = refillBtn.getAttribute('data-refill-id');
      const inv = getState().inventory || [];
      const item = inv.find(i => i.id === id);
      if (!item) return;

      const updated = {
        ...item,
        current_stock: Math.round((item.current_stock + 5) * 100) / 100,
        updated_at: new Date().toISOString()
      };

      try {
        await upsertInventory(updated);
        await queueSync('inventory', 'UPDATE', updated);
        
        const allInv = await getAllInventory();
        setState('inventory', allInv);
        showToast(`Added +5 ${item.unit} to ${item.ingredient_name} stock`, 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to update stock level', 'error');
      }
    });
  }
}

/** Populate ingredients inside waste log modal */
function populateWasteModalIngredients() {
  const selectIngredient = document.getElementById('waste-ingredient-select');
  const labelUnit = document.getElementById('waste-unit-label');
  const inv = getState().inventory || [];

  if (selectIngredient) {
    if (inv.length === 0) {
      selectIngredient.innerHTML = '<option value="">No ingredients loaded</option>';
      return;
    }

    selectIngredient.innerHTML = inv.map(item => `<option value="${item.id}">${item.ingredient_name} (Stock: ${item.current_stock} ${item.unit})</option>`).join('');
    
    // Set initial unit label
    const firstItem = inv[0];
    if (labelUnit && firstItem) {
      labelUnit.innerText = firstItem.unit;
    }
  }
}

/**
 * Render Revenue operational stats, dynamic SVG charts and inventory warnings.
 */
export function renderRevenueDashboard() {
  const state = getState();
  const transactions = state.transactions || [];
  const tables = state.tables || [];
  const orders = state.orders || [];
  const inventory = state.inventory || [];
  const waste = state.waste || [];

  const todayStr = getLocalDateString(new Date());

  // Filter orders completed, active, and cancelled today
  const todayOrders = orders.filter(o => o && o.created_at && getLocalDateString(o.created_at) === todayStr);
  const completedOrders = todayOrders.filter(o => o.status === 'paid');
  const progressOrders = todayOrders.filter(o => o.status === 'open');
  const cancelledOrders = todayOrders.filter(o => o.status === 'cancelled');

  // Calculate Net & Gross Sales
  const grossSales = completedOrders.reduce((sum, o) => sum + Number(o.subtotal || 0), 0);
  const totalDiscounts = completedOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);
  const netSales = Math.max(0, grossSales - totalDiscounts);

  // Update top summary cards
  const elNetSales = document.getElementById('dashboard-net-sales');
  const elGrossSalesSub = document.getElementById('dashboard-gross-sales-sub');
  const elAov = document.getElementById('dashboard-aov');
  const elTurnover = document.getElementById('dashboard-turnover');
  const elOccupied = document.getElementById('dashboard-active-occupied');
  const elWasteCost = document.getElementById('dashboard-waste-cost');

  if (elNetSales) elNetSales.innerText = formatPrice(netSales);
  if (elGrossSalesSub) elGrossSalesSub.innerText = `Gross: ${formatPrice(grossSales)}`;

  // AOV (Average Order Value)
  const aovValue = completedOrders.length > 0 ? netSales / completedOrders.length : 0;
  if (elAov) elAov.innerText = formatPrice(aovValue);

  // Table Turnover Rate
  const completedWithTime = completedOrders.filter(o => o.paid_at && o.created_at);
  const avgTurnMins = completedWithTime.length > 0 
    ? completedWithTime.reduce((sum, o) => {
        const diffMs = new Date(o.paid_at) - new Date(o.created_at);
        return sum + Math.max(1, Math.round(diffMs / 60000));
      }, 0) / completedWithTime.length
    : 0;
  if (elTurnover) elTurnover.innerText = `${Math.round(avgTurnMins)} mins`;

  // Occupied table count
  const occupiedCount = tables.filter(t => t.status === 'occupied').length;
  if (elOccupied) elOccupied.innerText = `Occupied: ${occupiedCount}/${tables.length}`;

  // Waste Cost
  const totalWasteToday = waste.reduce((sum, w) => sum + Number(w.cost || 0), 0);
  if (elWasteCost) elWasteCost.innerText = formatPrice(totalWasteToday);

  // Render Order Volumes split list
  const elVolCompleted = document.getElementById('volume-completed');
  const elVolProgress = document.getElementById('volume-progress');
  const elVolCanceled = document.getElementById('volume-canceled');

  if (elVolCompleted) elVolCompleted.innerText = completedOrders.length;
  if (elVolProgress) elVolProgress.innerText = progressOrders.length;
  if (elVolCanceled) elVolCanceled.innerText = cancelledOrders.length;

  // Render SVG charts
  drawSalesPeakRushChart(completedOrders);
  drawChannelsSplitChart(completedOrders);

  // Render Low Stock Alerts List
  renderLowStockAlerts(inventory);

  // Render Inventory Quick Adjust Grid
  renderInventoryQuickAdjust(inventory);

  // Render payments list
  renderPaymentsLog(transactions);
}

/** Render line chart for hourly peak rushes using responsive SVG shapes */
function drawSalesPeakRushChart(completedOrders) {
  const container = document.getElementById('sales-chart-container');
  if (!container) return;

  // Hourly slots from 08:00 to 22:00 (15 hourly data bins)
  const hourlyBins = Array(15).fill(0);
  completedOrders.forEach(o => {
    if (!o.paid_at) return;
    const hour = new Date(o.paid_at).getHours();
    if (hour >= 8 && hour <= 22) {
      hourlyBins[hour - 8] += Number(o.total || 0);
    }
  });

  const maxVal = Math.max(...hourlyBins, 500); // minimum scale peak
  const width = 500;
  const height = 180;
  const padL = 45;
  const padR = 20;
  const padT = 15;
  const padB = 25;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Create grid lines and background ticks
  let gridLines = '';
  for (let i = 0; i <= 4; i++) {
    const yVal = padT + (i / 4) * chartH;
    const priceTick = maxVal - (i / 4) * maxVal;
    gridLines += `
      <line x1="${padL}" y1="${yVal}" x2="${width - padR}" y2="${yVal}" stroke="rgba(116,120,120,0.1)" stroke-width="1"/>
      <text x="${padL - 10}" y="${yVal + 4}" fill="rgba(68,71,72,0.6)" font-size="9" font-family="monospace" text-anchor="end">${Math.round(priceTick)}</text>
    `;
  }

  // Define points path coordinates
  const points = hourlyBins.map((val, i) => {
    const x = padL + (i / 14) * chartW;
    const y = height - padB - (val / maxVal) * chartH;
    return { x, y };
  });

  let lineD = `M ${points[0].x} ${points[0].y}`;
  let areaD = `M ${points[0].x} ${height - padB} L ${points[0].x} ${points[0].y}`;

  // Create smooth bezier coordinates
  for (let i = 0; i < points.length - 1; i++) {
    const cpX1 = points[i].x + (points[i+1].x - points[i].x) / 3;
    const cpY1 = points[i].y;
    const cpX2 = points[i].x + 2 * (points[i+1].x - points[i].x) / 3;
    const cpY2 = points[i+1].y;
    lineD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i+1].x} ${points[i+1].y}`;
    areaD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i+1].x} ${points[i+1].y}`;
  }

  areaD += ` L ${points[points.length - 1].x} ${height - padB} Z`;

  // Draw timeline labels
  const timeLabels = ['08am', '11am', '02pm', '05pm', '08pm', '10pm'];
  let timeLabelTags = '';
  timeLabels.forEach((label, idx) => {
    const ratio = idx / (timeLabels.length - 1);
    const x = padL + ratio * chartW;
    timeLabelTags += `<text x="${x}" y="${height - 5}" fill="rgba(68,71,72,0.8)" font-size="9" font-family="sans-serif" text-anchor="middle">${label}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-full">
      <defs>
        <linearGradient id="sales-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--md-sys-color-primary)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--md-sys-color-primary)" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaD}" fill="url(#sales-grad)" />
      <path d="${lineD}" fill="none" stroke="var(--md-sys-color-primary)" stroke-width="2.5" stroke-linecap="round" />
      ${timeLabelTags}
    </svg>
  `;
}

/** Render doughnut chart for order channels split using SVG arcs */
function drawChannelsSplitChart(completedOrders) {
  const container = document.getElementById('channels-chart-container');
  const legendContainer = document.getElementById('channels-legend');
  if (!container || !legendContainer) return;

  const channelRevenue = {
    'Dine-in': 0,
    'Takeout': 0,
    'Foodmandu': 0,
    'PathaoFood': 0,
    'BhojDeals': 0
  };

  completedOrders.forEach(o => {
    const ch = o.channel || 'Dine-in';
    if (channelRevenue.hasOwnProperty(ch)) {
      channelRevenue[ch] += Number(o.total || 0);
    }
  });

  const total = Object.values(channelRevenue).reduce((sum, v) => sum + v, 0);

  // Color mapping
  const colors = {
    'Dine-in': '#0072b2',
    'Takeout': '#e69f00',
    'Foodmandu': '#009e73',
    'PathaoFood': '#cc79a7',
    'BhojDeals': '#cc5500'
  };

  if (total === 0) {
    container.innerHTML = `
      <svg viewBox="0 0 180 180" class="w-full h-full max-w-[150px]">
        <circle cx="90" cy="90" r="60" fill="none" stroke="#eceef0" stroke-width="20" />
        <text x="90" y="95" fill="rgba(68,71,72,0.6)" font-size="10" text-anchor="middle" font-weight="bold">No Sales</text>
      </svg>
    `;
    legendContainer.innerHTML = Object.keys(channelRevenue).map(ch => `
      <div class="flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-sm" style="background-color: ${colors[ch]}"></span>
        <span class="truncate">${ch}: ${formatPrice(0)}</span>
      </div>
    `).join('');
    return;
  }

  // Draw Doughnut segments
  const r = 60;
  const circ = 2 * Math.PI * r;
  let accumPercent = 0;
  let arcsSvg = '';

  Object.entries(channelRevenue).forEach(([ch, val]) => {
    if (val === 0) return;
    const percent = val / total;
    const strokeDash = percent * circ;
    const offset = -accumPercent * circ;

    arcsSvg += `
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="${colors[ch]}" stroke-width="20"
        stroke-dasharray="${strokeDash} ${circ}" stroke-dashoffset="${offset}"
        transform="rotate(-90 90 90)" class="transition-all duration-300" />
    `;
    accumPercent += percent;
  });

  container.innerHTML = `
    <svg viewBox="0 0 180 180" class="w-full h-full max-w-[150px]">
      <circle cx="90" cy="90" r="60" fill="none" stroke="#eceef0" stroke-width="20" />
      ${arcsSvg}
      <text x="90" y="95" fill="var(--md-sys-color-primary)" font-size="10" text-anchor="middle" font-weight="black">${formatPrice(total)}</text>
    </svg>
  `;

  // Render legend list
  legendContainer.innerHTML = Object.entries(channelRevenue).map(([ch, val]) => `
    <div class="flex items-center gap-1.5">
      <span class="w-2.5 h-2.5 rounded-sm" style="background-color: ${colors[ch]}"></span>
      <span class="truncate">${ch}: <strong>${formatPrice(val)}</strong></span>
    </div>
  `).join('');
}

/** Render warnings when items are low stock */
function renderLowStockAlerts(inventory) {
  const container = document.getElementById('stock-alerts-list');
  if (!container) return;

  const lowStock = inventory.filter(item => item.current_stock <= item.reorder_threshold);

  if (lowStock.length === 0) {
    container.className = 'flex flex-col items-center justify-center p-md bg-secondary/5 rounded-xl border border-secondary/15 py-8';
    container.innerHTML = `
      <span class="material-symbols-outlined text-[32px] text-secondary/60 mb-2">task_alt</span>
      <p class="text-body-md text-secondary font-bold text-center">All stocks are within safe limits.</p>
    `;
    return;
  }

  container.className = 'grid grid-cols-1 sm:grid-cols-2 gap-sm';
  container.innerHTML = lowStock.map(item => `
    <div class="p-md bg-error/5 rounded-xl border border-error/20 flex justify-between items-center relative overflow-hidden">
      <div class="absolute left-0 top-0 bottom-0 w-1 bg-error animate-pulse"></div>
      <div>
        <h5 class="font-headline-md text-headline-md text-primary font-bold">${item.ingredient_name}</h5>
        <p class="text-[11px] text-on-surface-variant font-mono-md">Current: <span class="text-error font-bold">${item.current_stock}</span> / Min: ${item.reorder_threshold} ${item.unit}</p>
      </div>
      <span class="text-[10px] font-bold uppercase tracking-wider text-error bg-error/15 px-2 py-0.5 rounded animate-pulse">Low Stock</span>
    </div>
  `).join('');
}

/** Render inventory adjust list */
function renderInventoryQuickAdjust(inventory) {
  const container = document.getElementById('inventory-adjust-grid');
  if (!container) return;

  if (inventory.length === 0) {
    container.innerHTML = '<p class="text-body-md text-on-surface-variant italic py-4 col-span-3">No inventory items loaded.</p>';
    return;
  }

  container.innerHTML = inventory.map(item => {
    const isLow = item.current_stock <= item.reorder_threshold;
    const borderClass = isLow ? 'border-error/30 bg-error/5 hover:bg-error/10' : 'border-outline-variant hover:bg-surface-variant/40';
    return `
      <div class="p-md bg-surface-container rounded-xl border flex flex-col justify-between ${borderClass} transition-colors min-h-[90px]">
        <div>
          <p class="text-[11px] font-bold text-primary truncate" title="${item.ingredient_name}">${item.ingredient_name}</p>
          <p class="text-[12px] font-mono-md font-bold mt-1 text-on-surface-variant">${item.current_stock} <span class="text-[10px] font-normal font-sans">${item.unit}</span></p>
        </div>
        <button data-refill-id="${item.id}" class="w-full mt-2 py-1 bg-primary text-on-primary rounded text-[10px] font-bold hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-0.5">
          <span class="material-symbols-outlined text-[12px]">add_circle</span> Refill +5
        </button>
      </div>
    `;
  }).join('');
}

/** Render transactions list */
function renderPaymentsLog(transactions) {
  const listContainer = document.getElementById('transaction-list');
  const countSpan = document.getElementById('revenue-count');
  if (!listContainer) return;

  if (countSpan) countSpan.innerText = `${transactions.length} TX`;

  if (transactions.length === 0) {
    listContainer.innerHTML = '<p class="text-body-md text-on-surface-variant italic py-8 text-center">No transactions completed today.</p>';
    return;
  }

  const sortedTx = [...transactions].sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));

  listContainer.innerHTML = sortedTx.map(tx => {
    // Format paid_at timestamp
    let timeStr = tx.paid_at;
    try {
      timeStr = new Date(tx.paid_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch(e) {}
    
    // Category Badge
    const category = tx.category || 'Dine-in';
    const badgeColors = {
      'Dine-in': 'bg-primary/10 text-primary border border-primary/20',
      'Regular': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
      'Foodmandu': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
      'Pathao': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
      'BhojDeals': 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20'
    };
    const colorClass = badgeColors[category] || 'bg-secondary/10 text-secondary border border-secondary/20';
    const categoryBadge = `<span class="text-[9px] px-1.5 py-0.2 rounded font-bold ${colorClass}">${category}</span>`;
    
    return `
      <div class="flex items-center justify-between p-sm hover:bg-surface-container rounded-lg transition-colors text-[12px]">
        <div class="flex items-center gap-sm">
          <span class="material-symbols-outlined text-[16px] text-secondary">receipt_long</span>
          <div>
            <p class="font-bold text-primary flex items-center gap-1">
              ${tx.table_name}
              ${categoryBadge}
            </p>
            <p class="text-[10px] text-on-surface-variant">${timeStr}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="font-mono-md font-bold text-primary">${formatPrice(tx.amount)}</p>
          <span class="text-[9px] uppercase tracking-wider bg-secondary/15 text-secondary px-1 py-0.2 rounded font-bold">${tx.payment_method}</span>
        </div>
      </div>
    `;
  }).join('');
}
