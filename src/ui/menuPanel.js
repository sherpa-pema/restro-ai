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

  // Toggle add item form
  if (btnAddMenuItem && addMenuForm) {
    btnAddMenuItem.addEventListener('click', () => {
      closeMenuActions(); // close the expanded menu when clicking Add Item
      addMenuForm.classList.toggle('hidden');
      if (!addMenuForm.classList.contains('hidden')) {
        const nameInput = document.getElementById('menu-name-input');
        if (nameInput) nameInput.focus();
      }
    });
  }

  if (btnImportMenu) {
    btnImportMenu.addEventListener('click', () => {
      closeMenuActions();
      const fileInput = document.getElementById('ocr-file-input');
      if (fileInput) fileInput.click();
    });
  }

  // --- OCR Modal Logic ---
  const ocrModal = document.getElementById('import-menu-modal');
  const btnCloseOcrModal = document.getElementById('btn-close-import-menu');
  const ocrFileInput = document.getElementById('ocr-file-input');
  const ocrLoadingSection = document.getElementById('ocr-loading-section');
  const ocrResultsSection = document.getElementById('ocr-results-section');
  const ocrResultsBody = document.getElementById('ocr-results-body');
  const btnSaveOcrItems = document.getElementById('btn-save-ocr-items');
  
  let extractedOcrItems = [];

  const resetOcrModal = () => {
    if (ocrModal) ocrModal.classList.add('hidden');
    if (ocrLoadingSection) ocrLoadingSection.classList.add('hidden');
    if (ocrResultsSection) ocrResultsSection.classList.add('hidden');
    if (ocrResultsBody) ocrResultsBody.innerHTML = '';
    if (btnSaveOcrItems) btnSaveOcrItems.disabled = true;
    if (btnSaveOcrItems) btnSaveOcrItems.innerText = 'Save to Menu';
    if (ocrFileInput) ocrFileInput.value = '';
    extractedOcrItems = [];
  };

  if (btnCloseOcrModal) {
    btnCloseOcrModal.addEventListener('click', resetOcrModal);
  }

  const handleOcrFile = async (file) => {
    if (!file) return;
    
    // Open the modal now that a file has been selected
    if (ocrModal) ocrModal.classList.remove('hidden');
    
    ocrLoadingSection.classList.remove('hidden');
    ocrResultsSection.classList.add('hidden');
    btnSaveOcrItems.disabled = true;

    try {
      const processedFile = await compressImageIfNeeded(file);
      const parsedData = await analyzeImage(processedFile);
      extractedOcrItems = parsedData;

      // Render table
      ocrResultsBody.innerHTML = parsedData.map(item => `
        <tr class="hover:bg-surface-container transition-colors">
          <td class="p-2 border-b border-outline-variant/30 text-primary font-medium">${item.name}</td>
          <td class="p-2 border-b border-outline-variant/30 text-on-surface-variant">${item.category}</td>
          <td class="p-2 border-b border-outline-variant/30 text-primary font-mono-md">${formatPrice(parseFloat(item.rate) || 0)}</td>
        </tr>
      `).join('');

      ocrLoadingSection.classList.add('hidden');
      ocrResultsSection.classList.remove('hidden');
      
      if (parsedData.length > 0 && parsedData[0].category !== 'Unparsed Text') {
        btnSaveOcrItems.disabled = false;
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to analyze menu image', 'error');
      resetOcrModal();
    }
  };

  if (ocrFileInput) {
    ocrFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleOcrFile(e.target.files[0]);
      }
    });
  }

  if (btnSaveOcrItems) {
    btnSaveOcrItems.addEventListener('click', async () => {
      if (extractedOcrItems.length === 0) return;
      
      btnSaveOcrItems.disabled = true;
      btnSaveOcrItems.innerText = 'Saving...';
      
      try {
        let addedCount = 0;
        for (const item of extractedOcrItems) {
          if (item.category === 'Unparsed Text') continue;
          
          const newItem = {
            id: uuidv4(),
            name: item.name,
            description: item.description || '',
            image_url: null,
            price: parseFloat(item.rate) || 0,
            category: item.category || 'General',
            is_active: true,
            created_at: new Date().toISOString()
          };

          await addMenuItem(newItem);
          await queueSync('menu_items', 'INSERT', newItem);
          addedCount++;
        }

        // Refresh state
        const allItems = await getAllMenuItems();
        setState('menuItems', allItems);

        showToast(`Successfully added ${addedCount} items to menu`, 'success');
        resetOcrModal();
      } catch (err) {
        console.error(err);
        showToast('Failed to save imported menu items', 'error');
        btnSaveOcrItems.disabled = false;
        btnSaveOcrItems.innerText = 'Save to Menu';
      }
    });
  }
  // --- End OCR Modal Logic ---

  const imageInput = document.getElementById('menu-image-input');
  const imageBtn = document.getElementById('menu-image-btn');
  const imagePreview = document.getElementById('menu-image-preview');
  const imagePlaceholder = document.getElementById('menu-image-placeholder');

  // Handle image selection preview
  if (imageBtn && imageInput) {
    imageBtn.addEventListener('click', () => imageInput.click());
    
    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const url = URL.createObjectURL(file);
        if (imagePreview) {
          imagePreview.src = url;
          imagePreview.classList.remove('hidden');
        }
        if (imagePlaceholder) imagePlaceholder.classList.add('hidden');
      } else {
        if (imagePreview) {
          imagePreview.src = '';
          imagePreview.classList.add('hidden');
        }
        if (imagePlaceholder) imagePlaceholder.classList.remove('hidden');
      }
    });
  }

  // Hide form and clear inputs
  const resetForm = () => {
    if (addMenuForm) addMenuForm.classList.add('hidden');
    const imageInput = document.getElementById('menu-image-input');
    const imagePreview = document.getElementById('menu-image-preview');
    const imagePlaceholder = document.getElementById('menu-image-placeholder');
    const nameInput = document.getElementById('menu-name-input');
    const descriptionInput = document.getElementById('menu-description-input');
    const categoryInput = document.getElementById('menu-category-input');
    const priceInput = document.getElementById('menu-price-input');
    
    if (imageInput) imageInput.value = '';
    if (imagePreview) {
      imagePreview.src = '';
      imagePreview.classList.add('hidden');
    }
    if (imagePlaceholder) imagePlaceholder.classList.remove('hidden');
    
    if (nameInput) nameInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    if (categoryInput) categoryInput.value = 'General';
    if (priceInput) priceInput.value = '';
  };

  if (btnCancelMenuItem) btnCancelMenuItem.addEventListener('click', resetForm);

  // Save new menu item
  if (btnSaveMenuItem) {
    btnSaveMenuItem.addEventListener('click', async () => {
      const imageInput = document.getElementById('menu-image-input');
      const nameInput = document.getElementById('menu-name-input');
      const descriptionInput = document.getElementById('menu-description-input');
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
      const description = descriptionInput ? descriptionInput.value.trim() : '';
      const price = parseFloat(priceInput.value);
      const categoryInput = document.getElementById('menu-category-input');
      const category = categoryInput ? categoryInput.value : 'General';
      
      let image_url = null;

      btnSaveMenuItem.disabled = true;
      btnSaveMenuItem.innerText = 'Saving...';

      try {
        if (imageInput && imageInput.files.length > 0) {
          const file = imageInput.files[0];
          const uploadedUrl = await uploadMenuImage(file, category, name);
          if (uploadedUrl) {
            image_url = uploadedUrl;
          }
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

        // Refresh state
        const allItems = await getAllMenuItems();
        setState('menuItems', allItems);

        showToast(`${name} added to menu`, 'success');
        resetForm();
      } catch (err) {
        console.error(err);
        showToast('Failed to add menu item', 'error');
      } finally {
        btnSaveMenuItem.disabled = false;
        btnSaveMenuItem.innerText = 'Save';
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
