// Floor Map (Tables) Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, upsertTable, deleteTable, getOrderByTable, getOrderItems, getOrCreateTakeawayArchiveTable, updateOrder, deleteOrder, getDB, isTakeawayTable, getChannelFromTableName } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Initialize Floor Map module.
 */
export function initFloorMap() {
  const btnAddTable = document.getElementById('btn-add-table');
  const addTableModal = document.getElementById('add-table-modal');
  const btnCancelTable = document.getElementById('btn-cancel-table');
  const addTableOverlay = document.getElementById('add-table-overlay');
  const btnSaveTable = document.getElementById('btn-save-table');
  const categorySelect = document.getElementById('new-table-category-select');
  const customCategoryContainer = document.getElementById('custom-category-container');
  const customCategoryInput = document.getElementById('new-table-custom-category');

  const btnTakeaway = document.getElementById('btn-takeaway');
  const takeawayDropdown = document.getElementById('takeaway-dropdown');

  // Toggle takeaway dropdown
  if (btnTakeaway && takeawayDropdown) {
    btnTakeaway.addEventListener('click', (e) => {
      e.stopPropagation();
      takeawayDropdown.classList.toggle('hidden');
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!btnTakeaway.contains(e.target) && !takeawayDropdown.contains(e.target)) {
        takeawayDropdown.classList.add('hidden');
      }
    });

    // Handle channel selection
    takeawayDropdown.querySelectorAll('button[data-channel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const channel = btn.getAttribute('data-channel');
        takeawayDropdown.classList.add('hidden');
        await createTakeawaySlot(channel);
      });
    });
  }

  // Toggle custom category input based on dropdown selection
  if (categorySelect && customCategoryContainer) {
    categorySelect.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        customCategoryContainer.classList.remove('hidden');
        if (customCategoryInput) customCategoryInput.focus();
      } else {
        customCategoryContainer.classList.add('hidden');
      }
    });
  }

  // Open add table modal
  if (btnAddTable && addTableModal) {
    btnAddTable.addEventListener('click', () => {
      addTableModal.classList.remove('hidden');
      const nameInput = document.getElementById('new-table-name');
      const seatsInput = document.getElementById('new-table-seats');
      
      // Auto-suggest next table name
      const currentTables = getState().tables;
      const numbers = currentTables
        .map(t => parseInt(t.name.replace(/\D/g, '')))
        .filter(n => !isNaN(n));
      const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
      
      if (nameInput) nameInput.value = `T${nextNum}`;
      if (seatsInput) seatsInput.value = 4;
      
      // Populate category select dropdown
      if (categorySelect) {
        const categories = [...new Set(currentTables.map(t => t.category || 'Indoor'))];
        ['Indoor', 'Patio', 'VIP'].forEach(cat => {
          if (!categories.includes(cat)) categories.push(cat);
        });
        
        categorySelect.innerHTML = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('') +
          `<option value="__custom__">+ Add Custom Category...</option>`;
        
        categorySelect.value = 'Indoor';
      }
      
      if (customCategoryContainer) customCategoryContainer.classList.add('hidden');
      if (customCategoryInput) customCategoryInput.value = '';
      if (nameInput) nameInput.focus();
    });
  }

  // Close add table modal
  const closeModal = () => {
    if (addTableModal) addTableModal.classList.add('hidden');
  };

  if (btnCancelTable) btnCancelTable.addEventListener('click', closeModal);
  if (addTableOverlay) addTableOverlay.addEventListener('click', closeModal);

  // Save new table
  if (btnSaveTable) {
    btnSaveTable.addEventListener('click', async () => {
      const nameInput = document.getElementById('new-table-name');
      const seatsInput = document.getElementById('new-table-seats');
      
      if (!nameInput || !nameInput.value.trim()) {
        showToast('Table name is required', 'error');
        return;
      }

      const name = nameInput.value.trim().toUpperCase();
      const seats = parseInt(seatsInput.value) || 4;

      // Check duplicates
      const exists = getState().tables.some(t => t.name === name);
      if (exists) {
        showToast(`Table ${name} already exists`, 'error');
        return;
      }

      // Determine category
      let category = 'Indoor';
      if (categorySelect) {
        if (categorySelect.value === '__custom__') {
          if (customCategoryInput && customCategoryInput.value.trim()) {
            category = customCategoryInput.value.trim();
            // Title case the custom category name for consistent look
            category = category.charAt(0).toUpperCase() + category.slice(1);
          } else {
            showToast('Custom category name is required', 'error');
            return;
          }
        } else {
          category = categorySelect.value;
        }
      }

      const newTable = {
        id: uuidv4(),
        name,
        seats,
        status: 'available',
        category,
        current_order_id: null,
        updated_at: new Date().toISOString()
      };

      try {
        await upsertTable(newTable);
        await queueSync('tables', 'INSERT', newTable);
        
        // Refresh local state and render
        const allTables = await getAllTables();
        setState('tables', allTables);
        
        showToast(`Table ${name} created in ${category}`, 'success');
        closeModal();
      } catch (err) {
        console.error(err);
        showToast('Failed to create table', 'error');
      }
    });
  }

  // Listen to tables updates
  on('tables', renderFloorMap);
  on('selectedTableId', renderFloorMap);
  on('currency', renderFloorMap);
  on('activeTableCategory', renderFloorMap);
}

