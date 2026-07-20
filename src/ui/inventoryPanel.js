// Inventory Panel Module — TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { 
  getAllInventory, 
  upsertInventory, 
  getAllSuppliers, 
  upsertSupplier, 
  deleteSupplier, 
  getAllRecipes, 
  upsertRecipe, 
  deleteRecipe,
  getAllWaste,
  addWasteLog,
  getTodayWaste
} from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { showToast } from './toasts.js';
import { escapeHTML } from '../utils/security.js';
import { v4 as uuidv4 } from 'uuid';

// Current active sub-tab inside inventory page
let activeSubTab = 'stock'; // 'stock' | 'recipes' | 'suppliers'
// Currently selected menu item ID for recipe editing
let selectedRecipeMenuItemId = null;

/**
 * Initialize Inventory Section UI and bind event listeners.
 */
export function initInventoryPanel() {
  // 1. Tab switches
  const tabBtnStock = document.getElementById('tab-btn-stock');
  const tabBtnRecipes = document.getElementById('tab-btn-recipes');
  const tabBtnSuppliers = document.getElementById('tab-btn-suppliers');

  if (tabBtnStock) tabBtnStock.addEventListener('click', () => switchSubTab('stock'));
  if (tabBtnRecipes) tabBtnRecipes.addEventListener('click', () => switchSubTab('recipes'));
  if (tabBtnSuppliers) tabBtnSuppliers.addEventListener('click', () => switchSubTab('suppliers'));

  // 2. Search & Category Filters
  const searchInput = document.getElementById('inventory-search');
  const categoryFilter = document.getElementById('inventory-category-filter');

  if (searchInput) searchInput.addEventListener('input', renderStockDirectory);
  if (categoryFilter) categoryFilter.addEventListener('change', renderStockDirectory);

  // 3. Modals: Open & Close Bindings
  setupModalBindings();

  // 4. Recipe Editors
  setupRecipeEditorBindings();

  // 5. State Listeners
  on('inventory', () => {
    if (getState().activePage === 'inventory') {
      renderActiveTab();
    }
  });
  on('suppliers', () => {
    if (getState().activePage === 'inventory') {
      renderActiveTab();
    }
  });
  on('recipes', () => {
    if (getState().activePage === 'inventory') {
      renderActiveTab();
    }
  });
  on('activePage', (page) => {
    if (page === 'inventory') {
      // Pull latest database content to ensure UI is in sync
      refreshInventoryData().then(() => {
        renderActiveTab();
      });
    }
  });
}

/**
 * Switch the active sub-tab.
 * @param {'stock'|'recipes'|'suppliers'} tabId 
 */
function switchSubTab(tabId) {
  activeSubTab = tabId;

  const tabs = {
    stock: { btn: document.getElementById('tab-btn-stock'), content: document.getElementById('tab-content-stock') },
    recipes: { btn: document.getElementById('tab-btn-recipes'), content: document.getElementById('tab-content-recipes') },
    suppliers: { btn: document.getElementById('tab-btn-suppliers'), content: document.getElementById('tab-content-suppliers') }
  };

  Object.keys(tabs).forEach(key => {
    const tab = tabs[key];
    if (!tab.btn || !tab.content) return;

    if (key === tabId) {
      tab.btn.className = 'px-4 py-2 text-label-md font-label-md rounded-lg bg-surface-container-lowest text-primary font-bold shadow-sm transition-all';
      tab.content.classList.remove('hidden');
    } else {
      tab.btn.className = 'px-4 py-2 text-label-md font-label-md rounded-lg text-on-surface-variant hover:text-primary transition-all';
      tab.content.classList.add('hidden');
    }
  });

  renderActiveTab();
}

/**
 * Render the currently selected sub-tab's UI.
 */
function renderActiveTab() {
  if (activeSubTab === 'stock') {
    renderStockDirectory();
  } else if (activeSubTab === 'recipes') {
    renderRecipeMapping();
  } else if (activeSubTab === 'suppliers') {
    renderSuppliersDirectory();
  }
}

/**
 * Load newest state from IndexedDB into global memory state.
 */
async function refreshInventoryData() {
  try {
    const inv = await getAllInventory();
    const sups = await getAllSuppliers();
    const recs = await getAllRecipes();
    setState('inventory', inv);
    setState('suppliers', sups);
    setState('recipes', recs);
  } catch (err) {
    console.error('[Inventory] Error refreshing data:', err);
  }
}

// ─────────────────────────────────────────────
// Feature 1 & 2: Stock Directory & Warnings
// ─────────────────────────────────────────────

/**
 * Render ingredients in a responsive table.
 * Applies search filters and highlights low-stock levels.
 */
