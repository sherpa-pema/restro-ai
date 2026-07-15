// Floor Map (Tables) Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, upsertTable, deleteTable, getOrderByTable, getOrderItems } from '../db/indexedDB.js';
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

  const tables = getState().tables;
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
  const enrichedTables = await Promise.all(
    filteredTables.map(async (table) => {
      let total = 0;
      let itemCount = 0;
      if (table.status === 'occupied' && table.current_order_id) {
        const order = await getOrderByTable(table.id);
        if (order) {
          total = order.total || 0;
          const items = await getOrderItems(order.id);
          itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
        }
      }
      return { ...table, total, itemCount };
    })
  );

  // Sort tables logically by name (T1, T2, ... T10, etc.)
  enrichedTables.sort((a, b) => {
    const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  const selectedTableId = getState().selectedTableId;

  grid.innerHTML = enrichedTables.map(table => {
    const isSelected = table.id === selectedTableId;
    const selectRing = isSelected ? 'is-selected ring-4 ring-secondary border-secondary/60 scale-[1.02]' : '';
    
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
      
      if (confirm(`Are you sure you want to remove Table ${table.name}?`)) {
        try {
          await deleteTable(id);
          await queueSync('tables', 'DELETE', { id });
          
          if (getState().selectedTableId === id) {
            setState('selectedTableId', null);
          }

          const allTables = await getAllTables();
          setState('tables', allTables);
          showToast(`Table ${table.name} removed`, 'info');
        } catch (err) {
          console.error(err);
          showToast('Failed to remove table', 'error');
        }
      }
    });
  });
}
