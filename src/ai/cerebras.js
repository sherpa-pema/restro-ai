/**
 * Cerebras AI Integration — TableCraft OS (Vite Proxy to FastAPI)
 * 
 * Routes natural-language POS commands to the local FastAPI backend,
 * which securely runs the gpt-oss-120b completion model in the background.
 */

const CEREBRAS_ENDPOINT = '/ai/parse';

console.log('[Cerebras AI Proxy] Configured to route through FastAPI: /ai/parse');

/** Request timeout in milliseconds */
const TIMEOUT_MS = 12000;

/**
 * Parse a natural language command into a structured intent using the FastAPI proxy backend.
 * 
 * @param {string} command — the user's natural language input
 * @param {Array<{ name: string, price: number }>} menuItems — current menu items for context
 * @returns {Promise<object|null>} parsed intent object, or null on failure
 */
export async function parseCommandWithAI(command, menuItems = []) {
  console.log('[Cerebras AI Proxy] Dispatching request for command:', command);

  // Set up abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(CEREBRAS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command,
        menu_items: menuItems.map(item => ({
          name: item.name,
          price: item.price
        }))
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Cerebras AI Proxy] Backend returned status ${response.status}: ${response.statusText}`);
      return null;
    }

    const intent = await response.json();
    return intent;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.warn('[Cerebras AI Proxy] Request timed out after', TIMEOUT_MS, 'ms');
    } else {
      console.error('[Cerebras AI Proxy] parseCommandWithAI error:', err);
    }

    return null;
  }
}
