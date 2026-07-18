// Menu Management Panel Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, upsertTable, getAllMenuItems, addMenuItem, deleteMenuItem, getOrderByTable, createOrder, updateOrder, getOrderItems, addOrderItem, updateOrderItem, isTakeawayTable, getChannelFromTableName } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { uploadMenuImage } from '../db/supabase.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';
import { analyzeImage } from '../services/ocrService.js';
import { compressImageIfNeeded } from '../utils/imageCompressor.js';

/**
 * Initialize Menu panel controls.
 */
export function initMenuPanel() {
  const btnAddMenuItem = document.getElementById('btn-add-menu-item');
  const addMenuForm = document.getElementById('add-menu-form');
  const btnSaveMenuItem = document.getElementById('btn-save-menu-item');
  const btnCancelMenuItem = document.getElementById('btn-cancel-menu-item');

  const btnMenuSettings = document.getElementById('btn-menu-settings');
  const menuActionsExpanded = document.getElementById('menu-actions-expanded');
  const btnCloseMenuActions = document.getElementById('btn-close-menu-actions');
  const btnImportMenu = document.getElementById('btn-import-menu');

  // Open expanded actions menu
  if (btnMenuSettings && menuActionsExpanded) {
    btnMenuSettings.addEventListener('click', () => {
      btnMenuSettings.classList.add('opacity-0', 'pointer-events-none', '-translate-x-4');
      menuActionsExpanded.classList.remove('opacity-0', 'pointer-events-none', 'translate-x-4');
      menuActionsExpanded.classList.add('opacity-100', 'translate-x-0');
    });
  }

  // Close expanded actions menu function
  const closeMenuActions = () => {
    if (btnMenuSettings && menuActionsExpanded) {
      menuActionsExpanded.classList.remove('opacity-100', 'translate-x-0');
      menuActionsExpanded.classList.add('opacity-0', 'pointer-events-none', 'translate-x-4');
      btnMenuSettings.classList.remove('opacity-0', 'pointer-events-none', '-translate-x-4');
    }
  };

  if (btnCloseMenuActions) {
    btnCloseMenuActions.addEventListener('click', closeMenuActions);
  }

  // --- State for Add/OCR Form ---
  let ocrQueue = [];
  let isOcrMode = false;

  const ocrFileInput = document.getElementById('ocr-file-input');
  const ocrLoadingSection = document.getElementById('ocr-loading-section');
  const addMenuFormRows = document.getElementById('add-menu-form-rows');
  const addMenuFormTitle = document.getElementById('add-menu-form-title');
  const addMenuFormBatchInfo = document.getElementById('add-menu-form-batch-info');
  const btnSkipMenuItem = document.getElementById('btn-skip-menu-item');

  // Toggle add item form manually
  if (btnAddMenuItem && addMenuForm) {
    btnAddMenuItem.addEventListener('click', () => {
      closeMenuActions();
      isOcrMode = false;
      ocrQueue = [];
      renderFormBatch([{ name: '', description: '', category: 'General', price: '' }]);
      addMenuForm.classList.remove('hidden');
    });
  }

  if (btnImportMenu) {
    btnImportMenu.addEventListener('click', () => {
      closeMenuActions();
      if (ocrFileInput) ocrFileInput.click();
    });
  }

  // Hide form and clear state
  const resetForm = () => {
    if (addMenuForm) addMenuForm.classList.add('hidden');
    if (addMenuFormRows) addMenuFormRows.innerHTML = '';
    ocrQueue = [];
    isOcrMode = false;
    if (ocrFileInput) ocrFileInput.value = '';
    if (btnSaveMenuItem) {
      btnSaveMenuItem.disabled = false;
      btnSaveMenuItem.innerText = 'Save';
    }
  };

  if (btnCancelMenuItem) btnCancelMenuItem.addEventListener('click', resetForm);
  if (btnSkipMenuItem) btnSkipMenuItem.addEventListener('click', () => {
    if (isOcrMode) renderNextBatch();
  });

  const renderFormBatch = (items) => {
    if (!addMenuFormRows) return;
    
    if (isOcrMode) {
      addMenuFormTitle.innerText = "Review OCR Items";
      addMenuFormBatchInfo.innerText = ocrQueue.length > 0 ? `${ocrQueue.length} items remaining` : 'Final batch';
      btnSkipMenuItem.classList.remove('hidden');
      btnSaveMenuItem.innerText = ocrQueue.length > 0 ? 'Save Batch & Next' : 'Save Batch';
    } else {
      addMenuFormTitle.innerText = "Add Menu Item";
      addMenuFormBatchInfo.innerText = "";
      btnSkipMenuItem.classList.add('hidden');
      btnSaveMenuItem.innerText = 'Save';
    }

    addMenuFormRows.innerHTML = items.map((item, index) => `
      <div class="menu-item-row flex flex-col md:flex-row flex-wrap gap-sm md:items-end py-2 relative" data-index="${index}">
        <div class="flex gap-sm w-full md:w-auto md:flex-1">
          <div>
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Image</label>
            <input type="file" accept="image/*" class="menu-image-input hidden">
            <button type="button" class="menu-image-btn w-12 h-10 flex items-center justify-center bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden hover:border-primary transition-colors">
              <span class="menu-image-placeholder material-symbols-outlined text-[20px] text-on-surface-variant">add_photo_alternate</span>
              <img src="" class="menu-image-preview hidden w-full h-full object-cover">
            </button>
          </div>
          <div class="flex-1">
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Name</label>
            <input type="text" class="menu-name-input w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" value="${item.name || ''}" placeholder="Item name">
          </div>
        </div>
        <div class="w-full md:w-1/3 min-w-[200px]">
          <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Description</label>
          <input type="text" class="menu-description-input w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" value="${item.description || ''}" placeholder="Brief description">
        </div>
        <div class="flex gap-sm w-full md:w-auto items-end">
          <div class="flex-1 md:flex-none">
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Category</label>
            <input type="text" list="category-options" class="menu-category-input w-full md:w-32 h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" value="${item.category || ''}" placeholder="Category">
          </div>
          <div class="flex-1 md:flex-none">
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Price</label>
            <input type="number" step="0.01" min="0" class="menu-price-input w-full md:w-24 h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md font-mono-md focus:outline-none focus:border-primary" value="${item.price || ''}" placeholder="0.00">
          </div>
          ${isOcrMode ? `
          <button type="button" class="btn-remove-row h-10 px-3 bg-error/10 text-error rounded-lg hover:bg-error/20" title="Remove item">✕</button>
          ` : ''}
        </div>
      </div>
    `).join('');

    // Attach event listeners for dynamic rows
    addMenuFormRows.querySelectorAll('.menu-item-row').forEach(row => {
      const imgInput = row.querySelector('.menu-image-input');
      const imgBtn = row.querySelector('.menu-image-btn');
      const imgPreview = row.querySelector('.menu-image-preview');
      const imgPlaceholder = row.querySelector('.menu-image-placeholder');
      const removeBtn = row.querySelector('.btn-remove-row');

      if (imgBtn && imgInput) {
        imgBtn.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            imgPreview.src = URL.createObjectURL(file);
            imgPreview.classList.remove('hidden');
            imgPlaceholder.classList.add('hidden');
          } else {
            imgPreview.src = '';
            imgPreview.classList.add('hidden');
            imgPlaceholder.classList.remove('hidden');
          }
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          row.remove();
          if (addMenuFormRows.children.length === 0) {
            if (isOcrMode && ocrQueue.length > 0) renderNextBatch();
            else resetForm();
          }
        });
      }
    });

    if (addMenuForm) addMenuForm.classList.remove('hidden');
  };

  const renderNextBatch = () => {
    if (ocrQueue.length === 0) {
      resetForm();
      return;
    }
    const batch = ocrQueue.splice(0, 5);
    renderFormBatch(batch);
  };

  const handleOcrFile = async (file) => {
    if (!file) return;
    
    if (ocrLoadingSection) ocrLoadingSection.classList.remove('hidden');
    if (addMenuForm) addMenuForm.classList.add('hidden'); // hide while loading
    
    try {
      const processedFile = await compressImageIfNeeded(file);
      const parsedData = await analyzeImage(processedFile);
      
      // Filter out garbage and map to our format
      ocrQueue = parsedData
        .filter(item => item.category !== 'Unparsed Text' && item.name.trim().length > 0)
        .map(item => ({
          name: item.name,
          category: item.category || 'General',
          price: parseFloat(item.rate) || 0,
          description: item.description || ''
        }));

      if (ocrQueue.length === 0) {
        showToast('No valid menu items found in the image', 'info');
        resetForm();
      } else {
        isOcrMode = true;
        renderNextBatch();
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to analyze menu image', 'error');
      resetForm();
    } finally {
      if (ocrLoadingSection) ocrLoadingSection.classList.add('hidden');
      if (ocrFileInput) ocrFileInput.value = '';
    }
  };

  if (ocrFileInput) {
    ocrFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleOcrFile(e.target.files[0]);
      }
    });
  }

  // Save menu items (supports single and batch)
  if (btnSaveMenuItem) {
    btnSaveMenuItem.addEventListener('click', async () => {
      const rows = Array.from(addMenuFormRows.querySelectorAll('.menu-item-row'));
      if (rows.length === 0) return;

      btnSaveMenuItem.disabled = true;
      const originalText = btnSaveMenuItem.innerText;
      btnSaveMenuItem.innerText = 'Saving...';

      let addedCount = 0;
      let hasError = false;

      for (const row of rows) {
        const imageInput = row.querySelector('.menu-image-input');
        const nameInput = row.querySelector('.menu-name-input');
        const descInput = row.querySelector('.menu-description-input');
        const catInput = row.querySelector('.menu-category-input');
        const priceInput = row.querySelector('.menu-price-input');

        const name = nameInput ? nameInput.value.trim() : '';
        const price = priceInput ? parseFloat(priceInput.value) : 0;
        
        if (!name) continue; // Skip empty rows
        if (isNaN(price) || price < 0) {
          showToast(`Invalid price for item: ${name}`, 'error');
          hasError = true;
          continue;
        }

        const description = descInput ? descInput.value.trim() : '';
        const category = catInput ? catInput.value : 'General';
        let image_url = null;

        try {
          if (imageInput && imageInput.files.length > 0) {
            const uploadedUrl = await uploadMenuImage(imageInput.files[0], category, name);
            if (uploadedUrl) image_url = uploadedUrl;
          }

          const newItem = {
            id: uuidv4(),
            name,
            description,
            image_url,
            price,
            category,
            is_active: true,
            created_at: new Date().toISOString()
          };

          await addMenuItem(newItem);
          await queueSync('menu_items', 'INSERT', newItem);
          addedCount++;
        } catch (err) {
          console.error(err);
          hasError = true;
        }
      }

      if (addedCount > 0) {
        const allItems = await getAllMenuItems();
        setState('menuItems', allItems);
        showToast(`Successfully saved ${addedCount} items`, 'success');
      } else if (!hasError) {
        showToast('No valid items to save', 'info');
      }

      btnSaveMenuItem.disabled = false;
      btnSaveMenuItem.innerText = originalText;

      if (isOcrMode && ocrQueue.length > 0) {
        renderNextBatch();
      } else {
        resetForm();
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
          <div class="w-12 h-12 shrink-0 bg-surface-container rounded-lg flex items-center justify-center overflow-hidden">
            ${item.image_url 
              ? `<img src="${item.image_url}" class="w-full h-full object-cover" />` 
              : `<span class="material-symbols-outlined text-[24px] text-on-surface-variant/40">restaurant</span>`
            }
          </div>
          <div>
            <h4 class="font-headline-md text-headline-md text-primary leading-tight">${item.name}</h4>
            ${item.description ? `<p class="text-[11px] text-on-surface-variant line-clamp-1 mt-0.5 mb-1">${item.description}</p>` : ''}
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
