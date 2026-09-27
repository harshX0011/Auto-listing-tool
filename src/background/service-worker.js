/*
 * Background service worker: keyboard shortcut and opening the options page.
 * All listing work happens in the content script on the supplier panel.
 */
'use strict';

const PANEL_URL = /^https:\/\/supplier\.meesho\.com\//;

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-active-profile') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !PANEL_URL.test(tab.url || '')) return;
  chrome.tabs.sendMessage(tab.id, { type: 'MSA_FILL' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg && msg.type === 'MSA_OPEN_OPTIONS') chrome.runtime.openOptionsPage();
  return false;
});
