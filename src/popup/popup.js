'use strict';

(async function () {
  const { storage } = window.MSA;
  const $ = (id) => document.getElementById(id);
  const PANEL_URL = /^https:\/\/supplier\.meesho\.com\//;

  const [profiles, activeId] = await Promise.all([storage.get('profiles'), storage.get('activeProfileId')]);
  const select = $('profile');
  select.append(new Option(profiles.length ? 'Choose a profile' : 'No profiles yet', ''));
  for (const p of profiles) select.append(new Option(p.name, p.id, false, p.id === activeId));
  select.addEventListener('change', () => storage.set('activeProfileId', select.value || null));

  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onPanel = tab && PANEL_URL.test(tab.url || '');
  $('fill').disabled = !onPanel;
  $('capture').disabled = !onPanel;
  if (!onPanel) return;

  const setStatus = (text, cls) => {
    $('status').textContent = text;
    $('status').className = cls || 'muted';
  };

  chrome.tabs.sendMessage(tab.id, { type: 'MSA_STATUS' }).then(
    (res) => {
      if (!res) return;
      const parts = [`Detected ${res.detected.length} known fields on this page.`];
      if (res.lastTransfer) parts.push(`Shipping ₹${res.lastTransfer.shippingCharge}, settlement ₹${res.lastTransfer.settlement}.`);
      setStatus(parts.join(' '));
    },
    () => setStatus('Reload the supplier panel tab once after installing.', 'warn'),
  );

  $('capture').addEventListener('click', async () => {
    // The name prompt appears on the page, so close the popup's focus first.
    setStatus('Check the supplier panel tab to name the profile.');
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'MSA_CAPTURE' });
      if (res && res.ok) setStatus(`Saved "${res.name}".`, 'ok');
    } catch (e) {
      setStatus('Reload the supplier panel tab once after installing.', 'warn');
    }
  });

  $('fill').addEventListener('click', async () => {
    if (!select.value) return setStatus('Choose a profile first.', 'warn');
    setStatus('Filling…');
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'MSA_FILL', profileId: select.value });
      const r = res && res.report;
      if (!r) return setStatus('Could not fill. Is the listing form open?', 'warn');
      setStatus(`Filled ${r.filled.length}, failed ${r.failed.length}, not on page ${r.notFound.length}. Review before submitting.`, r.failed.length ? 'warn' : 'ok');
    } catch (e) {
      setStatus('Reload the supplier panel tab once after installing.', 'warn');
    }
  });
})();
