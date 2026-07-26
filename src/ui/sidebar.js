// Sidebar Navigation and Sync Status Module for TableCraft OS

import { getState, setState, on } from '../state.js';
import { showToast } from './toasts.js';
import { logoutUser } from '../db/auth.js';

const ROLE_PAGES = {
  admin: ['overview', 'tables', 'kitchen', 'inventory', 'staff'],
  manager: ['overview', 'tables', 'kitchen', 'inventory', 'staff'],
  waiter: ['tables', 'inventory'],
  kitchen: ['kitchen'],
  cashier: ['tables', 'inventory']
};

let listenersAttached = false;

/**
 * Initialize Sidebar and Mobile navigation controls.
 */
export function initSidebar() {
  const sidebarNav = document.getElementById('sidebar-nav');
  const mobileTabs = document.getElementById('mobile-tabs');
  const currencySelector = document.getElementById('currency-selector');
  const mobileCurrencySelector = document.getElementById('mobile-currency-selector');

  const role = getState().userRole;
  const allowedPages = role ? ROLE_PAGES[role] : [];

  const allNavItems = [
    { id: 'overview', name: 'Overview', icon: 'dashboard' },
    { id: 'tables', name: 'Tables', icon: 'grid_view' },
    { id: 'kitchen', name: 'Kitchen', icon: 'restaurant' },
    { id: 'inventory', name: 'Inventory', icon: 'inventory_2' },
    { id: 'staff', name: 'Staff', icon: 'groups' }
  ];

  const navItems = allNavItems.filter(item => allowedPages.includes(item.id));

  // Render desktop sidebar navigation
  if (sidebarNav) {
    sidebarNav.innerHTML = navItems.map(item => {
      const isActive = getState().activePage === item.id;
      const activeClass = isActive 
        ? 'bg-primary text-on-primary font-bold' 
        : 'text-on-surface-variant hover:bg-surface-container';
      return `
        <a id="nav-${item.id}" href="#" class="nav-item ${activeClass} rounded-xl px-4 py-3 flex items-center gap-3 transition-all active:opacity-80 active:scale-[0.99] font-label-md text-label-md" data-page="${item.id}">
          <span class="material-symbols-outlined">${item.icon}</span>
          <span>${item.name}</span>
        </a>
      `;
    }).join('');

    // Setup desktop nav click listeners
    sidebarNav.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = el.getAttribute('data-page');
        const item = navItems.find(n => n.id === pageId);
        
        if (item.isPlaceholder) {
          showToast(`${item.name} feature is coming soon!`, 'info');
          return;
        }

        navigateToPage(pageId);
      });
    });
  }

  // Setup mobile tab selectors
  if (mobileTabs) {
    mobileTabs.querySelectorAll('button').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      const requiresPage = tab === 'menu' || tab === 'billing' ? 'tables' : tab;
      
      if (!allowedPages.includes(requiresPage)) {
        btn.classList.add('hidden');
      } else {
        btn.classList.remove('hidden');
      }

      if (!listenersAttached) {
        btn.addEventListener('click', () => {
          // Highlight active tab visually
          mobileTabs.querySelectorAll('button').forEach(b => {
            if (!b.classList.contains('hidden')) {
              b.className = 'flex-1 flex flex-col items-center gap-1 py-2 text-on-surface-variant';
            }
          });
          btn.className = 'flex-1 flex flex-col items-center gap-1 py-2 text-primary font-bold';

        if (tab === 'overview') {
          navigateToPage('overview');
        } else if (tab === 'tables') {
          navigateToPage('tables');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (tab === 'menu') {
          navigateToPage('tables');
          const menuSection = document.getElementById('menu-section');
          if (menuSection) {
            menuSection.scrollIntoView({ behavior: 'smooth' });
          }
        } else if (tab === 'billing') {
          navigateToPage('tables');
          const billingSection = document.getElementById('billing-section');
          if (billingSection) {
            billingSection.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    }
  });
}

  if (listenersAttached) return; // Prevent duplicate listeners below
  listenersAttached = true;

  // Setup logout buttons
  const btnLogoutDesktop = document.getElementById('btn-logout-desktop');
  if (btnLogoutDesktop) {
    btnLogoutDesktop.addEventListener('click', async () => {
      await logoutUser();
    });
  }

  const btnLogoutMobile = document.getElementById('btn-logout-mobile');
  if (btnLogoutMobile) {
    btnLogoutMobile.addEventListener('click', async () => {
      await logoutUser();
    });
  }

  // Hook currency selectors in sync
  if (currencySelector) {
    currencySelector.value = getState().currency;
    currencySelector.addEventListener('change', (e) => {
      const val = e.target.value;
      setState('currency', val);
      if (mobileCurrencySelector) mobileCurrencySelector.value = val === 'USD' ? 'USD' : (val === 'INR' ? 'INR' : 'NPR');
    });
  }

  if (mobileCurrencySelector) {
    mobileCurrencySelector.value = getState().currency;
    mobileCurrencySelector.addEventListener('change', (e) => {
      const val = e.target.value;
      setState('currency', val);
      if (currencySelector) currencySelector.value = val;
    });
  }

  // Listen to activePage changes from other states (e.g. AI engine triggers)
  on('activePage', (page) => {
    updateActiveNavItem(page);
  });

  // Listen to userRole changes to re-render nav and route
  on('userRole', (newRole) => {
    if (newRole) {
      // listenersAttached is intentionally not reset here to avoid an infinite loop
      // where initSidebar() attaches duplicate listeners on state updates.
      initSidebar();
      if (newRole === 'admin' || newRole === 'manager') navigateToPage('overview');
      else if (newRole === 'waiter' || newRole === 'cashier') navigateToPage('tables');
      else if (newRole === 'kitchen') navigateToPage('kitchen');
    }
  });

  // Sync Status listener
  on('syncStatus', (status) => {
    updateSyncStatus(status);
  });

  // Initial Sync display update
  updateSyncStatus(getState().syncStatus);
}

/**
 * Handle page switching logic.
 * @param {'overview'|'tables'|'kitchen'|'inventory'|'staff'} pageId 
 */
function navigateToPage(pageId) {
  const role = getState().userRole;
  const allowedPages = role ? ROLE_PAGES[role] : [];
  
  if (role && !allowedPages.includes(pageId)) {
    showToast(`Access denied. Your role cannot access this page.`, 'error');
    return;
  }

  setState('activePage', pageId);
  
  const pages = {
    overview: document.getElementById('page-overview'),
    tables: document.getElementById('page-tables'),
    kitchen: document.getElementById('page-kitchen'),
    inventory: document.getElementById('page-inventory'),
    staff: document.getElementById('page-staff')
  };

  Object.keys(pages).forEach(key => {
    if (pages[key]) {
      if (key === pageId) {
        pages[key].classList.remove('hidden');
      } else {
        pages[key].classList.add('hidden');
      }
    }
  });

  updateActiveNavItem(pageId);
}

/**
 * Visually updates the active link inside the desktop navigation sidebar.
 * @param {string} pageId 
 */
function updateActiveNavItem(pageId) {
  const sidebarNav = document.getElementById('sidebar-nav');
  if (!sidebarNav) return;

  sidebarNav.querySelectorAll('.nav-item').forEach(el => {
    const dataPage = el.getAttribute('data-page');
    if (dataPage === pageId) {
      el.className = 'nav-item bg-primary text-on-primary font-bold rounded-xl px-4 py-3 flex items-center gap-3 transition-all active:opacity-80 active:scale-[0.99] font-label-md text-label-md';
    } else {
      el.className = 'nav-item text-on-surface-variant hover:bg-surface-container rounded-xl px-4 py-3 flex items-center gap-3 transition-all active:opacity-80 active:scale-[0.99] font-label-md text-label-md';
    }
  });
}

/**
 * Updates UI markers for sync status (offline/pending/synced).
 * @param {'synced'|'pending'|'offline'} status 
 */
export function updateSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const mobileDot = document.getElementById('mobile-sync-dot');

  let colorClass = 'bg-outline'; // offline
  let statusText = 'Offline';

  if (status === 'synced') {
    colorClass = 'bg-secondary';
    statusText = 'Synced';
  } else if (status === 'pending' || status === 'syncing') {
    colorClass = 'bg-yellow-500 animate-pulse';
    statusText = 'Syncing...';
  }

  // Update desktop status indicators
  if (dot) {
    dot.className = `w-2 h-2 rounded-full ${colorClass}`;
  }
  if (label) {
    label.innerText = statusText;
  }

  // Update mobile status indicators
  if (mobileDot) {
    mobileDot.className = `w-1.5 h-1.5 rounded-full ${colorClass}`;
  }
}
