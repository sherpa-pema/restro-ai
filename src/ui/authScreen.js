import { loginUser, registerBusiness } from '../db/auth.js';
import { getState, on } from '../state.js';
import { showToast } from './toasts.js';

let currentMode = 'login'; // 'login' or 'register'

export function initAuthScreen() {
  const authPage = document.getElementById('page-auth');
  const appLayout = document.getElementById('app-layout');
  
  if (!authPage || !appLayout) return;

  // Render HTML once
  authPage.innerHTML = `
    <div class="w-full max-w-[420px] bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-2xl p-lg flex flex-col">
      <div class="flex items-center gap-3 mb-6 mx-auto">
        <div class="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-on-primary font-bold text-lg">TC</div>
        <div>
          <p class="font-headline-lg text-headline-lg font-extrabold text-primary leading-tight">TableCraft OS</p>
          <p class="text-xs text-on-surface-variant font-medium uppercase tracking-widest">Login</p>
        </div>
      </div>

      <!-- Mode Switcher -->
      <div class="flex bg-surface-container rounded-xl p-1 mb-xl">
        <button id="tab-login" class="flex-1 py-2 text-label-md font-label-md rounded-lg bg-surface-container-lowest text-primary shadow-sm font-bold transition-all">Login</button>
        <button id="tab-register" class="flex-1 py-2 text-label-md font-label-md rounded-lg text-on-surface-variant hover:text-primary transition-all">Register Business</button>
      </div>

      <!-- Forms -->
      <form id="auth-form" class="flex flex-col gap-md">
        
        <div id="register-fields" class="hidden flex-col gap-md">
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Business Name</label>
            <input type="text" id="auth-business-name" class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-3 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors" placeholder="e.g. The Rustic Spoon">
          </div>
          <div>
            <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Admin Name</label>
            <input type="text" id="auth-admin-name" class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-3 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors" placeholder="e.g. John Doe">
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Email</label>
          <input type="email" id="auth-email" required class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-3 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors" placeholder="admin@example.com">
        </div>
        
        <div>
          <label class="block text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-1">Password</label>
          <input type="password" id="auth-password" required minlength="6" class="w-full bg-surface-container border border-outline-variant rounded-xl px-4 py-3 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors" placeholder="••••••••">
        </div>

        <button type="submit" id="btn-auth-submit" class="w-full bg-primary hover:bg-primary/90 text-on-primary py-3 rounded-xl font-label-md text-label-md transition-colors mt-2 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-[18px]" id="auth-submit-icon">login</span>
          <span id="auth-submit-text">Sign In</span>
        </button>
      </form>
    </div>
  `;

  // Attach event listeners
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const registerFields = document.getElementById('register-fields');
  const authForm = document.getElementById('auth-form');
  const submitText = document.getElementById('auth-submit-text');
  const submitIcon = document.getElementById('auth-submit-icon');
  
  const bNameInput = document.getElementById('auth-business-name');
  const aNameInput = document.getElementById('auth-admin-name');
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');
  const btnSubmit = document.getElementById('btn-auth-submit');

  function setMode(mode) {
    currentMode = mode;
    if (mode === 'login') {
      tabLogin.className = 'flex-1 py-2 text-label-md font-label-md rounded-lg bg-surface-container-lowest text-primary shadow-sm font-bold transition-all';
      tabRegister.className = 'flex-1 py-2 text-label-md font-label-md rounded-lg text-on-surface-variant hover:text-primary transition-all';
      registerFields.classList.add('hidden');
      registerFields.classList.remove('flex');
      bNameInput.removeAttribute('required');
      aNameInput.removeAttribute('required');
      submitText.innerText = 'Sign In';
      submitIcon.innerText = 'login';
    } else {
      tabRegister.className = 'flex-1 py-2 text-label-md font-label-md rounded-lg bg-surface-container-lowest text-primary shadow-sm font-bold transition-all';
      tabLogin.className = 'flex-1 py-2 text-label-md font-label-md rounded-lg text-on-surface-variant hover:text-primary transition-all';
      registerFields.classList.remove('hidden');
      registerFields.classList.add('flex');
      bNameInput.setAttribute('required', 'true');
      aNameInput.setAttribute('required', 'true');
      submitText.innerText = 'Register Business';
      submitIcon.innerText = 'storefront';
    }
  }

  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passInput.value;
    
    // UI Loading state
    btnSubmit.disabled = true;
    btnSubmit.classList.add('opacity-70');
    submitText.innerText = 'Please wait...';

    if (currentMode === 'login') {
      const res = await loginUser(email, password);
      if (res.success) {
        showToast('Successfully logged in!', 'success');
        // State listeners will handle hiding the page
      } else {
        showToast(res.error || 'Login failed', 'error');
      }
    } else {
      const bName = bNameInput.value.trim();
      const aName = aNameInput.value.trim();
      const res = await registerBusiness(email, password, bName, aName);
      if (res.success) {
        showToast('Business registered successfully!', 'success');
      } else {
        showToast(res.error || 'Registration failed', 'error');
      }
    }

    // Reset UI loading state
    btnSubmit.disabled = false;
    btnSubmit.classList.remove('opacity-70');
    submitText.innerText = currentMode === 'login' ? 'Sign In' : 'Register Business';
  });

  // Listen to authState to toggle visibility
  on('authState', (status) => {
    if (status === 'authenticated') {
      authPage.classList.add('hidden');
      appLayout.classList.remove('hidden');
    } else if (status === 'unauthenticated') {
      authPage.classList.remove('hidden');
      appLayout.classList.add('hidden');
    } else {
      // loading
      authPage.classList.add('hidden');
      appLayout.classList.add('hidden');
    }
  });

  // Initial check
  const currentStatus = getState().authState;
  if (currentStatus === 'authenticated') {
    authPage.classList.add('hidden');
    appLayout.classList.remove('hidden');
  } else if (currentStatus === 'unauthenticated') {
    authPage.classList.remove('hidden');
    appLayout.classList.add('hidden');
  }
}
