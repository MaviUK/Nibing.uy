// Booking scheduler client guard plus opt-in diagnostics.
// Same-day automatic bookings are allowed only before 10:00 GMT.
// Enable diagnostics with ?bookingdebug=1. Customers never see debug output normally.

const params = new URLSearchParams(window.location.search);
const DEBUG_ENABLED = params.get('bookingdebug') === '1';
const nativeFetch = window.fetch.bind(window);

function gmtTodayIso(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function applySameDayCutoff(data, now = new Date()) {
  if (!data || !Array.isArray(data.results) || now.getUTCHours() < 10) return data;

  const today = gmtTodayIso(now);
  let changed = false;
  const results = data.results.map((result) => {
    if (result?.assignedCleanDate !== today) return result;

    const support = Array.isArray(result?.round?.townDateSupport) ? result.round.townDateSupport : [];
    const nextSupported = support
      .filter((item) => item?.date > today && Number(item?.support || 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    if (!nextSupported) {
      changed = true;
      return {
        ...result,
        assignedCleanDate: null,
        automatic: false,
        round: {
          ...(result.round || {}),
          matched: false,
          nextCleanDate: null,
          councilValidationDate: null,
          resolvedBy: 'same_day_cutoff_after_10am_gmt_no_next_supported_date',
        },
      };
    }

    changed = true;
    return {
      ...result,
      assignedCleanDate: nextSupported.date,
      automatic: true,
      round: {
        ...(result.round || {}),
        matched: true,
        nextCleanDate: nextSupported.date,
        councilValidationDate: nextSupported.date,
        support: nextSupported.support,
        resolvedBy: 'next_supported_date_after_10am_gmt_cutoff',
      },
    };
  });

  if (!changed) return data;
  return {
    ...data,
    results,
    matched: results.every((result) => Boolean(result?.assignedCleanDate)),
    sameDayCutoffApplied: true,
    sameDayCutoff: '10:00 GMT',
  };
}

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function row(label, value) {
  const safe = value === undefined || value === null || value === '' ? '—' : value;
  return `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(safe)}</div>`;
}

function renderDebug(requestBody, data, status) {
  if (!DEBUG_ENABLED) return;
  window.setTimeout(() => {
    const panel = ensureDebugPanel();
    if (!panel) return;

    const results = Array.isArray(data?.results) ? data.results : [];
    let html = '<div style="font-weight:800;font-size:14px;margin-bottom:6px">🔧 Booking debug</div>';
    html += row('HTTP', status);
    html += row('Entered address', requestBody?.address);
    html += row('Postcode', data?.postcode || requestBody?.postcode);
    html += row('Address source', data?.addressSource);
    html += row('Requested property number', data?.requestedPropertyNumber);
    html += row('Address match method', data?.addressMatchMethod);
    html += row('Council address', data?.councilAddress);
    html += row('UPRN', data?.uprn);
    html += row('Town', data?.town);
    html += row('Town source', data?.townSource);
    html += row('Overall matched', data?.matched);
    html += row('10am GMT cutoff applied', data?.sameDayCutoffApplied);
    if (data?.reason) html += row('FAIL reason', data.reason);
    if (data?.error) html += row('ERROR', data.error);

    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    if (candidates.length) {
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #c4b5fd"><strong>Council candidates</strong></div>';
      candidates.forEach((candidate, index) => {
        html += row(`Candidate ${index + 1}`, `${candidate?.label || '—'} | score ${candidate?.score ?? '—'} | UPRN ${candidate?.uprn || '—'}`);
      });
    }

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

  if (!url.includes('/api/booking-schedule')) return response;

  let requestBody = {};
  try { requestBody = JSON.parse(options.body || '{}'); } catch { /* diagnostic only */ }

  try {
    const originalData = await response.clone().json();
    const data = applySameDayCutoff(originalData);
    renderDebug(requestBody, data, response.status);

    if (data === originalData) return response;
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    renderDebug(requestBody, { error: `Response was not valid JSON: ${error?.message || error}` }, response.status);
    return response;
  }
};
