// Toast Notification System for TableCraft OS

/**
 * Display a toast notification on the screen.
 * @param {string} message - The message to show.
 * @param {'success'|'error'|'info'} type - The type of notification.
 */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Enforce max 3 toasts limit by removing the oldest first
  while (container.children.length >= 3) {
    container.removeChild(container.firstChild);
  }

  // Create toast wrapper
  const toast = document.createElement('div');
  
  // Set styling classes based on type
  let bgClass = 'bg-primary text-on-primary';
  let icon = 'check_circle';

  if (type === 'error') {
    bgClass = 'bg-error text-on-error';
    icon = 'error';
  } else if (type === 'info') {
    bgClass = 'bg-surface-container-high text-on-surface border border-outline-variant';
    icon = 'info';
  }

  toast.className = `${bgClass} flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg toast-enter font-body-md text-body-md transition-all duration-300 z-50`;
  
  toast.innerHTML = `
    <span class="material-symbols-outlined text-[20px]">${icon}</span>
    <span class="flex-1">${message}</span>
    <button class="material-symbols-outlined text-[16px] opacity-70 hover:opacity-100 transition-opacity ml-2" onclick="this.parentElement.remove()">close</button>
  `;

  // Append to container
  container.appendChild(toast);

  // Auto remove after 3 seconds with exit animation
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.remove('toast-enter');
      toast.classList.add('toast-exit');
      
      // Wait for exit animation to complete before removing from DOM
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 300);
    }
  }, 3000);
}
