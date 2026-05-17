/* ════════════════════════════════════════════════════════════
   scripts/connect.js  —  API bridge for index.html
   Standalone. No dependencies. Load BEFORE main.js.
   Exposes: window.Connect.post(action, payload) → Promise
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const ENDPOINT = 'https://example.com/api/index.php';

  function _deviceId() {
    let id = localStorage.getItem('device_id');
    if (!id) {
      id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      localStorage.setItem('device_id', id);
    }
    return id;
  }

  async function post(action, payload) {
    const res = await fetch(`${ENDPOINT}?action=${action}`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ...payload, device_id: _deviceId() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `${action} failed.`);
    return data;
  }

  window.Connect = { post };

})();