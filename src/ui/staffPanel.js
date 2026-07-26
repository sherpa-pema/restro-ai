import { getAllStaffProfiles } from '../db/indexedDB.js';
import { createStaffAccount, toggleStaffStatus } from '../db/auth.js';
import { showToast } from './toasts.js';
import { on, getState } from '../state.js';

let isInitialized = false;

export function initStaffPanel() {
  if (isInitialized) return;
  isInitialized = true;

  const staffPage = document.getElementById('page-staff');
  if (!staffPage) return;

  staffPage.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-md border-b border-outline-variant pb-md mb-lg">
      <div>
        <h2 class="font-headline-xl text-headline-xl text-primary tracking-tight">Staff Management</h2>
        <p class="text-xs text-on-surface-variant mt-1">Manage employee accounts and system access roles.</p>
      </div>
      <button id="btn-show-add-staff" class="bg-primary hover:bg-primary/90 text-on-primary px-4 py-2 rounded-xl font-label-md text-label-md transition-colors flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">person_add</span>
        Add Staff
      </button>
    </div>

    <!-- Staff List Grid -->
    <div id="staff-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
      <!-- Populated via JS -->
      <p class="text-on-surface-variant text-sm py-4 col-span-full text-center">Loading staff...</p>
    </div>
  `;

  // Listeners
  const modal = document.getElementById('add-staff-modal');
  const overlay = document.getElementById('add-staff-overlay');
  const btnCancel = document.getElementById('btn-cancel-staff');
  const formAddStaff = document.getElementById('form-add-staff');
  const btnSubmit = document.getElementById('btn-submit-staff');

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
    if (formAddStaff) formAddStaff.reset();
  };

  document.getElementById('btn-show-add-staff').addEventListener('click', () => {
    if (modal) modal.classList.remove('hidden');
  });

  if (overlay) overlay.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  formAddStaff.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('staff-name').value.trim();
    const email = document.getElementById('staff-email').value.trim();
    const password = document.getElementById('staff-password').value;
    const role = document.getElementById('staff-role').value;

    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Creating...';
    btnSubmit.classList.add('opacity-70');

    const res = await createStaffAccount(email, password, name, role);

    if (res.success) {
      showToast('Staff account created successfully!', 'success');
      closeModal();
      renderStaffList();
    } else {
      showToast(res.error || 'Failed to create account.', 'error');
    }

    btnSubmit.disabled = false;
    btnSubmit.innerText = 'Create Account';
    btnSubmit.classList.remove('opacity-70');
  });

  // Re-render when nav changes to staff page
  on('activePage', (page) => {
    if (page === 'staff' && getState().userRole === 'admin') {
      renderStaffList();
    }
  });

  // Listen to remote changes
  on('staffProfileSync', () => {
    if (getState().activePage === 'staff') {
      renderStaffList();
    }
  });
}

export async function renderStaffList() {
  const container = document.getElementById('staff-list');
  if (!container) return;

  try {
    const profiles = await getAllStaffProfiles();
    
    if (profiles.length === 0) {
      container.innerHTML = '<p class="text-on-surface-variant text-sm py-4 text-center">No staff found.</p>';
      return;
    }

    // Sort: admins first, then active, then name
    profiles.sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1;
      if (b.role === 'admin' && a.role !== 'admin') return 1;
      if (a.is_active && !b.is_active) return -1;
      if (!a.is_active && b.is_active) return 1;
      return a.display_name.localeCompare(b.display_name);
    });

    const getRoleColor = (role) => {
      switch (role) {
        case 'admin': return 'bg-primary/10 text-primary';
        case 'manager': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
        case 'kitchen': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
        case 'waiter': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
        case 'cashier': return 'bg-secondary/15 text-secondary';
        default: return 'bg-surface-variant text-on-surface-variant';
      }
    };

    container.innerHTML = profiles.map(p => `
      <div class="flex flex-col gap-4 p-lg rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm ${!p.is_active ? 'opacity-60' : ''}">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
            ${p.display_name.charAt(0).toUpperCase()}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between w-full">
              <p class="font-bold text-on-surface text-body-lg truncate">${p.display_name}</p>
              ${!p.is_active ? '<span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-error/10 text-error shrink-0 ml-2">Deactivated</span>' : ''}
            </div>
            <p class="text-xs text-on-surface-variant truncate">${p.email}</p>
          </div>
        </div>
        <div class="flex items-center justify-between border-t border-outline-variant pt-4">
          <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${getRoleColor(p.role)}">${p.role}</span>
          ${p.role !== 'admin' ? `
            <button class="btn-toggle-staff px-4 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${p.is_active ? 'bg-error/10 text-error hover:bg-error/20' : 'bg-primary text-on-primary hover:bg-primary/90'}" data-id="${p.id}" data-active="${p.is_active}">
              ${p.is_active ? 'Deactivate' : 'Reactivate'}
            </button>
          ` : '<span class="text-[11px] text-on-surface-variant italic font-bold">Admin Level</span>'}
        </div>
      </div>
    `).join('');

    // Attach toggle listeners
    container.querySelectorAll('.btn-toggle-staff').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const currentlyActive = btn.getAttribute('data-active') === 'true';
        
        btn.disabled = true;
        btn.innerText = '...';

        const res = await toggleStaffStatus(id, !currentlyActive);
        if (res.success) {
          showToast(`Staff member ${currentlyActive ? 'deactivated' : 'reactivated'}.`, 'success');
          renderStaffList();
        } else {
          showToast(res.error || 'Failed to change status.', 'error');
          btn.disabled = false;
        }
      });
    });

  } catch (error) {
    console.error('[StaffPanel] Render error:', error);
    container.innerHTML = '<p class="text-error text-sm py-4 text-center">Failed to load staff profiles.</p>';
  }
}
