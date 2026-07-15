// Terminal-Style Command Console Module for TableCraft OS

import { getState } from '../state.js';
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
    consoleEl.classList.remove('h-[44px]');
    consoleEl.classList.add('h-[300px]', 'shadow-[0_-12px_40px_rgba(16,185,129,0.15)]');
    bodyEl.classList.remove('hidden');
    if (toggleIcon) toggleIcon.innerText = 'expand_more';
    document.body.classList.add('terminal-expanded');
    bodyEl.scrollTop = bodyEl.scrollHeight;
    inputEl.focus();
  };

  const collapseConsole = () => {
    isExpanded = false;
    consoleEl.classList.remove('h-[300px]', 'shadow-[0_-12px_40px_rgba(16,185,129,0.15)]');
    consoleEl.classList.add('h-[44px]');
    bodyEl.classList.add('hidden');
    if (toggleIcon) toggleIcon.innerText = 'expand_less';
    document.body.classList.remove('terminal-expanded');
  };

  const toggleConsole = () => {
    if (isExpanded) {
      collapseConsole();
    } else {
      expandConsole();
    }
  };

  // Header click toggles console (excluding clear/mic buttons)
  if (headerEl) {
    headerEl.addEventListener('click', (e) => {
      if (e.target.closest('#btn-terminal-clear') || e.target.closest('#btn-terminal-mic')) {
        return;
      }
      toggleConsole();
    });
  }

  // Clear console log buffer
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="text-emerald-500/60 font-medium">Console buffer cleared.</div>
          <div class="text-emerald-500/60 font-medium mb-2">Type a command below. Try "Add 2 chicken burgers to table 3" or "status".</div>
        `;
        showToast('Console history cleared', 'info');
      }
    });
  }

  // Print helper for terminal output
  const printToConsole = (text, type = 'info') => {
    if (!bodyEl) return;
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let typeClass = 'text-slate-300';
    let prefix = '';
    
    switch (type) {
      case 'cmd':
        typeClass = 'text-emerald-400 font-bold';
        prefix = 'guest@tc-os:~$ ';
        break;
      case 'success':
        typeClass = 'text-emerald-500 font-semibold';
        prefix = '[ OK ] ';
        break;
      case 'error':
        typeClass = 'text-rose-500 font-semibold';
        prefix = '[ERR] ';
        break;
      case 'ai':
        typeClass = 'text-cyan-400';
        prefix = '[ AI ] ';
        break;
      case 'system':
        typeClass = 'text-slate-500 italic';
        prefix = '[SYS] ';
        break;
    }

    line.className = `flex gap-2 py-0.5 text-xs font-mono ${typeClass}`;
    line.innerHTML = `
      <span class="text-slate-600 select-none">${time}</span>
      <span class="flex-1 whitespace-pre-wrap">${prefix}${escapeHTML(text)}</span>
    `;
    
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
      const menuItems = getState().menuItems || [];
      let intent = await parseCommandWithAI(commandText, menuItems);
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

  // Speech Recognition API Integration
  if (btnMic) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      btnMic.addEventListener('click', () => {
        showToast('Speech recognition is not supported in this browser.', 'error');
        printToConsole('Speech recognition is not supported in this browser.', 'error');
      });
    } else {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.lang = 'en-US';
      recognition.interimResults = false;

      let isListening = false;

      recognition.onstart = () => {
        isListening = true;
        btnMic.innerHTML = '<span class="material-symbols-outlined text-rose-500 animate-pulse text-[16px]">mic_off</span>';
        printToConsole('Console microphone active. Listening...', 'system');
        showToast('Listening... Speak now', 'info');
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        inputEl.value = transcript;
        printToConsole(`Microphone input transcribed: "${transcript}"`, 'system');
        if (!isExpanded) expandConsole();
        inputEl.focus();
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        printToConsole(`Microphone capture error: ${event.error}`, 'error');
        showToast(`Voice error: ${event.error}`, 'error');
      };

      recognition.onend = () => {
        isListening = false;
        btnMic.innerHTML = '<span class="material-symbols-outlined text-[16px]">mic</span>';
      };

      btnMic.addEventListener('click', () => {
        if (isListening) {
          recognition.stop();
        } else {
          recognition.start();
        }
      });
    }
  }
}
