// Sidebar Navigation and Sync Status Module for TableCraft OS

import { getState, setState, on } from '../state.js';
import { showToast } from './toasts.js';
import { logoutUser, updateDisplayName, changePassword } from '../db/auth.js';

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

  function updateProfileUI() {
    const user = getState().currentUser;
    if (user && user.display_name) {
      const initial = user.display_name.charAt(0).toUpperCase();
      
      const desktopUserName = document.getElementById('desktop-user-name');
      if (desktopUserName) desktopUserName.textContent = user.display_name;
      
      const desktopUserAvatar = document.getElementById('desktop-user-avatar');
      if (desktopUserAvatar) desktopUserAvatar.textContent = initial;
      
      const mobileProfileBtn = document.getElementById('btn-profile-settings-mobile');
      if (mobileProfileBtn) mobileProfileBtn.textContent = initial;
    }
  }
  updateProfileUI();

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

  // Profile Settings Modal Logic
  const modalProfile = document.getElementById('modal-profile-settings');
  const btnCloseProfile = document.getElementById('btn-close-profile');
  const backdropProfile = document.getElementById('profile-modal-backdrop');
  
  const btnProfileDesktop = document.getElementById('btn-profile-settings-desktop');
  const btnProfileMobile = document.getElementById('btn-profile-settings-mobile');

  function openProfileModal() {
    if (!modalProfile) return;
    const user = getState().currentUser;
    if (user) {
      document.getElementById('profile-role-badge').textContent = user.role || 'Unknown';
      document.getElementById('profile-email-text').textContent = user.email || (user.user && user.user.email) || '';
      document.getElementById('profile-name-input').value = user.display_name || '';
      document.getElementById('profile-new-password').value = '';
      document.getElementById('profile-confirm-password').value = '';
    }
    modalProfile.classList.remove('hidden');
  }

  function closeProfileModal() {
    if (modalProfile) modalProfile.classList.add('hidden');
  }

  if (btnProfileDesktop) btnProfileDesktop.addEventListener('click', openProfileModal);
  if (btnProfileMobile) btnProfileMobile.addEventListener('click', openProfileModal);
  if (btnCloseProfile) btnCloseProfile.addEventListener('click', closeProfileModal);
  if (backdropProfile) backdropProfile.addEventListener('click', closeProfileModal);

  // Profile Edit Name Form
  const formEditProfile = document.getElementById('form-edit-profile');
  if (formEditProfile) {
    formEditProfile.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = document.getElementById('profile-name-input').value.trim();
      if (!newName) return;
      
      const btn = document.getElementById('btn-save-profile-name');
      const originalText = btn.textContent;
      btn.textContent = 'Saving...';
      btn.disabled = true;

      const res = await updateDisplayName(newName);
      if (res.success) {
        showToast('Profile name updated successfully', 'success');
        updateProfileUI();
      } else {
        showToast('Failed to update profile: ' + res.error, 'error');
      }

      btn.textContent = originalText;
      btn.disabled = false;
    });
  }

  // Change Password Form
  const formChangePassword = document.getElementById('form-change-password');
  if (formChangePassword) {
    formChangePassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = document.getElementById('profile-new-password').value;
      const p2 = document.getElementById('profile-confirm-password').value;

      if (p1 !== p2) {
        showToast('Passwords do not match', 'error');
        return;
      }
      if (p1.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
      }

      const btn = document.getElementById('btn-update-password');
      const originalText = btn.innerHTML;
      btn.innerHTML = 'Updating...';
      btn.disabled = true;

      const res = await changePassword(p1);
      if (res.success) {
        showToast('Password updated successfully', 'success');
        closeProfileModal();
      } else {
        showToast('Failed to update password: ' + res.error, 'error');
      }

      btn.innerHTML = originalText;
      btn.disabled = false;
    });
  }

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