function renderStockDirectory() {
  const tbody = document.getElementById('inventory-table-body');
  if (!tbody) return;

  const state = getState();
  const inventory = state.inventory || [];
  const suppliers = state.suppliers || [];
  const searchVal = (document.getElementById('inventory-search')?.value || '').toLowerCase().trim();
  const categoryVal = document.getElementById('inventory-category-filter')?.value || 'All';

  // Filter list
  const filtered = inventory.filter(item => {
    const matchesSearch = item.ingredient_name.toLowerCase().includes(searchVal);
    const matchesCategory = categoryVal === 'All' || item.category === categoryVal;
    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-lg text-center text-on-surface-variant italic">
          No ingredients match search criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const isLow = Number(item.current_stock) <= Number(item.reorder_threshold);
    const totalVal = Number(item.current_stock) * Number(item.unit_cost);

    // Resolve supplier name
    const supplier = suppliers.find(s => s.id === item.supplier_id);
    const supplierName = supplier ? escapeHTML(supplier.name) : '<span class="text-on-surface-variant italic">None</span>';

    // Status pill HTML
    const statusPill = isLow 
      ? '<span class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-error/15 text-error rounded animate-pulse">Low Stock</span>'
      : '<span class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-secondary/15 text-secondary rounded">OK</span>';

    const rowBg = isLow ? 'bg-error/[0.02]' : '';

    return `
      <tr class="hover:bg-surface-container-low transition-colors ${rowBg}">
        <td class="p-md font-bold text-primary">${escapeHTML(item.ingredient_name)}</td>
        <td class="p-md text-on-surface-variant">${item.category || 'General'}</td>
        <td class="p-md text-right font-mono-md font-bold ${isLow ? 'text-error' : 'text-primary'}">${item.current_stock}</td>
        <td class="p-md text-on-surface-variant font-medium">${item.unit}</td>
        <td class="p-md text-right font-mono-md">${formatPrice(item.unit_cost)}</td>
        <td class="p-md text-right font-mono-md font-bold">${formatPrice(totalVal)}</td>
        <td class="p-md text-right font-mono-md text-on-surface-variant">${item.reorder_threshold}</td>
        <td class="p-md font-medium text-primary">${supplierName}</td>
        <td class="p-md">${statusPill}</td>
        <td class="p-md text-right">
          <div class="flex justify-end gap-sm">
            <button data-edit-item-id="${item.id}" class="p-1 text-on-surface-variant hover:text-primary rounded transition-all hover:bg-surface-container" title="Edit Item">
              <span class="material-symbols-outlined text-[18px]">edit</span>
            </button>
            <button data-delete-item-id="${item.id}" class="p-1 text-on-surface-variant hover:text-error rounded transition-all hover:bg-error/10" title="Delete Item">
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Setup click listeners for edit/delete row actions
  tbody.querySelectorAll('[data-edit-item-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-item-id');
      openAddIngredientModal(id);
    });
  });

  tbody.querySelectorAll('[data-delete-item-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-item-id');
      const item = inventory.find(i => i.id === id);
      if (!item) return;

      if (confirm(`Delete the ingredient "${item.ingredient_name}" from master list? This deletes all its recipes mappings.`)) {
        try {
          // Delete from local DB & queue cloud sync deletion
          const database = getDB();
          const databaseStore = database.transaction('inventory', 'readwrite').objectStore('inventory');
          await databaseStore.delete(id);
          await queueSync('inventory', 'DELETE', { id });

          // Also delete related recipes
          const recipes = state.recipes || [];
          const relatedRecipes = recipes.filter(r => r.ingredient_id === id);
          for (const recipe of relatedRecipes) {
            await deleteRecipe(recipe.id);
            await queueSync('recipes', 'DELETE', { id: recipe.id });
          }

          showToast(`Deleted ingredient: ${item.ingredient_name}`, 'info');
          await refreshInventoryData();
          renderActiveTab();
        } catch (err) {
          console.error(err);
          showToast('Failed to delete item', 'error');
        }
      }
    });
  });
}

// ─────────────────────────────────────────────
// Feature 3: Modals and Adjustments
// ─────────────────────────────────────────────

function setupModalBindings() {
  // --- Modals definitions ---
  const modalItem = document.getElementById('add-inventory-modal');
  const modalStockIn = document.getElementById('stock-in-modal');
  const modalReconcile = document.getElementById('reconcile-modal');
  const modalSupplier = document.getElementById('add-supplier-modal');

  // Trigger buttons
  const btnAddItem = document.getElementById('btn-add-inventory-item');
  const btnReceive = document.getElementById('btn-receive-stock');
  const btnReconcile = document.getElementById('btn-reconcile-stock');
  const btnAddSupplier = document.getElementById('btn-add-supplier');

  // Cancel buttons / Overlays
  const overlayItem = document.getElementById('add-inventory-overlay');
  const btnCancelItem = document.getElementById('btn-cancel-inventory');

  const overlayStockIn = document.getElementById('stock-in-overlay');
  const btnCancelStockIn = document.getElementById('btn-cancel-stock-in');

  const overlayReconcile = document.getElementById('reconcile-overlay');
  const btnCancelReconcile = document.getElementById('btn-cancel-reconcile');

  const overlaySupplier = document.getElementById('add-supplier-overlay');
  const btnCancelSupplier = document.getElementById('btn-cancel-supplier');

  // Save Buttons
  const btnSaveItem = document.getElementById('btn-save-inventory');
  const btnSaveStockIn = document.getElementById('btn-save-stock-in');
  const btnSaveReconcile = document.getElementById('btn-save-reconcile');
  const btnSaveSupplier = document.getElementById('btn-save-supplier');

  // Helper close handlers
  const closeItemModal = () => {
    if (modalItem) modalItem.classList.add('hidden');
    clearItemModalFields();
  };
  const closeStockInModal = () => {
    if (modalStockIn) modalStockIn.classList.add('hidden');
  };
  const closeReconcileModal = () => {
    if (modalReconcile) modalReconcile.classList.add('hidden');
  };
  const closeSupplierModal = () => {
    if (modalSupplier) modalSupplier.classList.add('hidden');
    clearSupplierModalFields();
  };

  // Bind Openers
  if (btnAddItem) btnAddItem.addEventListener('click', () => openAddIngredientModal());
  if (btnReceive) btnReceive.addEventListener('click', () => openStockInModal());
  if (btnReconcile) btnReconcile.addEventListener('click', () => openReconcileModal());
  if (btnAddSupplier) btnAddSupplier.addEventListener('click', () => openSupplierModal());

  // Bind Closers
  if (btnCancelItem) btnCancelItem.addEventListener('click', closeItemModal);
  if (overlayItem) overlayItem.addEventListener('click', closeItemModal);

  if (btnCancelStockIn) btnCancelStockIn.addEventListener('click', closeStockInModal);
  if (overlayStockIn) overlayStockIn.addEventListener('click', closeStockInModal);

  if (btnCancelReconcile) btnCancelReconcile.addEventListener('click', closeReconcileModal);
  if (overlayReconcile) overlayReconcile.addEventListener('click', closeReconcileModal);

  if (btnCancelSupplier) btnCancelSupplier.addEventListener('click', closeSupplierModal);
  if (overlaySupplier) overlaySupplier.addEventListener('click', closeSupplierModal);

  // Dynamic unit label update for Stock In / Reconcile modals
  const stockInSelect = document.getElementById('stock-in-ingredient-select');
  const stockInUnitLabel = document.getElementById('stock-in-unit-label');
  if (stockInSelect && stockInUnitLabel) {
    stockInSelect.addEventListener('change', () => {
      const selectedItem = getState().inventory.find(i => i.id === stockInSelect.value);
      stockInUnitLabel.innerText = selectedItem ? selectedItem.unit : 'units';
      const inputCost = document.getElementById('stock-in-cost');
      if (inputCost && selectedItem) {
        inputCost.value = selectedItem.unit_cost;
      }
    });
  }

  const reconcileSelect = document.getElementById('reconcile-ingredient-select');
  const reconcileUnitLabel = document.getElementById('reconcile-unit-label');
  if (reconcileSelect && reconcileUnitLabel) {
    reconcileSelect.addEventListener('change', () => {
      const selectedItem = getState().inventory.find(i => i.id === reconcileSelect.value);
      reconcileUnitLabel.innerText = selectedItem ? selectedItem.unit : 'units';
      const reconcileQty = document.getElementById('reconcile-quantity');
      if (reconcileQty && selectedItem) {
        reconcileQty.value = selectedItem.current_stock;
      }
    });
  }

  // --- SAVE ACTIONS ---

  // 1. Add / Edit Master Ingredient
  if (btnSaveItem) {
    btnSaveItem.addEventListener('click', async () => {
      const editId = document.getElementById('inventory-edit-id').value;
      const name = document.getElementById('inventory-item-name').value.trim();
      const category = document.getElementById('inventory-item-category').value;
      const unit = document.getElementById('inventory-item-unit').value.trim();
      const stock = parseFloat(document.getElementById('inventory-item-stock').value);
      const cost = parseFloat(document.getElementById('inventory-item-cost').value);
      const par = parseFloat(document.getElementById('inventory-item-par').value);
      const supplierId = document.getElementById('inventory-item-supplier').value || null;

      if (!name || !unit || isNaN(stock) || isNaN(cost) || isNaN(par)) {
        showToast('All fields must be valid and numeric where required', 'error');
        return;
      }

      const isEdit = !!editId;
      const now = new Date().toISOString();
      const itemData = {
        id: isEdit ? editId : uuidv4(),
        ingredient_name: name,
        category,
        current_stock: stock,
        unit,
        reorder_threshold: par,
        unit_cost: cost,
        supplier_id: supplierId,
        updated_at: now
      };

      try {
        await upsertInventory(itemData);
        await queueSync('inventory', isEdit ? 'UPDATE' : 'INSERT', itemData);
        showToast(`Saved ingredient "${name}" successfully`, 'success');
        closeItemModal();
        await refreshInventoryData();
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showToast('Failed to save ingredient', 'error');
      }
    });
  }

  // 2. Stock In (Receiving Delivery)
  if (btnSaveStockIn) {
    btnSaveStockIn.addEventListener('click', async () => {
      const select = document.getElementById('stock-in-ingredient-select');
      const ingredientId = select.value;
      const quantityToAdd = parseFloat(document.getElementById('stock-in-quantity').value);
      const costOverrideVal = parseFloat(document.getElementById('stock-in-cost').value);

      if (!ingredientId || isNaN(quantityToAdd) || quantityToAdd <= 0) {
        showToast('Select an ingredient and enter a positive quantity', 'error');
        return;
      }

      const item = getState().inventory.find(i => i.id === ingredientId);
      if (!item) return;

      const costValue = isNaN(costOverrideVal) || costOverrideVal < 0 ? item.unit_cost : costOverrideVal;
      const now = new Date().toISOString();

      const updated = {
        ...item,
        current_stock: Number((Number(item.current_stock) + quantityToAdd).toFixed(2)),
        unit_cost: costValue,
        updated_at: now
      };

      try {
        await upsertInventory(updated);
        await queueSync('inventory', 'UPDATE', updated);
        showToast(`Received ${quantityToAdd} ${item.unit} of ${item.ingredient_name}`, 'success');
        closeStockInModal();
        await refreshInventoryData();
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showToast('Failed to log delivery', 'error');
      }
    });
  }

  // 3. Reconcile Override
  if (btnSaveReconcile) {
    btnSaveReconcile.addEventListener('click', async () => {
      const select = document.getElementById('reconcile-ingredient-select');
      const ingredientId = select.value;
      const physicalCount = parseFloat(document.getElementById('reconcile-quantity').value);

      if (!ingredientId || isNaN(physicalCount) || physicalCount < 0) {
        showToast('Select an ingredient and enter a valid physical count', 'error');
        return;
      }

      const item = getState().inventory.find(i => i.id === ingredientId);
      if (!item) return;

      const difference = physicalCount - item.current_stock;
      const now = new Date().toISOString();

      const updated = {
        ...item,
        current_stock: physicalCount,
        updated_at: now
      };

      try {
        await upsertInventory(updated);
        await queueSync('inventory', 'UPDATE', updated);

        // If the reconciliation revealed waste/loss, log it automatically to waste table!
        if (difference < 0) {
          const wasteLog = {
            id: uuidv4(),
            ingredient_id: ingredientId,
            ingredient_name: item.ingredient_name,
            quantity: Math.abs(difference),
            cost: Number((Math.abs(difference) * item.unit_cost).toFixed(2)),
            reason: 'Reconciliation shortage / Shrinkage',
            wasted_at: now
          };
          await addWasteLog(wasteLog);
          await queueSync('waste', 'INSERT', wasteLog);
        }

        showToast(`Reconciled stock: Physical count set to ${physicalCount} ${item.unit}`, 'info');
        closeReconcileModal();
        await refreshInventoryData();
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showToast('Failed to reconcile stock', 'error');
      }
    });
  }

  // 4. Save Supplier
  if (btnSaveSupplier) {
    btnSaveSupplier.addEventListener('click', async () => {
      const editId = document.getElementById('supplier-edit-id').value;
      const name = document.getElementById('supplier-name').value.trim();
      const contact = document.getElementById('supplier-contact').value.trim();
      const phone = document.getElementById('supplier-phone').value.trim();
      const email = document.getElementById('supplier-email').value.trim();
      const days = document.getElementById('supplier-days').value.trim();

      if (!name) {
        showToast('Supplier Name is required', 'error');
        return;
      }

      const isEdit = !!editId;
      const now = new Date().toISOString();
      const supplierData = {
        id: isEdit ? editId : uuidv4(),
        name,
        contact_person: contact || '',
        phone: phone || '',
        email: email || '',
        delivery_days: days || '',
        updated_at: now
      };

      try {
        await upsertSupplier(supplierData);
        await queueSync('suppliers', isEdit ? 'UPDATE' : 'INSERT', supplierData);
        showToast(`Supplier "${name}" saved`, 'success');
        closeSupplierModal();
        await refreshInventoryData();
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showToast('Failed to save supplier profile', 'error');
      }
    });
  }
}

/** Open Add/Edit Item modal, hydrating values if editing */
function openAddIngredientModal(editId = null) {
  const modal = document.getElementById('add-inventory-modal');
  const title = document.getElementById('inventory-modal-title');
  const inputEditId = document.getElementById('inventory-edit-id');
  const suppliersSelect = document.getElementById('inventory-item-supplier');

  if (!modal) return;

  // Hydrate Suppliers dropdown options
  const suppliers = getState().suppliers || [];
  if (suppliersSelect) {
    suppliersSelect.innerHTML = '<option value="">No supplier linked</option>' +
      suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  if (editId) {
    title.innerText = 'Edit Ingredient';
    inputEditId.value = editId;

    const item = getState().inventory.find(i => i.id === editId);
    if (item) {
      document.getElementById('inventory-item-name').value = item.ingredient_name;
      document.getElementById('inventory-item-category').value = item.category || 'General';
      document.getElementById('inventory-item-unit').value = item.unit;
      document.getElementById('inventory-item-stock').value = item.current_stock;
      document.getElementById('inventory-item-cost').value = item.unit_cost;
      document.getElementById('inventory-item-par').value = item.reorder_threshold;
      document.getElementById('inventory-item-supplier').value = item.supplier_id || '';
    }
  } else {
    title.innerText = 'Add New Ingredient';
    inputEditId.value = '';
    clearItemModalFields();
  }

  modal.classList.remove('hidden');
}

/** Open Stock In Modal and populate dropdown */
function openStockInModal() {
  const modal = document.getElementById('stock-in-modal');
  const select = document.getElementById('stock-in-ingredient-select');
  const unitLabel = document.getElementById('stock-in-unit-label');
  const costOverride = document.getElementById('stock-in-cost');
  const qtyInput = document.getElementById('stock-in-quantity');

  if (!modal || !select) return;

  const inventory = getState().inventory || [];

  if (inventory.length === 0) {
    showToast('Add ingredients to stock directory first', 'info');
    return;
  }

  select.innerHTML = inventory.map(item => `<option value="${item.id}">${escapeHTML(item.ingredient_name)}</option>`).join('');
  qtyInput.value = 1.0;

  // Hydrate first item's metadata
  const first = inventory[0];
  if (unitLabel) unitLabel.innerText = first.unit;
  if (costOverride) costOverride.value = first.unit_cost;

  modal.classList.remove('hidden');
}

/** Open Reconcile Modal and populate dropdown */
function openReconcileModal() {
  const modal = document.getElementById('reconcile-modal');
  const select = document.getElementById('reconcile-ingredient-select');
  const unitLabel = document.getElementById('reconcile-unit-label');
  const qtyInput = document.getElementById('reconcile-quantity');

  if (!modal || !select) return;

  const inventory = getState().inventory || [];

  if (inventory.length === 0) {
    showToast('Add ingredients to stock directory first', 'info');
    return;
  }

  select.innerHTML = inventory.map(item => `<option value="${item.id}">${escapeHTML(item.ingredient_name)}</option>`).join('');
  
  const first = inventory[0];
  if (unitLabel) unitLabel.innerText = first.unit;
  if (qtyInput) qtyInput.value = first.current_stock;

  modal.classList.remove('hidden');
}

/** Open Supplier modal, hydrating values if editing */
function openSupplierModal(editId = null) {
  const modal = document.getElementById('add-supplier-modal');
  const title = document.getElementById('supplier-modal-title');
  const inputEditId = document.getElementById('supplier-edit-id');

  if (!modal) return;

  if (editId) {
    title.innerText = 'Edit Supplier Profile';
    inputEditId.value = editId;

    const supplier = getState().suppliers.find(s => s.id === editId);
    if (supplier) {
      document.getElementById('supplier-name').value = supplier.name;
      document.getElementById('supplier-contact').value = supplier.contact_person;
      document.getElementById('supplier-phone').value = supplier.phone;
      document.getElementById('supplier-email').value = supplier.email;
      document.getElementById('supplier-days').value = supplier.delivery_days;
    }
  } else {
    title.innerText = 'Add Supplier Profile';
    inputEditId.value = '';
    clearSupplierModalFields();
  }

  modal.classList.remove('hidden');
}

function clearItemModalFields() {
  document.getElementById('inventory-item-name').value = '';
  document.getElementById('inventory-item-category').value = 'General';
  document.getElementById('inventory-item-unit').value = 'pcs';
  document.getElementById('inventory-item-stock').value = 0.00;
  document.getElementById('inventory-item-cost').value = 0.00;
  document.getElementById('inventory-item-par').value = 0.00;
  document.getElementById('inventory-item-supplier').value = '';
}

function clearSupplierModalFields() {
  document.getElementById('supplier-name').value = '';
  document.getElementById('supplier-contact').value = '';
  document.getElementById('supplier-phone').value = '';
  document.getElementById('supplier-email').value = '';
  document.getElementById('supplier-days').value = '';
}

// ─────────────────────────────────────────────
// Feature 4: Recipe Depletion
// ─────────────────────────────────────────────

function setupRecipeEditorBindings() {
  // Bind unit display updater on mapping dropdown change
  const select = document.getElementById('recipe-ingredient-select');
  const unitDisplay = document.getElementById('recipe-unit-display');
  if (select && unitDisplay) {
    select.addEventListener('change', () => {
      const ingredient = getState().inventory.find(i => i.id === select.value);
      unitDisplay.innerText = ingredient ? ingredient.unit : 'pcs';
    });
  }

  // Bind mapping addition action
  const btnAddMapping = document.getElementById('btn-add-recipe-mapping');
  if (btnAddMapping) {
    btnAddMapping.addEventListener('click', async () => {
      const ingredientId = select.value;
      const qtyInput = document.getElementById('recipe-qty-input');
      const quantity = parseFloat(qtyInput.value);

      if (!selectedRecipeMenuItemId) {
        showToast('Please select a menu item first', 'info');
        return;
      }

      if (!ingredientId || isNaN(quantity) || quantity <= 0) {
        showToast('Please select a valid ingredient and positive quantity', 'error');
        return;
      }

      const menuItems = getState().menuItems || [];
      const menuItem = menuItems.find(m => m.id === selectedRecipeMenuItemId);
      const inventory = getState().inventory || [];
      const ingredient = inventory.find(i => i.id === ingredientId);

      if (!menuItem || !ingredient) return;

      const mapping = {
        id: uuidv4(),
        menu_item_id: selectedRecipeMenuItemId,
        menu_item_name: menuItem.name,
        ingredient_id: ingredientId,
        quantity,
        updated_at: new Date().toISOString()
      };

      try {
        await upsertRecipe(mapping);
        await queueSync('recipes', 'INSERT', mapping);
        showToast(`Linked ${quantity} ${ingredient.unit} of ${ingredient.ingredient_name} to ${menuItem.name}`, 'success');
        qtyInput.value = 1.0;
        await refreshInventoryData();
        renderRecipeMapping();
      } catch (err) {
        console.error(err);
        showToast('Failed to create recipe link', 'error');
      }
    });
  }
}

/** Render Recipe list splitting panel */
function renderRecipeMapping() {
  const menuList = document.getElementById('recipe-menu-list');
  const ingredientsBody = document.getElementById('recipe-ingredients-body');
  const editorHeader = document.getElementById('recipe-editor-header');
  const editorContent = document.getElementById('recipe-editor-content');
  const selectIngredient = document.getElementById('recipe-ingredient-select');
  const unitDisplay = document.getElementById('recipe-unit-display');

  if (!menuList) return;

  const state = getState();
  const menuItems = state.menuItems || [];
  const recipes = state.recipes || [];
  const inventory = state.inventory || [];

  // 1. Populate ingredients select options
  if (selectIngredient) {
    if (inventory.length === 0) {
      selectIngredient.innerHTML = '<option value="">No ingredients loaded</option>';
      if (unitDisplay) unitDisplay.innerText = 'units';
    } else {
      selectIngredient.innerHTML = inventory.map(item => `<option value="${item.id}">${escapeHTML(item.ingredient_name)}</option>`).join('');
      if (unitDisplay && inventory[0]) unitDisplay.innerText = inventory[0].unit;
    }
  }

  // 2. Render Left Column (Menu Items List)
  if (menuItems.length === 0) {
    menuList.innerHTML = '<p class="text-xs text-on-surface-variant italic py-4">No menu items found.</p>';
  } else {
    menuList.innerHTML = menuItems.map(item => {
      const isSelected = item.id === selectedRecipeMenuItemId;
      const count = recipes.filter(r => r.menu_item_id === item.id).length;
      
      const activeClass = isSelected
        ? 'bg-primary text-on-primary font-bold border-primary'
        : 'bg-surface hover:bg-surface-container border-outline-variant';

      return `
        <button data-recipe-item-id="${item.id}" class="w-full flex items-center justify-between p-md border rounded-xl transition-all font-body-md text-left active:scale-[0.99] ${activeClass}">
          <div class="flex items-center gap-sm">
            <span class="text-lg">${item.emoji || '🍽️'}</span>
            <div>
              <p class="font-bold truncate max-w-[140px]">${item.name}</p>
              <p class="text-[10px] ${isSelected ? 'text-on-primary/70' : 'text-on-surface-variant'}">${formatPrice(item.price)}</p>
            </div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded font-black ${isSelected ? 'bg-on-primary/10 text-on-primary' : 'bg-surface-container-high text-primary'}">${count} linked</span>
        </button>
      `;
    }).join('');

    menuList.querySelectorAll('[data-recipe-item-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRecipeMenuItemId = btn.getAttribute('data-recipe-item-id');
        renderRecipeMapping();
      });
    });
  }

  // 3. Render Right Column Detail Editor
  if (!selectedRecipeMenuItemId) {
    if (editorHeader) {
      document.getElementById('recipe-editor-title').innerText = 'Select a menu item to view/edit recipe';
      document.getElementById('recipe-editor-subtitle').innerText = 'Link menu items to ingredients to enable automatic stock deduction.';
    }
    if (editorContent) editorContent.classList.add('hidden');
    return;
  }

  const selectedItem = menuItems.find(m => m.id === selectedRecipeMenuItemId);
  if (!selectedItem) {
    selectedRecipeMenuItemId = null;
    renderRecipeMapping();
    return;
  }

  // Show editor panel
  if (editorContent) editorContent.classList.remove('hidden');
  document.getElementById('recipe-editor-title').innerText = `${selectedItem.emoji || '🍽️'} ${selectedItem.name}`;
  document.getElementById('recipe-editor-subtitle').innerText = `Ingredients consumed when a customer orders "${selectedItem.name}"`;

  // Get recipe mappings for this item
  const itemRecipes = recipes.filter(r => r.menu_item_id === selectedRecipeMenuItemId);

  if (itemRecipes.length === 0) {
    ingredientsBody.innerHTML = `
      <tr>
        <td colspan="6" class="p-lg text-center text-on-surface-variant italic">
          No ingredients linked to this menu item yet.
        </td>
      </tr>
    `;
    return;
  }

  ingredientsBody.innerHTML = itemRecipes.map(recipe => {
    // Resolve ingredient details
    const ingredient = inventory.find(i => i.id === recipe.ingredient_id);
    const ingredientName = ingredient ? escapeHTML(ingredient.ingredient_name) : '<span class="text-error font-bold italic">Missing Ingredient</span>';
    const category = ingredient ? ingredient.category : 'General';
    const unit = ingredient ? ingredient.unit : 'pcs';
    const costContrib = ingredient ? (Number(recipe.quantity) * Number(ingredient.unit_cost)) : 0;

    return `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="p-md font-bold text-primary">${ingredientName}</td>
        <td class="p-md text-on-surface-variant">${category}</td>
        <td class="p-md text-right font-mono-md font-bold">${recipe.quantity}</td>
        <td class="p-md text-on-surface-variant font-medium">${unit}</td>
        <td class="p-md text-right font-mono-md">${formatPrice(costContrib)}</td>
        <td class="p-md text-right">
          <button data-delete-recipe-id="${recipe.id}" class="p-1 text-on-surface-variant hover:text-error rounded hover:bg-error/10 transition-colors" title="Delete mapping">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Bind row deletion click action
  ingredientsBody.querySelectorAll('[data-delete-recipe-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-recipe-id');
      try {
        await deleteRecipe(id);
        await queueSync('recipes', 'DELETE', { id });
        showToast('Recipe ingredient mapping removed', 'info');
        await refreshInventoryData();
        renderRecipeMapping();
      } catch (err) {
        console.error(err);
        showToast('Failed to delete recipe mapping', 'error');
      }
    });
  });
}

