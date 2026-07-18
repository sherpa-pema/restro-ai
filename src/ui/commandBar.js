// Terminal-Style Command Console Module for TableCraft OS

import { getState } from '../state.js';
import { getOrderByTable, getOrderItems } from '../db/indexedDB.js';
import { parseCommandWithAI } from '../ai/cerebras.js';
import { parseCommandWithRegex } from '../ai/regexParser.js';
import { executeCommand } from '../ai/commandExecutor.js';
import { showToast } from './toasts.js';

let commandHistory = [];
let historyIndex = -1;
let isExpanded = false;

/**
 * Initialize Terminal-Style Command Console.
 */
export function initCommandBar() {
  const consoleEl = document.getElementById('terminal-console');
  const headerEl = document.getElementById('terminal-header');
  const bodyEl = document.getElementById('terminal-body');
  const inputEl = document.getElementById('terminal-input');
  const btnSend = document.getElementById('btn-terminal-send');
  const btnMic = document.getElementById('btn-terminal-mic');
  const btnClear = document.getElementById('btn-terminal-clear');
  const toggleIcon = document.getElementById('terminal-toggle-icon');

  if (!consoleEl || !inputEl) return;

  // Toggle handlers
  const expandConsole = () => {
    isExpanded = true;
    consoleEl.classList.remove('h-[56px]');
    consoleEl.classList.add('h-[60vh]', 'sm:h-[400px]', 'max-h-[400px]');
    if (headerEl) headerEl.classList.remove('hidden');
    bodyEl.classList.remove('hidden');

    const promptLineEl = document.getElementById('terminal-prompt-line');
    if (promptLineEl) {
      promptLineEl.classList.add('border-t', 'border-slate-800');
    }

    if (toggleIcon) toggleIcon.innerText = 'keyboard_arrow_down';
    document.body.classList.add('terminal-expanded');
    bodyEl.scrollTop = bodyEl.scrollHeight;
    inputEl.focus();
  };

  const collapseConsole = () => {
    isExpanded = false;
    consoleEl.classList.remove('h-[60vh]', 'sm:h-[400px]', 'max-h-[400px]');
    consoleEl.classList.add('h-[56px]');
    if (headerEl) headerEl.classList.add('hidden');
    bodyEl.classList.add('hidden');

    const promptLineEl = document.getElementById('terminal-prompt-line');
    if (promptLineEl) {
      promptLineEl.classList.remove('border-t', 'border-slate-800');
    }

    if (toggleIcon) toggleIcon.innerText = 'keyboard_arrow_up';
    document.body.classList.remove('terminal-expanded');
  };

  const toggleConsole = () => {
    if (isExpanded) {
      collapseConsole();
    } else {
      expandConsole();
    }
  };

  // Header click toggles console (excluding clear button)
  if (headerEl) {
    headerEl.addEventListener('click', (e) => {
      if (e.target.closest('#btn-terminal-clear')) {
        return;
      }
      toggleConsole();
    });
  }

  // Prompt line and input click/focus handlers to expand console
  const promptLineEl = document.getElementById('terminal-prompt-line');
  if (promptLineEl) {
    promptLineEl.addEventListener('click', (e) => {
      if (e.target.closest('#btn-terminal-mic') || e.target.closest('#btn-terminal-send')) {
        return;
      }
      if (!isExpanded) {
        expandConsole();
      }
      inputEl.focus();
    });
  }

  inputEl.addEventListener('focus', () => {
    if (!isExpanded) {
      expandConsole();
    }
  });

  // Clear console log buffer
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="flex flex-col items-start mb-3">
            <div class="max-w-[85%] bg-slate-800/60 border border-slate-700/50 text-slate-400 rounded-2xl rounded-tl-none px-3 py-2 text-[11px] italic">
              History cleared. Type a command below. Try "Add 2 chicken burgers to table 3" or "status".
            </div>
          </div>
        `;
        showToast('Console history cleared', 'info');
      }
    });
  }

  // Print helper for terminal output
  const printToConsole = (text, type = 'info') => {
    // Route internal system and AI parsing details to browser console log
    if (type === 'ai' || type === 'system') {
      console.log(`[Assistant System Log] (${type}):`, text);
      return;
    }

    if (!bodyEl) return;
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    if (type === 'cmd') {
      // User message - Right aligned bubble
      line.className = "flex flex-col items-end mb-3";
      line.innerHTML = `
        <div class="max-w-[85%] bg-slate-800 text-slate-100 rounded-2xl rounded-tr-none px-3 py-2 text-xs shadow-sm leading-relaxed whitespace-pre-wrap">
          ${escapeHTML(text)}
        </div>
        <span class="text-[9px] text-slate-500 mt-1 mr-1">${time}</span>
      `;
    } else if (type === 'error') {
      // Error message - Left aligned rose bubble
      line.className = "flex flex-col items-start mb-3";
      line.innerHTML = `
        <div class="max-w-[85%] bg-rose-950/40 border border-rose-500/20 text-rose-300 rounded-2xl rounded-tl-none px-3 py-2 text-xs shadow-sm leading-relaxed whitespace-pre-wrap">
          ${escapeHTML(text)}
        </div>
        <span class="text-[9px] text-slate-500 mt-1 ml-1">${time}</span>
      `;
    } else {
      // Assistant success / info message - Left aligned emerald bubble
      line.className = "flex flex-col items-start mb-3";
      line.innerHTML = `
        <div class="max-w-[85%] bg-emerald-950/40 border border-emerald-500/20 text-emerald-300 rounded-2xl rounded-tl-none px-3 py-2 text-xs shadow-sm leading-relaxed whitespace-pre-wrap">
          ${escapeHTML(text)}
        </div>
        <span class="text-[9px] text-slate-500 mt-1 ml-1">${time}</span>
      `;
    }
    
    bodyEl.appendChild(line);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  const escapeHTML = (str) => {
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  };

  // Process and Submit Command
  const submitCommand = async () => {
    const commandText = inputEl.value.trim();
    if (!commandText) return;

    // Log the input command
    printToConsole(commandText, 'cmd');
    
    // Save to history
    commandHistory.push(commandText);
    historyIndex = commandHistory.length;

    // Clear input field
    inputEl.value = '';

    // Auto expand console to show execution log
    if (!isExpanded) {
      expandConsole();
    }

    printToConsole('Dispatching parser to Cerebras Cloud...', 'ai');

    try {
      const state = getState();
      const menuItems = state.menuItems || [];

      // Compile table context (including open order items)
      const tablesContext = [];
      for (const t of (state.tables || [])) {
        const openOrder = (state.orders || []).find(o => o.table_id === t.id && o.status === 'open');
        let itemsSummary = [];
        if (openOrder) {
          try {
            const items = await getOrderItems(openOrder.id);
            itemsSummary = items.map(i => `${i.quantity}x ${i.name}`);
          } catch (e) {
            console.error(e);
          }
        }
        tablesContext.push({
          name: t.name,
          status: t.status,
          seats: t.seats,
          order_total: openOrder ? openOrder.total : 0,
          items: itemsSummary
        });
      }

      // Compile low stock items
      const lowStockContext = (state.inventory || [])
        .filter(item => Number(item.current_stock) < Number(item.reorder_threshold))
        .map(item => ({
          name: item.ingredient_name,
          stock: Number(item.current_stock),
          threshold: Number(item.reorder_threshold),
          unit: item.unit
        }));

      // Compile today's revenue
      const todayTx = state.transactions || [];
      const totalRevenue = todayTx.reduce((sum, tx) => sum + (tx.amount || 0), 0);

      const context = {
        tables: tablesContext,
        low_stock_ingredients: lowStockContext,
        today_revenue: {
          total: totalRevenue,
          currency: state.currency || 'NPR',
          transactions_count: todayTx.length
        }
      };

      let intent = await parseCommandWithAI(commandText, menuItems, context);
      let isRegexFallback = false;

      // Local Regex fallback if AI returns UNKNOWN or matches command keywords when chat mode active
      const isCommandLike = /add|remove|delete|clear|pay|close|bill|discount|status/i.test(commandText);
      
      if (!intent || intent.action === 'UNKNOWN' || (intent.action === 'CHAT' && isCommandLike)) {
        printToConsole('AI parser returned unknown intent. Running local fallback regex engine...', 'system');
        const fallbackIntent = parseCommandWithRegex(commandText, menuItems);
        if (fallbackIntent) {
          intent = fallbackIntent;
          isRegexFallback = true;
        }
      }

      if (!intent || intent.action === 'UNKNOWN') {
        const errorMsg = intent?.message || 'Syntax error: Could not resolve intent.';
        printToConsole(errorMsg, 'error');
        showToast(errorMsg, 'error');
        return;
      }

      // Execute structured intent
      printToConsole(`Executing intent: ${intent.action}...`, 'system');
      const executionResult = await executeCommand(intent);

      if (executionResult.success) {
        let successMessage = intent.reply || executionResult.message;
        
        if (intent.action === 'GET_STATUS') {
          successMessage = intent.reply ? `${intent.reply} ${executionResult.message}` : executionResult.message;
        }
        
        if (executionResult.isChat) {
          printToConsole(successMessage, 'info');
        } else {
          printToConsole(`${successMessage}${isRegexFallback ? ' (processed by regex engine)' : ''}`, 'success');
          showToast(successMessage, 'success');
        }
      } else {
        printToConsole(executionResult.message, 'error');
        showToast(executionResult.message, 'error');
      }

    } catch (err) {
      console.error(err);
      printToConsole(`Fatal error: ${err.message}`, 'error');
      showToast('Error executing command', 'error');
    }
  };

  // Keyboard listeners for shortcut keys and input navigation
  window.addEventListener('keydown', (e) => {
    // Tilde (`) key toggles console focus/state
    if (e.key === '`') {
      e.preventDefault();
      toggleConsole();
    }

    // Ctrl+K or Cmd+K toggle shortcut
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggleConsole();
    }

    // Escape collapses expanded console
    if (e.key === 'Escape' && isExpanded) {
      e.preventDefault();
      collapseConsole();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCommand();
    }

    // Command History cycling
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      
      if (historyIndex > 0) {
        historyIndex--;
        inputEl.value = commandHistory[historyIndex];
      } else if (historyIndex === 0) {
        inputEl.value = commandHistory[0];
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (commandHistory.length === 0) return;

      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        inputEl.value = commandHistory[historyIndex];
      } else {
        historyIndex = commandHistory.length;
        inputEl.value = '';
      }
    }
  });

  if (btnSend) btnSend.addEventListener('click', submitCommand);

  // Speech Input Integration using Browser's Native SpeechRecognition API
  if (btnMic) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;
    let originalPlaceholder = inputEl.placeholder || '';

    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let pressStartTime = 0;
      let ignoreShortTap = false;
      let isPressing = false;

      recognition.addEventListener('start', () => {
        isListening = true;
        btnMic.innerHTML = '<span class="material-symbols-outlined text-rose-500 animate-pulse text-[20px]">mic_off</span>';
        inputEl.placeholder = 'Listening... Speak now.';
        printToConsole('Console microphone active. Listening...', 'system');
        showToast('Listening... Speak now', 'info');
      });

      recognition.addEventListener('result', (event) => {
        if (ignoreShortTap) return;
        
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        transcript = transcript.trim();
        
        if (transcript) {
          inputEl.value = transcript;
          if (!isExpanded) expandConsole();
          inputEl.focus();
        }
      });

      recognition.addEventListener('end', () => {
        isListening = false;
        btnMic.innerHTML = '<span class="material-symbols-outlined text-[20px]">mic</span>';
        inputEl.placeholder = originalPlaceholder;
      });

      recognition.addEventListener('error', (event) => {
        console.error('Speech recognition error:', event.error);
        let errorMsg = 'Could not access microphone or recognize speech.';
        if (event.error === 'not-allowed') {
          errorMsg = 'Microphone permission denied. Please enable mic access in your browser settings.';
        } else if (event.error === 'no-speech') {
          errorMsg = 'No speech was detected. Please try again.';
          showToast(errorMsg, 'warning');
          printToConsole(`Microphone: ${errorMsg}`, 'warning');
          return;
        } else if (event.error === 'network') {
          errorMsg = 'Network error during speech recognition.';
        }
        showToast(errorMsg, 'error');
        printToConsole(`Microphone error: ${errorMsg}`, 'error');
      });

      const handlePress = (e) => {
        e.preventDefault();
        if (isPressing) return;
        isPressing = true;
        pressStartTime = Date.now();
        ignoreShortTap = false;
        
        try {
          recognition.start();
        } catch (err) {
          console.error('Failed to start recognition:', err);
        }
      };

      const handleRelease = (e) => {
        e.preventDefault();
        if (!isPressing) return;
        isPressing = false;
        
        const holdDuration = Date.now() - pressStartTime;
        if (holdDuration < 300) {
          ignoreShortTap = true;
          recognition.abort();
          showToast('Hold the mic button to talk', 'info');
        } else {
          recognition.stop();
        }
      };

      btnMic.addEventListener('mousedown', handlePress);
      btnMic.addEventListener('touchstart', handlePress, { passive: false });
      
      btnMic.addEventListener('mouseup', handleRelease);
      btnMic.addEventListener('mouseleave', handleRelease);
      btnMic.addEventListener('touchend', handleRelease, { passive: false });
      btnMic.addEventListener('touchcancel', handleRelease, { passive: false });
    } else {
      btnMic.addEventListener('click', () => {
        showToast('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.', 'error');
      });
    }
  }
}
