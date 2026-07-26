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
    <div class="mb-xl flex items-center justify-between">
      <div>
        <h2 class="font-headline-lg text-headline-lg font-bold text-primary">Staff Management</h2>
        <p class="text-on-surface-variant text-body-md mt-1">Manage employee accounts and roles.</p>
      </div>
      <button id="btn-show-add-staff" class="bg-primary hover:bg-primary/90 text-on-primary px-4 py-2 rounded-xl font-label-md text-label-md transition-colors flex items-center gap-2">
        <span class="material-symbols-outlined text-[18px]">person_add</span>
        Add Staff
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-xl">
      <!-- Left: Staff List -->
      <div class="lg:col-span-2">
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-sm p-4">
          <div id="staff-list" class="flex flex-col gap-2">
            <!-- Populated via JS -->
            <p class="text-on-surface-variant text-sm py-4 text-center">Loading staff...</p>
          </div>
        </div>
      </div>

      <!-- Right: Add Staff Form (Hidden by default on mobile) -->
      <div id="add-staff-section" class="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-sm p-lg hidden lg:block h-fit">
        <h3 class="font-headline-md text-headline-md font-bold text-primary mb-4">Add New Staff</h3>
        <form id="form-add-staff" class="flex flex-col gap-4">
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Display Name</label>
            <input type="text" id="staff-name" required class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-2 text-body-md text-on-surface focus:outline-none focus:border-primary" placeholder="e.g. Sarah">
          </div>
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Email</label>
            <input type="email" id="staff-email" required class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-2 text-body-md text-on-surface focus:outline-none focus:border-primary" placeholder="sarah@restaurant.com">
          </div>
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Temporary Password</label>
            <input type="text" id="staff-password" required minlength="6" class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-2 text-body-md text-on-surface focus:outline-none focus:border-primary" placeholder="Minimum 6 chars">
          </div>
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Role</label>
            <select id="staff-role" class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-2 text-body-md text-on-surface focus:outline-none focus:border-primary">
              <option value="waiter">Waiter</option>
              <option value="kitchen">Kitchen</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" id="btn-submit-staff" class="w-full bg-primary hover:bg-primary/90 text-on-primary py-3 rounded-xl font-label-md text-label-md transition-colors mt-2 font-bold">
            Create Account
          </button>
        </form>
      </div>
    </div>
  `;

  // Listeners
  document.getElementById('btn-show-add-staff').addEventListener('click', () => {
    document.getElementById('add-staff-section').classList.toggle('hidden');
  });

  const formAddStaff = document.getElementById('form-add-staff');
  const btnSubmit = document.getElementById('btn-submit-staff');

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
      formAddStaff.reset();
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

    container.innerHTML = profiles.map(p => `
      <div class="flex items-center justify-between p-3 rounded-xl border border-outline-variant bg-surface ${!p.is_active ? 'opacity-60' : ''}">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary font-bold">
            ${p.display_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p class="font-bold text-on-surface flex items-center gap-2">
              ${p.display_name} 
              <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-surface-variant text-on-surface-variant">${p.role}</span>
              ${!p.is_active ? '<span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-error/10 text-error">Deactivated</span>' : ''}
            </p>
            <p class="text-xs text-on-surface-variant">${p.email}</p>
          </div>
        </div>
        <div>
          ${p.role !== 'admin' ? `
            <button class="btn-toggle-staff px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${p.is_active ? 'bg-error/10 text-error hover:bg-error/20' : 'bg-primary text-on-primary hover:bg-primary/90'}" data-id="${p.id}" data-active="${p.is_active}">
              ${p.is_active ? 'Deactivate' : 'Reactivate'}
            </button>
          ` : '<span class="text-xs text-on-surface-variant italic">Admin</span>'}
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