// ─────────────────────────────────────────────
// Feature 5: Basic Supplier Directory
// ─────────────────────────────────────────────

/**
 * Render vendor directory grid.
 * Displays profiles and connects PO compiler operations.
 */
function renderSuppliersDirectory() {
  const grid = document.getElementById('suppliers-grid');
  if (!grid) return;

  const state = getState();
  const suppliers = state.suppliers || [];
  const inventory = state.inventory || [];

  if (suppliers.length === 0) {
    grid.className = 'flex flex-col items-center justify-center p-xl bg-surface-container rounded-2xl border border-outline-variant py-12';
    grid.innerHTML = `
      <span class="material-symbols-outlined text-5xl text-outline-variant mb-2">groups</span>
      <p class="text-body-md text-on-surface-variant italic">No vendors registered in the directory.</p>
    `;
    return;
  }

  grid.className = 'grid grid-cols-1 md:grid-cols-3 gap-md';
  grid.innerHTML = suppliers.map(supplier => {
    // Check which ingredients are mapped to this supplier
    const items = inventory.filter(i => i.supplier_id === supplier.id);
    const lowStockCount = items.filter(i => i.current_stock <= i.reorder_threshold).length;

    // Days pill formatting
    const daysPill = supplier.delivery_days 
      ? `<p class="text-[10px] text-primary bg-secondary/15 px-2 py-0.5 rounded font-black max-w-max flex items-center gap-xs"><span class="material-symbols-outlined text-[12px]">local_shipping</span> Delivery: ${supplier.delivery_days}</p>`
      : '';

    return `
      <div class="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant shadow-sm flex flex-col justify-between gap-md relative overflow-hidden">
        <div>
          <!-- Vendor Header -->
          <div class="flex justify-between items-start border-b border-outline-variant pb-2 mb-2">
            <div>
              <h5 class="font-headline-md text-headline-md text-primary font-black">${supplier.name}</h5>
              <p class="text-[11px] text-on-surface-variant mt-0.5">Contact: <strong>${supplier.contact_person || 'Unspecified'}</strong></p>
            </div>
            <div class="flex gap-xs">
              <button data-edit-supplier-id="${supplier.id}" class="p-1 text-on-surface-variant hover:text-primary rounded hover:bg-surface-container" title="Edit Supplier">
                <span class="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button data-delete-supplier-id="${supplier.id}" class="p-1 text-on-surface-variant hover:text-error rounded hover:bg-error/10" title="Delete Supplier">
                <span class="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          </div>

          <!-- Vendor Rolodex details -->
          <div class="flex flex-col gap-xs text-body-md text-on-surface-variant font-medium mt-3">
            <p class="flex items-center gap-sm"><span class="material-symbols-outlined text-sm">phone</span> ${supplier.phone || '<span class="italic text-outline-variant">None</span>'}</p>
            <p class="flex items-center gap-sm"><span class="material-symbols-outlined text-sm">mail</span> ${supplier.email || '<span class="italic text-outline-variant">None</span>'}</p>
          </div>
        </div>

        <div class="border-t border-outline-variant border-dashed pt-3 mt-1 flex flex-col gap-sm">
          <!-- Shipping and supply stats -->
          <div class="flex justify-between items-center text-[10px] font-mono-md text-on-surface-variant">
            <span>Ingredients: <strong>${items.length} mapped</strong></span>
            ${lowStockCount > 0 ? `<span class="text-error font-bold font-sans">${lowStockCount} LOW STOCK</span>` : '<span class="text-secondary font-bold font-sans">Stocks Safe</span>'}
          </div>
          ${daysPill}

          <!-- PO Trigger -->
          <button data-po-supplier-id="${supplier.id}" class="w-full mt-2 py-2 bg-primary text-on-primary hover:opacity-90 rounded-lg text-label-md font-bold transition-all active:scale-[0.99] flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-[16px]">receipt_long</span>
            Draft Reorder PO
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Setup click listeners on vendor card buttons
  grid.querySelectorAll('[data-edit-supplier-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-supplier-id');
      openSupplierModal(id);
    });
  });

  grid.querySelectorAll('[data-delete-supplier-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-supplier-id');
      const supplier = suppliers.find(s => s.id === id);
      if (!supplier) return;

      if (confirm(`Remove vendor profile "${supplier.name}"? (Note: Mapped ingredients will have supplier link removed)`)) {
        try {
          await deleteSupplier(id);
          await queueSync('suppliers', 'DELETE', { id });

          // Clear supplier links in inventory database
          const mappedItems = inventory.filter(i => i.supplier_id === id);
          for (const item of mappedItems) {
            item.supplier_id = null;
            item.updated_at = new Date().toISOString();
            await upsertInventory(item);
            await queueSync('inventory', 'UPDATE', item);
          }

          showToast(`Deleted supplier: ${supplier.name}`, 'info');
          await refreshInventoryData();
          renderActiveTab();
        } catch (err) {
          console.error(err);
          showToast('Failed to delete supplier', 'error');
        }
      }
    });
  });

  grid.querySelectorAll('[data-po-supplier-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-po-supplier-id');
      generateDraftPurchaseOrder(id);
    });
  });
}

/**
 * Calculates depleted stocks supplied by the vendor and displays a modal.
 * @param {string} supplierId 
 */
function generateDraftPurchaseOrder(supplierId) {
  const state = getState();
  const supplier = state.suppliers.find(s => s.id === supplierId);
  const inventory = state.inventory || [];

  if (!supplier) return;

  // Filter low-stock ingredients linked to this vendor
  const vendorIngredients = inventory.filter(i => i.supplier_id === supplierId);
  const lowStock = vendorIngredients.filter(i => i.current_stock <= i.reorder_threshold);

  const modal = document.getElementById('draft-po-modal');
  const content = document.getElementById('draft-po-content');
  const closeBtn = document.getElementById('btn-close-draft-po');
  const copyBtn = document.getElementById('btn-copy-draft-po');
  const printBtn = document.getElementById('btn-print-draft-po');

  if (!modal || !content) return;

  const closePOModal = () => modal.classList.add('hidden');
  closeBtn.onclick = closePOModal;

  const orderDate = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  if (lowStock.length === 0) {
    content.innerHTML = `
      <div class="text-center py-6 text-on-surface-variant font-sans">
        <span class="material-symbols-outlined text-4xl text-secondary mb-2">check_circle</span>
        <p class="font-bold text-primary">All Stock Levels Safe!</p>
        <p class="text-xs mt-1">There are no ingredients supplied by <strong>${supplier.name}</strong> currently below par levels.</p>
      </div>
    `;
    copyBtn.disabled = true;
    printBtn.disabled = true;
    modal.classList.remove('hidden');
    return;
  }

  copyBtn.disabled = false;
  printBtn.disabled = false;

  let totalPOValue = 0;
  const tableRows = lowStock.map(item => {
    // Order amount = Par Level - Current Stock (rounded to match UoM)
    const needed = Math.max(1, Math.ceil(Number(item.reorder_threshold) - Number(item.current_stock)));
    const itemCost = needed * Number(item.unit_cost);
    totalPOValue += itemCost;

    return {
      name: item.ingredient_name,
      needed,
      unit: item.unit,
      cost: itemCost,
      unitCost: item.unit_cost,
      current: item.current_stock,
      par: item.reorder_threshold
    };
  });

  // Structure Draft PO String
  let poText = `====================================================\n`;
  poText += `DRAFT PURCHASE ORDER (REORDER REPORT)\n`;
  poText += `TableCraft OS — RESTRO-AI\n`;
  poText += `====================================================\n\n`;
  poText += `DATE: ${orderDate}\n`;
  poText += `VENDOR: ${supplier.name}\n`;
  poText += `CONTACT PERSON: ${supplier.contact_person || 'N/A'}\n`;
  poText += `PHONE: ${supplier.phone || 'N/A'}\n`;
  poText += `EMAIL: ${supplier.email || 'N/A'}\n`;
  poText += `DELIVERY DAYS: ${supplier.delivery_days || 'N/A'}\n\n`;
  poText += `----------------------------------------------------\n`;
  poText += `ITEM NAME          | ORDER QTY  | UNIT COST | TOTAL \n`;
  poText += `----------------------------------------------------\n`;

  tableRows.forEach(row => {
    const paddedName = row.name.padEnd(18).slice(0, 18);
    const paddedQty = `${row.needed} ${row.unit}`.padEnd(10).slice(0, 10);
    const formattedUnitCost = Number(row.unitCost).toFixed(2).padStart(9);
    const formattedCost = Number(row.cost).toFixed(2).padStart(8);
    poText += `${paddedName} | ${paddedQty} | ${formattedUnitCost} | ${formattedCost}\n`;
  });

  poText += `----------------------------------------------------\n`;
  poText += `TOTAL ESTIMATED ORDER COST:      ${formatPrice(totalPOValue)}\n`;
  poText += `====================================================\n`;

  content.innerHTML = `<pre class="bg-surface-container p-md border border-outline-variant rounded-xl overflow-x-auto text-[11px] leading-relaxed select-text">${poText}</pre>`;

  // Copy to clipboard action
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(poText).then(() => {
      showToast('PO draft copied to clipboard!', 'success');
    }).catch(err => {
      console.error(err);
      showToast('Clipboard permission denied', 'error');
    });
  };

  // Print action
  printBtn.onclick = () => {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><head><title>Purchase Order Draft - ${supplier.name}</title><style>body { font-family: monospace; white-space: pre; padding: 2em; }</style></head><body>${poText}</body></html>`);
      win.document.close();
      win.print();
    }
  };

  modal.classList.remove('hidden');
}
