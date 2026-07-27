// Menu Management Panel Module for TableCraft OS

import { getState, setState, on, formatPrice } from '../state.js';
import { getAllTables, getTable, upsertTable, getAllMenuItems, addMenuItem, deleteMenuItem, getOrderByTable, createOrder, updateOrder, getOrderItems, addOrderItem, updateOrderItem, isTakeawayTable, getChannelFromTableName } from '../db/indexedDB.js';
import { queueSync } from '../db/syncEngine.js';
import { uploadMenuImage } from '../db/supabase.js';
import { showToast } from './toasts.js';
import { v4 as uuidv4 } from 'uuid';
import { analyzeImage } from '../services/ocrService.js';
import { compressImageIfNeeded } from '../utils/imageCompressor.js';

export let isMenuEditMode = false;
export let editingItemId = null;
export let renderFormBatchFn = null;
export let isOcrMode = false;
export let ocrQueue = [];

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
  const searchInput = document.getElementById('menu-search-input');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderMenuPanel();
    });
  }



  // --- State for Add/OCR Form ---
  ocrQueue = [];
  isOcrMode = false;

  const ocrFileInput = document.getElementById('ocr-file-input');
  const btnDeleteMenuItem = document.getElementById('btn-delete-menu-item');
  const ocrLoadingSection = document.getElementById('ocr-loading-section');
  const addMenuFormRows = document.getElementById('add-menu-form-rows');
  const addMenuFormTitle = document.getElementById('add-menu-form-title');
  const addMenuFormBatchInfo = document.getElementById('add-menu-form-batch-info');
  const btnSkipMenuItem = document.getElementById('btn-skip-menu-item');

  // Hide form and clear state
  const resetForm = () => {
    if (addMenuForm) addMenuForm.classList.add('hidden');
    if (addMenuFormRows) addMenuFormRows.innerHTML = '';
    ocrQueue = [];
    isOcrMode = false;
    editingItemId = null;
    if (btnDeleteMenuItem) btnDeleteMenuItem.classList.add('hidden');
    if (ocrFileInput) ocrFileInput.value = '';
    if (btnSaveMenuItem) {
      btnSaveMenuItem.disabled = false;
      btnSaveMenuItem.innerText = 'Save';
    }
  };

  // Close expanded actions menu function
  const closeMenuActions = () => {
    if (btnMenuSettings && menuActionsExpanded) {
      menuActionsExpanded.classList.remove('opacity-100', 'translate-x-0');
      menuActionsExpanded.classList.add('opacity-0', 'pointer-events-none', 'translate-x-4');
      btnMenuSettings.classList.remove('opacity-0', 'pointer-events-none', '-translate-x-4');
      isMenuEditMode = false;
      renderMenuPanel();
      
      // Also close the add item form
      resetForm();
    }
  };

  if (btnCloseMenuActions) {
    btnCloseMenuActions.addEventListener('click', closeMenuActions);
  }

  if (btnImportMenu) {
    btnImportMenu.addEventListener('click', () => {
      closeMenuActions();
      if (ocrFileInput) ocrFileInput.click();
    });
  }

  // Use settings icon to directly open Add Menu Item form AND expand actions
  if (btnMenuSettings && addMenuForm) {
    btnMenuSettings.addEventListener('click', () => {
      isOcrMode = false;
      editingItemId = null;
      if (btnDeleteMenuItem) btnDeleteMenuItem.classList.add('hidden');
      ocrQueue = [];
      renderFormBatch([{ name: '', description: '', category: 'General', price: '' }]);
      addMenuForm.classList.remove('hidden');

      // Expand actions menu
      if (menuActionsExpanded) {
        btnMenuSettings.classList.add('opacity-0', 'pointer-events-none', '-translate-x-4');
        menuActionsExpanded.classList.remove('opacity-0', 'pointer-events-none', 'translate-x-4');
        menuActionsExpanded.classList.add('opacity-100', 'translate-x-0');
        isMenuEditMode = true;
        renderMenuPanel();
      }
    });
  }

  if (btnCancelMenuItem) btnCancelMenuItem.addEventListener('click', resetForm);

  if (btnDeleteMenuItem) {
    btnDeleteMenuItem.addEventListener('click', async () => {
      if (!editingItemId) return;
      
      const state = getState();
      const item = state.menuItems.find(i => i.id === editingItemId);
      if (!item) return;

      if (confirm(`Remove "${item.name}" from the menu?`)) {
        btnDeleteMenuItem.disabled = true;
        try {
          await deleteMenuItem(editingItemId);
          await queueSync('menu_items', 'DELETE', { id: editingItemId });

          const allItems = await getAllMenuItems();
          setState('menuItems', allItems);

          showToast(`"${item.name}" removed from menu`, 'info');
          resetForm();
        } catch (err) {
          console.error(err);
          showToast('Failed to remove menu item', 'error');
        } finally {
          btnDeleteMenuItem.disabled = false;
        }
      }
    });
  }
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
      addMenuFormTitle.innerText = editingItemId ? "Edit Item" : "Add Menu Item";
      addMenuFormBatchInfo.innerText = "";
      btnSkipMenuItem.classList.add('hidden');
      btnSaveMenuItem.innerText = 'Save';
    }

    const uniqueCategories = [...new Set(getState().menuItems.map(i => i.category).filter(Boolean))];
    if (uniqueCategories.length === 0) {
      ['General', 'Starters', 'Mains', 'Desserts', 'Beverages'].forEach(c => uniqueCategories.push(c));
    } else if (!uniqueCategories.includes('General')) {
      uniqueCategories.unshift('General');
    }

    addMenuFormRows.innerHTML = items.map((item, index) => {
      const initialCat = item.category || 'General';
      const isCustomCat = !uniqueCategories.includes(initialCat);
      const selectValue = isCustomCat ? '__custom__' : initialCat;
      const customValue = isCustomCat ? initialCat : '';

      return `
      <div class="menu-item-row flex flex-col md:flex-row flex-wrap gap-sm md:items-end py-2 relative" data-index="${index}">
        <div class="flex gap-sm w-full md:w-auto md:flex-1">
          <div>
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Image</label>
            <input type="file" accept="image/*" class="menu-image-input hidden">
            <button type="button" class="menu-image-btn w-12 h-10 flex items-center justify-center bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden hover:border-primary transition-colors">
              <span class="menu-image-placeholder material-symbols-outlined text-[20px] text-on-surface-variant ${item.image_url ? 'hidden' : ''}">add_photo_alternate</span>
              <img src="${item.image_url || ''}" class="menu-image-preview ${item.image_url ? '' : 'hidden'} w-full h-full object-cover">
            </button>
          </div>
          <div class="flex-1">
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Name</label>
            <input type="text" class="menu-name-input h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" style="width: calc(100% - 7px);" value="${item.name || ''}" placeholder="Item name">
          </div>
        </div>
        <div class="w-full md:w-1/3 min-w-[200px]">
          <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Description</label>
          <input type="text" class="menu-description-input h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" style="width: calc(100% - 4px);" value="${item.description || ''}" placeholder="Brief description">
        </div>
        <div class="flex gap-sm w-full md:w-auto items-end">
          <div class="flex-1 md:flex-none">
            <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block mb-1">Category</label>
            <div class="flex flex-col gap-1">
              <select class="menu-category-select w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" style="min-width: 240px;">
                ${uniqueCategories.map(cat => `<option value="${cat}" ${selectValue === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                <option value="__custom__" ${selectValue === '__custom__' ? 'selected' : ''}>+ Add Custom...</option>
              </select>
              <input type="text" class="menu-category-custom-input ${isCustomCat ? '' : 'hidden'} w-full h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md focus:outline-none focus:border-primary" style="min-width: 240px;" value="${customValue}" placeholder="New Category">
            </div>
          </div>
          <div class="flex-1 md:flex-none">
            <div class="flex items-center justify-between mb-1">
              <label class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest block">Price</label>
              <label class="flex items-center gap-1 cursor-pointer" title="Add sizes or variations">
                <input type="checkbox" class="menu-has-variants-checkbox accent-primary h-3 w-3" ${item.variants && item.variants.length > 0 ? 'checked' : ''}>
                <span class="text-[10px] text-on-surface-variant">Has Variants</span>
              </label>
            </div>
            <input type="number" step="0.01" min="0" class="menu-price-input ${item.variants && item.variants.length > 0 ? 'hidden' : ''} w-full md:w-24 h-10 px-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-body-md font-mono-md focus:outline-none focus:border-primary" value="${item.price || ''}" placeholder="0.00">
          </div>
          ${isOcrMode ? `
          <button type="button" class="btn-remove-row h-10 px-3 bg-error/10 text-error rounded-lg hover:bg-error/20" title="Remove item">✕</button>
          ` : ''}
        </div>
        
        <!-- Variants Container -->
        <div class="variants-container ${item.variants && item.variants.length > 0 ? 'flex' : 'hidden'} w-full bg-surface-container-low p-3 rounded-lg mt-2 border border-outline-variant flex-col gap-2">
          <div class="variants-list flex flex-col gap-2">
            ${item.variants && item.variants.length > 0 ? item.variants.map(v => `
            <div class="variant-row flex gap-2 items-center">
              <input type="text" placeholder="Size (e.g. 30ml)" class="variant-name-input flex-1 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm focus:border-primary focus:outline-none" value="${v.name || ''}">
              <input type="number" step="0.01" min="0" placeholder="Price" class="variant-price-input w-24 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm font-mono-sm focus:border-primary focus:outline-none" value="${v.price || ''}">
              <button type="button" class="btn-remove-variant w-9 h-9 flex items-center justify-center text-error opacity-50 hover:opacity-100 hover:bg-error/10 rounded-md transition-all">✕</button>
            </div>
            `).join('') : `
            <div class="variant-row flex gap-2 items-center">
              <input type="text" placeholder="Size (e.g. 30ml)" class="variant-name-input flex-1 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm focus:border-primary focus:outline-none">
              <input type="number" step="0.01" min="0" placeholder="Price" class="variant-price-input w-24 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm font-mono-sm focus:border-primary focus:outline-none">
              <button type="button" class="btn-remove-variant w-9 h-9 flex items-center justify-center text-error opacity-50 hover:opacity-100 hover:bg-error/10 rounded-md transition-all">✕</button>
            </div>
            `}
          </div>
          <button type="button" class="btn-add-variant self-start mt-1 text-primary text-[12px] font-medium hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-[14px]">add</span> Add Option
          </button>
        </div>
      </div>
      `;
    }).join('');

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

      // Category Logic
      const categorySelect = row.querySelector('.menu-category-select');
      const customCategoryInput = row.querySelector('.menu-category-custom-input');
      
      if (categorySelect && customCategoryInput) {
        categorySelect.addEventListener('change', (e) => {
          if (e.target.value === '__custom__') {
            customCategoryInput.classList.remove('hidden');
            customCategoryInput.focus();
          } else {
            customCategoryInput.classList.add('hidden');
          }
        });
      }

      // Variants Logic
      const hasVariantsCheckbox = row.querySelector('.menu-has-variants-checkbox');
      const variantsContainer = row.querySelector('.variants-container');
      const priceInput = row.querySelector('.menu-price-input');
      const btnAddVariant = row.querySelector('.btn-add-variant');
      const variantsList = row.querySelector('.variants-list');

      if (hasVariantsCheckbox && variantsContainer && priceInput) {
        hasVariantsCheckbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            variantsContainer.classList.remove('hidden');
            variantsContainer.classList.add('flex');
            priceInput.classList.add('hidden');
          } else {
            variantsContainer.classList.add('hidden');
            variantsContainer.classList.remove('flex');
            priceInput.classList.remove('hidden');
          }
        });
      }

      const createVariantRow = () => {
        const div = document.createElement('div');
        div.className = 'variant-row flex gap-2 items-center';
        div.innerHTML = `
          <input type="text" placeholder="Size (e.g. 60ml)" class="variant-name-input flex-1 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm focus:border-primary focus:outline-none">
          <input type="number" step="0.01" min="0" placeholder="Price" class="variant-price-input w-24 h-9 px-3 bg-surface-container-lowest border border-outline-variant rounded-md text-body-sm font-mono-sm focus:border-primary focus:outline-none">
          <button type="button" class="btn-remove-variant w-9 h-9 flex items-center justify-center text-error opacity-50 hover:opacity-100 hover:bg-error/10 rounded-md transition-all">✕</button>
        `;
        div.querySelector('.btn-remove-variant').addEventListener('click', () => div.remove());
        return div;
      };

      if (btnAddVariant && variantsList) {
        btnAddVariant.addEventListener('click', () => {
          variantsList.appendChild(createVariantRow());
        });
        
        // attach remove listener to initial default row
        const initialRemoveBtn = variantsList.querySelector('.btn-remove-variant');
        if (initialRemoveBtn) {
          initialRemoveBtn.addEventListener('click', (e) => e.target.closest('.variant-row').remove());
        }
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
        const catSelect = row.querySelector('.menu-category-select');
        const catCustom = row.querySelector('.menu-category-custom-input');
        const priceInput = row.querySelector('.menu-price-input');

        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) continue; // Skip empty rows

        const hasVariants = row.querySelector('.menu-has-variants-checkbox')?.checked;
        let price = 0;
        let variants = [];

        if (hasVariants) {
          const variantRows = Array.from(row.querySelectorAll('.variants-list .variant-row'));
          for (const vRow of variantRows) {
            const vName = vRow.querySelector('.variant-name-input').value.trim();
            const vPrice = parseFloat(vRow.querySelector('.variant-price-input').value);
            if (vName && !isNaN(vPrice) && vPrice >= 0) {
              variants.push({ name: vName, price: vPrice });
            }
          }
          if (variants.length === 0) {
            showToast(`Please add at least one valid variant for: ${name}`, 'error');
            hasError = true;
            continue;
          }
          price = Math.min(...variants.map(v => v.price)); // base price is the cheapest variant
        } else {
          price = priceInput ? parseFloat(priceInput.value) : 0;
          if (isNaN(price) || price < 0) {
            showToast(`Invalid price for item: ${name}`, 'error');
            hasError = true;
            continue;
          }
        }

        const description = descInput ? descInput.value.trim() : '';
        let category = 'General';
        if (catSelect) {
          category = catSelect.value === '__custom__' 
            ? (catCustom && catCustom.value.trim() ? catCustom.value.trim() : 'General')
            : catSelect.value;
        }
        let image_url = null;

        try {
          const originalItem = editingItemId ? getState().menuItems.find(i => i.id === editingItemId) : null;
          
          if (imageInput && imageInput.files.length > 0) {
            const uploadedUrl = await uploadMenuImage(imageInput.files[0], category, name);
            if (uploadedUrl) image_url = uploadedUrl;
          } else if (originalItem) {
            image_url = originalItem.image_url;
          }

          const newItem = {
            id: editingItemId || uuidv4(),
            name,
            description,
            image_url,
            price,
            category,
            variants: variants.length > 0 ? variants : [],
            is_active: true,
            created_at: originalItem ? originalItem.created_at : new Date().toISOString()
          };

          await addMenuItem(newItem);
          await queueSync('menu_items', editingItemId ? 'UPDATE' : 'INSERT', newItem);
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

  // Assign the internal function to the module-scoped variable for external access
  renderFormBatchFn = renderFormBatch;
}

// --- Variant Selection Modal Logic ---
const showVariantSelectionModal = (item) => {
  const modal = document.getElementById('variant-selection-modal');
  const title = document.getElementById('variant-modal-title');
  const optionsContainer = document.getElementById('variant-modal-options');
  const btnClose = document.getElementById('btn-close-variant-modal');
  const overlay = document.getElementById('variant-selection-overlay');

  if (!modal || !item.variants) return;

  title.innerText = `Select Option for ${item.name}`;
  
  optionsContainer.innerHTML = item.variants.map((v, idx) => `
    <button type="button" class="variant-option-btn w-full p-4 bg-surface-container-lowest hover:bg-surface-container hover:border-primary border border-outline-variant rounded-xl flex justify-between items-center transition-all text-left group" data-variant-index="${idx}">
      <span class="font-headline-sm text-on-surface group-hover:text-primary transition-colors">${v.name}</span>
      <span class="font-mono-md text-primary font-bold">${formatPrice(v.price)}</span>
    </button>
  `).join('');

  const closeModal = () => {
    modal.classList.add('hidden');
  };

  btnClose.onclick = closeModal;
  overlay.onclick = closeModal;

  optionsContainer.querySelectorAll('.variant-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-variant-index'));
      const selectedVariant = item.variants[idx];
      
      // Create a cloned item representing this specific variant
      const variantItem = {
        ...item,
        id: item.id, // keep original menu_item_id
        name: `${item.name} (${selectedVariant.name})`,
        price: selectedVariant.price,
        is_variant: true,
        variant_name: selectedVariant.name
      };
      
      addItemToTable(variantItem);
      closeModal();
    });
  });

  modal.classList.remove('hidden');
};

/**
 * Update dynamic category datalist based on existing menu items.
 */
function updateCategoryDatalist(menuItems) {
  const datalist = document.getElementById('category-options');
  if (!datalist) return;
  const categories = new Set(menuItems.map(item => item.category).filter(Boolean));
  
  // Add some defaults if the database is completely empty
  if (categories.size === 0) {
    ['General', 'Starters', 'Mains', 'Desserts', 'Beverages'].forEach(c => categories.add(c));
  }
  
  datalist.innerHTML = Array.from(categories).sort().map(cat => `<option value="${cat}"></option>`).join('');
}

/**
 * Render Menu Grid cards.
 */
export function renderMenuPanel() {
  const grid = document.getElementById('menu-grid');
  const countSpan = document.getElementById('menu-count');
  if (!grid) return;

  // Preserve open states
  const openCategories = new Set();
  const hasRenderedBefore = grid.children.length > 0;
  if (hasRenderedBefore) {
    grid.querySelectorAll('details.category-group').forEach(details => {
      if (details.open) openCategories.add(details.dataset.category);
    });
  }

  // Get search term
  const searchInput = document.getElementById('menu-search-input');
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let menuItems = getState().menuItems.filter(item => item.is_active !== false);
  
  if (searchTerm) {
    menuItems = menuItems.filter(item => 
      item.name.toLowerCase().includes(searchTerm) || 
      (item.description && item.description.toLowerCase().includes(searchTerm))
    );
  }

  updateCategoryDatalist(menuItems);
  
  if (countSpan) countSpan.innerText = menuItems.length;

  // Group items by category
  const grouped = {};
  menuItems.forEach(item => {
    const cat = item.category || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let html = '';
  for (const cat of Object.keys(grouped).sort()) {
    const items = grouped[cat];
    const shouldOpen = searchTerm.length > 0 ? true : (!hasRenderedBefore || openCategories.has(cat));

    html += `
      <details class="category-group mb-md" data-category="${cat}" ${shouldOpen ? 'open' : ''}>
        <summary class="font-headline-md text-primary cursor-pointer mb-sm hover:text-on-surface-variant transition-colors flex items-center gap-2 select-none">
          ${cat} <span class="text-body-sm text-on-surface-variant bg-surface-variant px-2 py-0.5 rounded-full">${items.length}</span>
        </summary>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3 gap-md pl-2">
          ${items.map(item => {
            let priceDisplay = formatPrice(item.price);
            if (item.variants && item.variants.length > 0) {
              const minPrice = Math.min(...item.variants.map(v => v.price));
              const maxPrice = Math.max(...item.variants.map(v => v.price));
              priceDisplay = minPrice === maxPrice ? formatPrice(minPrice) : `From ${formatPrice(minPrice)}`;
            }

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
                    <p class="font-mono-md text-mono-md text-on-surface-variant">${priceDisplay}</p>
                  </div>
                </div>
                <div class="flex items-center gap-xs">
                  ${isMenuEditMode ? `
                  <button class="edit-menu-btn w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center text-on-surface-variant transition-transform active:scale-90 group-hover:shadow-lg" data-edit-menu-id="${item.id}" title="Edit Item">
                    <span class="material-symbols-outlined">edit</span>
                  </button>
                  ` : `
                  <button class="delete-menu-btn w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-delete-menu-id="${item.id}" title="Delete Item">
                    <span class="material-symbols-outlined text-[16px]">close</span>
                  </button>
                  <button class="add-to-order-btn w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary transition-transform active:scale-90 group-hover:shadow-lg" data-add-menu-id="${item.id}">
                    <span class="material-symbols-outlined">add</span>
                  </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </details>
    `;
  }

  grid.innerHTML = html;

  // Setup click listeners for "+" buttons
  grid.querySelectorAll('[data-add-menu-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-add-menu-id');
      const item = menuItems.find(i => i.id === id);
      if (!item) return;

      if (item.variants && item.variants.length > 0) {
        showVariantSelectionModal(item);
      } else {
        addItemToTable(item);
      }
    });
  });

  // Setup click listeners for edit buttons
  grid.querySelectorAll('[data-edit-menu-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-menu-id');
      const item = menuItems.find(i => i.id === id);
      if (!item) return;

      editingItemId = id;
      isOcrMode = false;
      ocrQueue = [];
      
      const formTitle = document.getElementById('add-menu-form-title');
      if (formTitle) formTitle.innerText = "Edit Menu Item";
      
      const btnDelete = document.getElementById('btn-delete-menu-item');
      if (btnDelete) btnDelete.classList.remove('hidden');

      if (renderFormBatchFn) renderFormBatchFn([item]);
      
      const addForm = document.getElementById('add-menu-form');
      if (addForm) {
        addForm.classList.remove('hidden');
      }
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

      const state = getState();
      const currentUser = state.currentUser;
      const waiter_id = currentUser?.user?.id || null;
      const waiter_name = currentUser?.display_name || null;

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
        waiter_id,
        waiter_name,
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
