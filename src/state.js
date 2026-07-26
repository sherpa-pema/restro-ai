/**
 * ============================================================
 * TableCraft OS — Central State Store
 * src/state.js
 *
 * Reactive pub/sub state management.
 * This is the single source of truth for all UI rendering.
 * Other modules import {getState, setState, on} to read,
 * write, and react to state changes.
 * ============================================================
 */

// ------------------------------------
// State Shape
// ------------------------------------
const state = {
  /** @type {Array<{id: string, name: string, seats: number, status: string, category: string, current_order_id: string|null, updated_at: string}>} */
  tables: [],

  /** @type {Array<{id: string, name: string, emoji: string, price: number, category: string, is_active: boolean, created_at: string}>} */
  menuItems: [],

  /** @type {string|null} UUID of the currently selected table */
  selectedTableId: null,

  /** @type {{id: string, table_id: string, status: string, subtotal: number, tax: number, service_charge: number, discount: number, total: number, created_at: string}|null} */
  currentOrder: null,

  /** @type {Array<{id: string, order_id: string, menu_item_id: string, name: string, price: number, quantity: number}>} */
  currentOrderItems: [],

  /** @type {Array<{id: string, order_id: string, table_name: string, amount: number, payment_method: string, currency: string, paid_at: string}>} */
  transactions: [],

  /** @type {'synced'|'pending'|'offline'} Current sync status with backend */
  syncStatus: 'offline',

  /** @type {'NPR'|'INR'|'USD'} Active currency */
  currency: 'NPR',

  /** @type {'overview'|'tables'} Currently active page/tab */
  activePage: 'tables',

  /** @type {string} Active floor plan table category filter */
  activeTableCategory: 'All',

  /** @type {Array<object>} All orders loaded from IndexedDB/Supabase */
  orders: [],

  /** @type {Array<object>} All inventory ingredients */
  inventory: [],

  /** @type {Array<object>} All waste logs registered today */
  waste: [],

  /** @type {Array<object>} All supplier profiles */
  suppliers: [],

  /** @type {Array<object>} All recipes mapping menu items to ingredients */
  recipes: [],

  /** @type {{vat: number, service: number}} Configurable tax rates (percentages) */
  taxConfig: { vat: 10, service: 5 },

  /** @type {object|null} Restaurant profile information */
  restaurant: null,

  /** @type {'loading'|'unauthenticated'|'authenticated'} Auth state */
  authState: 'loading',

  /** @type {object|null} Currently logged in user session */
  currentUser: null,

  /** @type {'admin'|'manager'|'waiter'|'kitchen'|'cashier'|null} Role of the logged in user */
  userRole: null,
};

// ------------------------------------
// Currency Helpers
// ------------------------------------
const CURRENCY_SYMBOLS = {
  NPR: '₨',
  INR: '₹',
  USD: '$',
};

// ------------------------------------
// Event Bus (Pub/Sub)
// ------------------------------------

/** @type {Map<string, Set<Function>>} Listeners keyed by state property name */
const listeners = new Map();

/**
 * Returns the current state object (read-only by convention).
 * @returns {typeof state}
 */
export function getState() {
  return state;
}

/**
 * Updates a single state property and notifies all subscribers.
 * @param {string} key  — property name in state
 * @param {*}      value — new value
 */
export function setState(key, value) {
  state[key] = value;
  emit(key);
}

/**
 * Subscribes to changes on a specific state key.
 * Returns an unsubscribe function.
 * @param {string}   key      — state property to watch
 * @param {Function} callback — called with (newValue) on change
 * @returns {Function} unsubscribe
 */
export function on(key, callback) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key).add(callback);

  // Return unsubscribe function
  return () => listeners.get(key).delete(callback);
}

/**
 * Emits change notifications for a given state key.
 * @param {string} key — state property that changed
 */
export function emit(key) {
  if (listeners.has(key)) {
    listeners.get(key).forEach((cb) => cb(state[key]));
  }
}

/**
 * Returns the symbol for the currently active currency.
 * @returns {string}
 */
export function getCurrencySymbol() {
  return CURRENCY_SYMBOLS[state.currency] || '$';
}

/**
 * Formats a numeric amount with the active currency symbol.
 * e.g. "₨1250.00"
 * @param {number|string} amount
 * @returns {string}
 */
export function formatPrice(amount) {
  const sym = getCurrencySymbol();
  return `${sym}${Number(amount).toFixed(2)}`;
}

/**
 * Returns a local date string in YYYY-MM-DD format for a given date or ISO string.
 * @param {Date|string} date
 * @returns {string} YYYY-MM-DD
 */
export function getLocalDateString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
