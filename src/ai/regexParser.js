/**
 * Regex Command Parser — TableCraft OS
 * 
 * Local fallback parser that handles natural language commands
 * when the Cerebras AI is unavailable or times out.
 * Uses pattern matching with fuzzy menu item lookup.
 */

/**
 * Parse a command string into a structured intent using regex patterns.
 * 
 * @param {string} command — the user's natural language input
 * @param {Array<{ name: string, price: number }>} menuItems — current menu items for matching
 * @returns {object|null} parsed intent object, or null if no pattern matches
 */
export function parseCommandWithRegex(command, menuItems = []) {
  if (!command || typeof command !== 'string') return null;

  const input = command.trim();

  // Try each parser in priority order
  return (
    tryAddItem(input, menuItems) ||
    tryPayTable(input) ||
    tryClearTable(input) ||
    tryApplyDiscount(input) ||
    tryRemoveItem(input, menuItems) ||
    tryAddMenuItem(input) ||
    tryDeleteMenuItem(input) ||
    tryGetStatus(input) ||
    null
  );
}

// ─────────────────────────────────────────────
// Pattern Matchers
// ─────────────────────────────────────────────

/**
 * ADD_ITEM patterns:
 * - "add 2 burger to table 3"
 * - "add burger to table 3"
 * - "3 pizza to table 1"
 * - "2x coffee table 5"
 */
function tryAddItem(input, menuItems) {
  const patterns = [
    /add\s+(\d+)?\s*(.+?)\s+to\s+table\s+(\d+)/i,
    /^(\d+)\s+(.+?)\s+to\s+table\s+(\d+)/i,
    /^(\d+)x\s*(.+?)\s+table\s+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      const qty = match[1] ? parseInt(match[1], 10) : 1;
      const rawName = match[2].trim();
      const tableNum = parseInt(match[3], 10);
      const matchedItem = findMenuItem(rawName, menuItems);

      return {
        action: 'ADD_ITEM',
        table: tableNum,
        items: [{
          name: matchedItem ? matchedItem.name : rawName,
          qty,
        }],
      };
    }
  }

  return null;
}

/**
 * PAY_TABLE patterns:
 * - "pay table 3"
 * - "close table 5"
 * - "bill table 1"
 */
function tryPayTable(input) {
  const match = input.match(/(?:pay|close|bill)\s+table\s+(\d+)/i);
  if (match) {
    return {
      action: 'PAY_TABLE',
      table: parseInt(match[1], 10),
    };
  }
  return null;
}

/**
 * CLEAR_TABLE patterns:
 * - "clear table 3"
 * - "reset table 2"
 */
function tryClearTable(input) {
  const match = input.match(/(?:clear|reset)\s+table\s+(\d+)/i);
  if (match) {
    return {
      action: 'CLEAR_TABLE',
      table: parseInt(match[1], 10),
    };
  }
  return null;
}

/**
 * APPLY_DISCOUNT patterns:
 * - "10% discount on table 3"
 * - "discount 15% to table 2"
 */
function tryApplyDiscount(input) {
  const patterns = [
    /(\d+)%\s*discount\s*(?:on\s+|to\s+)?table\s+(\d+)/i,
    /discount\s+(\d+)%\s*(?:on\s+|to\s+)?table\s+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return {
        action: 'APPLY_DISCOUNT',
        table: parseInt(match[2], 10),
        discount_percent: parseInt(match[1], 10),
      };
    }
  }

  return null;
}

/**
 * REMOVE_ITEM patterns:
 * - "remove burger from table 3"
 * - "delete coffee from table 1"
 */
function tryRemoveItem(input, menuItems) {
  const match = input.match(/(?:remove|delete)\s+(.+?)\s+from\s+table\s+(\d+)/i);
  if (match) {
    const rawName = match[1].trim();
    const matchedItem = findMenuItem(rawName, menuItems);
    return {
      action: 'REMOVE_ITEM',
      table: parseInt(match[2], 10),
      item_name: matchedItem ? matchedItem.name : rawName,
    };
  }
  return null;
}

/**
 * ADD_MENU_ITEM patterns:
 * - "add burger to menu at 9.99"
 * - "new menu item pasta 12.50"
 */
function tryAddMenuItem(input) {
  const patterns = [
    /add\s+(.+?)\s+to\s+menu\s+(?:at\s+|for\s+)?(\d+\.?\d*)/i,
    /new\s+menu\s+item\s+(.+?)\s+(\d+\.?\d*)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return {
        action: 'ADD_MENU_ITEM',
        name: match[1].trim(),
        price: parseFloat(match[2]),
        emoji: '🍽️',
      };
    }
  }

  return null;
}

/**
 * DELETE_MENU_ITEM patterns:
 * - "remove burger from menu"
 * - "delete pasta from menu"
 */
function tryDeleteMenuItem(input) {
  const match = input.match(/(?:remove|delete)\s+(.+?)\s+from\s+menu/i);
  if (match) {
    return {
      action: 'DELETE_MENU_ITEM',
      name: match[1].trim(),
    };
  }
  return null;
}

/**
 * GET_STATUS patterns:
 * - "status of table 3"
 * - "how is table 5"
 * - "revenue" / "sales" / "total"
 */
function tryGetStatus(input) {
  // Table-specific status
  const tableMatch = input.match(/(?:status\s+(?:of\s+)?table|how\s+is\s+table)\s+(\d+)/i);
  if (tableMatch) {
    return {
      action: 'GET_STATUS',
      target: 'table',
      table: parseInt(tableMatch[1], 10),
    };
  }

  // Revenue / sales / total
  if (/\b(?:revenue|sales|total)\b/i.test(input)) {
    return {
      action: 'GET_STATUS',
      target: 'revenue',
    };
  }

  return null;
}

// ─────────────────────────────────────────────
// Fuzzy Menu Item Matching
// ─────────────────────────────────────────────

/**
 * Find the best matching menu item for a given name.
 * Priority: exact match → includes → startsWith.
 * 
 * @param {string} rawName — the user's input item name
 * @param {Array<{ name: string }>} menuItems — available menu items
 * @returns {{ name: string }|null} the matched menu item, or null
 */
function findMenuItem(rawName, menuItems) {
  if (!rawName || !menuItems?.length) return null;

  const lower = rawName.toLowerCase();

  // 1. Exact match (case-insensitive)
  const exact = menuItems.find(
    (item) => item.name.toLowerCase() === lower
  );
  if (exact) return exact;

  // 2. Menu item name includes the search term
  const includes = menuItems.find(
    (item) => item.name.toLowerCase().includes(lower)
  );
  if (includes) return includes;

  // 3. Menu item name starts with the search term
  const startsWith = menuItems.find(
    (item) => item.name.toLowerCase().startsWith(lower)
  );
  if (startsWith) return startsWith;

  // 4. Search term includes the menu item name
  const reverseIncludes = menuItems.find(
    (item) => lower.includes(item.name.toLowerCase())
  );
  if (reverseIncludes) return reverseIncludes;

  return null;
}