/**
 * Render Floor Map grid cards.
 */
export async function renderFloorMap() {
  const grid = document.getElementById('floor-map-grid');
  const countSpan = document.getElementById('floor-map-count');
  const tabsContainer = document.getElementById('floor-map-tabs');
  if (!grid) return;

  const tables = (getState().tables || []).filter(t => t.name !== 'Takeaway-Archive');
  const activeCategory = getState().activeTableCategory || 'All';

  // Render Category Tabs dynamically based on categories present in tables
  if (tabsContainer) {
    const uniqueCats = [...new Set(tables.map(t => t.category || 'Indoor'))];
    
    uniqueCats.sort((a, b) => {
      if (a === 'Indoor') return -1;
      if (b === 'Indoor') return 1;
      return a.localeCompare(b);
    });

    const allCount = tables.length;
    const allActive = activeCategory === 'All' ? 'bg-primary text-on-primary font-bold shadow-sm' : 'bg-surface-container hover:bg-surface-variant text-on-surface-variant';
    
    let tabsHtml = `<button class="px-4 py-1.5 rounded-full text-label-md transition-all ${allActive}" data-category="All">All (${allCount})</button>`;
    
    uniqueCats.forEach(cat => {
      const catCount = tables.filter(t => t.category === cat).length;
      const isActive = activeCategory === cat;
      const activeClass = isActive ? 'bg-primary text-on-primary font-bold shadow-sm' : 'bg-surface-container hover:bg-surface-variant text-on-surface-variant';
      tabsHtml += `<button class="px-4 py-1.5 rounded-full text-label-md transition-all ${activeClass}" data-category="${cat}">${cat} (${catCount})</button>`;
    });
    
    tabsContainer.innerHTML = tabsHtml;

    // Attach click events
    tabsContainer.querySelectorAll('button[data-category]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-category');
        setState('activeTableCategory', cat);
      });
    });
  }

  // Filter tables by active category
  const filteredTables = activeCategory === 'All'
    ? tables
    : tables.filter(t => (t.category || 'Indoor') === activeCategory);

  if (countSpan) countSpan.innerText = filteredTables.length;

  // Retrieve pricing and item count details for occupied tables asynchronously
  let enrichedTables = await Promise.all(
    filteredTables.map(async (table) => {
      let total = 0;
      let itemCount = 0;
      let channel = table.channel;
      
      // Fallback to table name if channel is not set (e.g. after sync/reload)
      if (!channel && isTakeawayTable(table)) {
        channel = getChannelFromTableName(table.name);
      }

      if (table.status === 'occupied' && table.current_order_id) {
        const order = await getOrderByTable(table.id);
        if (order) {
          total = order.total || 0;
          const items = await getOrderItems(order.id);
          itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

          // Self-healing ghost orders
          if (items.length === 0 && order.total > 0) {
            console.warn(`[Self-Healing] Cleaning up ghost order for table ${table.name}`);
            await deleteOrder(order.id);
            await queueSync('orders', 'DELETE', { id: order.id });
            
            if (isTakeawayTable(table)) {
              await deleteTable(table.id);
              await queueSync('tables', 'DELETE', { id: table.id });
              return null; // exclude from render
            } else {
              table.status = 'available';
              table.current_order_id = null;
              await upsertTable(table);
              await queueSync('tables', 'UPDATE', table);
              total = 0;
            }
          }

          if (!channel) {
            channel = order.channel;
            if (channel === 'Takeout') channel = 'Regular';
          }
        }
      }
      return { ...table, total, itemCount, channel };
    })
  );

  enrichedTables = enrichedTables.filter(t => t !== null);

  // Sort tables logically by name (T1, T2, ... T10, etc.)
  // Sort tables logically by type then by name
  enrichedTables.sort((a, b) => {
    const typeA = isTakeawayTable(a) ? 'takeaway' : 'table';
    const typeB = isTakeawayTable(b) ? 'takeaway' : 'table';
    if (typeA !== typeB) {
      return typeA.localeCompare(typeB); // 'table' before 'takeaway'
    }
    const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  const selectedTableId = getState().selectedTableId;

  grid.innerHTML = enrichedTables.map(table => {
    const isSelected = table.id === selectedTableId;
    const selectRing = isSelected ? 'is-selected ring-4 ring-secondary border-secondary/60 scale-[1.02]' : '';
    
    // Custom Takeaway Card Rendering
    if (isTakeawayTable(table)) {
      const channelColorClass = {
        Regular: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800/40',
        Foodmandu: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40',
        Pathao: 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/40',
        BhojDeals: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800/40'
      }[table.channel] || 'bg-purple-100 text-purple-800 border-purple-200';

      const channelBadge = table.channel || 'Takeaway';

      if (table.status === 'available') {
        return `
          <div class="group relative cursor-pointer border border-purple-500/20 bg-purple-500/5 p-md rounded-xl transition-all flex flex-col justify-between min-h-[110px] table-card-hover ${selectRing}" data-id="${table.id}">
            <div class="flex justify-between items-start">
              <span class="font-headline-md text-headline-md text-purple-700 dark:text-purple-400 flex items-center gap-1">
                <span class="material-symbols-outlined text-[18px]">shopping_bag</span>
                ${table.name}
              </span>
              <div class="flex flex-col items-end gap-1">
                <span class="font-label-md text-[10px] px-2 py-0.5 rounded-full border ${channelColorClass}">${channelBadge}</span>
                <span class="font-label-md text-[9px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-1.5 py-0.2 rounded">Takeaway</span>
              </div>
            </div>
            <div class="flex justify-between items-end">
              <span class="font-label-md text-purple-600 font-bold">New Order</span>
              <button class="delete-table-btn opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1 material-symbols-outlined text-[16px] text-on-surface-variant z-10" data-delete-id="${table.id}" title="Remove Takeaway">close</button>
            </div>
          </div>
        `;
      } else {
        const activeBadgeClass = {
          Regular: 'bg-purple-600 text-white',
          Foodmandu: 'bg-emerald-600 text-white',
          Pathao: 'bg-rose-600 text-white',
          BhojDeals: 'bg-orange-600 text-white'
        }[table.channel] || 'bg-purple-600 text-white';

        return `
          <div class="group relative cursor-pointer border-2 border-purple-600 bg-surface-container-lowest p-md rounded-xl shadow-md flex flex-col justify-between min-h-[110px] ring-4 ring-purple-600/5 table-card-hover ${selectRing}" data-id="${table.id}">
            <div class="flex justify-between items-start">
              <span class="font-headline-md text-headline-md text-purple-700 dark:text-purple-400 flex items-center gap-1">
                <span class="material-symbols-outlined text-[18px]">shopping_bag</span>
                ${table.name}
              </span>
              <div class="flex flex-col items-end gap-1">
                <span class="font-label-md text-[10px] px-2 py-0.5 rounded-full ${activeBadgeClass}">${channelBadge}</span>
                <span class="font-label-md text-[9px] bg-purple-100 text-purple-800 border border-purple-200 px-1.5 py-0.2 rounded">Takeaway</span>
              </div>
            </div>
            <div>
              <p class="font-label-md text-on-surface-variant">Active</p>
              <p class="font-body-md text-purple-700 dark:text-purple-400 font-medium">${table.itemCount} items</p>
              <p class="font-mono-md text-mono-md font-bold text-purple-700 dark:text-purple-400">${formatPrice(table.total)}</p>
            </div>
          </div>
        `;
      }
    }

    if (table.status === 'available') {
      return `
        <div class="group relative cursor-pointer border border-secondary/20 bg-secondary/5 p-md rounded-xl transition-all flex flex-col justify-between min-h-[110px] table-card-hover ${selectRing}" data-id="${table.id}">
          <div class="flex justify-between items-start">
            <span class="font-headline-md text-headline-md text-primary">${table.name}</span>
            <div class="flex flex-col items-end gap-1">
              <span class="font-label-md text-[10px] bg-white/50 px-2 py-0.5 rounded-full border border-secondary/30">${table.seats} seats</span>
              <span class="font-label-md text-[9px] bg-secondary/10 text-secondary border border-secondary/20 px-1.5 py-0.2 rounded">${table.category || 'Indoor'}</span>
            </div>
          </div>
          <div class="flex justify-between items-end">
            <span class="font-label-md text-secondary font-bold">Available</span>
            <button class="delete-table-btn opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1 material-symbols-outlined text-[16px] text-on-surface-variant z-10" data-delete-id="${table.id}" title="Remove Table">close</button>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="group relative cursor-pointer border-2 border-primary bg-surface-container-lowest p-md rounded-xl shadow-md flex flex-col justify-between min-h-[110px] ring-4 ring-primary/5 table-card-hover ${selectRing}" data-id="${table.id}">
          <div class="flex justify-between items-start">
            <span class="font-headline-md text-headline-md text-primary">${table.name}</span>
            <div class="flex flex-col items-end gap-1">
              <span class="font-label-md text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">${table.seats} seats</span>
              <span class="font-label-md text-[9px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.2 rounded">${table.category || 'Indoor'}</span>
            </div>
          </div>
          <div>
            <p class="font-label-md text-on-surface-variant">Occupied</p>
            <p class="font-body-md text-primary font-medium">${table.itemCount} items</p>
            <p class="font-mono-md text-mono-md font-bold text-primary">${formatPrice(table.total)}</p>
          </div>
        </div>
      `;
    }
  }).join('');

  // Setup click listeners on table cards
  grid.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      // Prevent triggering table select when delete button is clicked
      if (e.target.closest('.delete-table-btn')) return;
      
      const id = card.getAttribute('data-id');
      setState('selectedTableId', id);
    });
  });

  // Setup click listeners for delete buttons
  grid.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-id');
      const table = await getTable(id);
      
      if (!table) return;
      
      const isTakeaway = isTakeawayTable(table);
      const typeLabel = isTakeaway ? 'Takeaway slot' : `Table ${table.name}`;
      
      if (confirm(`Are you sure you want to remove ${typeLabel}?`)) {
        try {
          if (isTakeaway) {
            // Find all orders referencing this table and re-route them to the archive table
            const { table: archiveTable, isNew } = await getOrCreateTakeawayArchiveTable();
            if (isNew) {
              await queueSync('tables', 'UPDATE', archiveTable);
            }
            const database = getDB();
            const allOrdersForTable = await database.getAllFromIndex('orders', 'table_id', id);
            for (const order of allOrdersForTable) {
              const archivedOrder = {
                ...order,
                table_id: archiveTable.id
              };
              await updateOrder(archivedOrder);
              await queueSync('orders', 'UPDATE', archivedOrder);
            }
          }

          await deleteTable(id);
          await queueSync('tables', 'DELETE', { id });
          
          if (getState().selectedTableId === id) {
            setState('selectedTableId', null);
          }

          const allTables = await getAllTables();
          setState('tables', allTables);
          showToast(`${table.name} removed`, 'info');
        } catch (err) {
          console.error(err);
          showToast(`Failed to remove ${isTakeaway ? 'takeaway' : 'table'}`, 'error');
        }
      }
    });
  });
}

