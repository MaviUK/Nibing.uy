// Opt-in diagnostics for the automatic booking scheduler.
// Enable with ?bookingdebug=1. Customers never see this during normal use.

const params = new URLSearchParams(window.location.search);
const DEBUG_ENABLED = params.get('bookingdebug') === '1';

if (DEBUG_ENABLED) {
  const nativeFetch = window.fetch.bind(window);

  function ensureDebugPanel() {
    let panel = document.querySelector('[data-booking-schedule-debug]');
    if (panel) return panel;

    const schedulePanel = document.querySelector('[data-auto-schedule-panel]');
    if (!schedulePanel) return null;

    panel = document.createElement('div');
    panel.dataset.bookingScheduleDebug = 'true';
    panel.style.cssText = 'margin-top:12px;padding:12px;border:2px dashed #7c3aed;border-radius:12px;background:#faf5ff;color:#3b0764;font-size:12px;line-height:1.5;white-space:normal;overflow-wrap:anywhere;';
    schedulePanel.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function row(label, value) {
    const safe = value === undefined || value === null || value === '' ? '—' : value;
    return `<div><strong>${label}:</strong> ${String(safe)}</div>`;
  }

  function renderDebug(requestBody, data, status) {
    // The normal scheduler may still be rendering when fetch resolves.
    window.setTimeout(() => {
      const panel = ensureDebugPanel();
      if (!panel) return;

      const results = Array.isArray(data?.results) ? data.results : [];
      let html = '<div style="font-weight:800;font-size:14px;margin-bottom:6px">🔧 Booking debug</div>';
      html += row('HTTP', status);
      html += row('Entered address', requestBody?.address);
      html += row('Postcode', data?.postcode || requestBody?.postcode);
      html += row('Address source', data?.addressSource);
      html += row('Council address', data?.councilAddress);
      html += row('UPRN', data?.uprn);
      html += row('Town', data?.town);
      html += row('Town source', data?.townSource);
      html += row('Overall matched', data?.matched);
      if (data?.reason) html += row('FAIL reason', data.reason);
      if (data?.error) html += row('ERROR', data.error);

      results.forEach((result, index) => {
        html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #c4b5fd"><strong>Bin ${index + 1}</strong></div>`;
        html += row('Selected bin', result?.bin);
        html += row('Council bin', result?.councilBin);
        html += row('Council dates found', (result?.councilDates || []).join(', '));
        html += row('Next two checked', (result?.nextTwoCouncilDates || []).join(', '));
        html += row('Town used', result?.town);
        const support = result?.round?.townDateSupport || [];
        html += row('Town workload', support.map((item) => `${item.date}: ${item.support}`).join(' | '));
        html += row('Resolution', result?.round?.resolvedBy);
        html += row('Assigned date', result?.assignedCleanDate);
        html += row('Automatic', result?.automatic);
      });

      if (!results.length && !data?.reason && !data?.error) {
        html += row('FAIL reason', 'No result rows returned by booking schedule API');
      }

      panel.innerHTML = html;
    }, 50);
  }

  window.fetch = async (...args) => {
    const input = args[0];
    const options = args[1] || {};
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await nativeFetch(...args);

    if (url.includes('/api/booking-schedule')) {
      let requestBody = {};
      try { requestBody = JSON.parse(options.body || '{}'); } catch { /* diagnostic only */ }
      try {
        const data = await response.clone().json();
        renderDebug(requestBody, data, response.status);
      } catch (error) {
        renderDebug(requestBody, { error: `Response was not valid JSON: ${error?.message || error}` }, response.status);
      }
    }

    return response;
  };
}