/**
 * Creates an ephemeral virtual takeaway table.
 * @param {string} channel 
 */
export async function createTakeawaySlot(channel) {
  const currentTables = getState().tables;
  
  // Format prefixes: TA- for Regular, otherwise Channel-
  const prefix = channel === 'Regular' ? 'TA-' : `${channel}-`;
  const channelTables = currentTables.filter(t => t.name && t.name.startsWith(prefix));
  
  const numbers = channelTables.map(t => {
    const matched = t.name.match(/\d+/);
    return matched ? parseInt(matched[0]) : null;
  }).filter(n => n !== null && !isNaN(n));
  
  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  const name = `${prefix}${nextNum}`;

  const newTable = {
    id: uuidv4(),
    name,
    seats: 0,
    status: 'available',
    category: 'Takeaway',
    type: 'takeaway',
    channel,
    current_order_id: null,
    updated_at: new Date().toISOString()
  };

  try {
    await upsertTable(newTable);
    await queueSync('tables', 'INSERT', newTable);
    
    // Refresh local state and render
    const allTables = await getAllTables();
    setState('tables', allTables);
    
    // Auto-select the newly created takeaway table
    setState('selectedTableId', newTable.id);
    
    // Switch category filter to 'Takeaway' tab
    setState('activeTableCategory', 'Takeaway');
    
    showToast(`Takeaway slot ${name} (${channel}) created`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to create takeaway slot', 'error');
  }
}
