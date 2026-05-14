/* ════════════════════════════════════════════════════════════
   gnoke-restore.js  v1.0
   Account restore via admin-issued OTP.

   FLOW
     Admin calls generate-otp (server-side / admin panel)
     User clicks Restore tab → enters OTP + new device PIN
     redeem-otp → issues new token → authorize → app.html

   WHY PIN AT RESTORE
     The new PIN becomes the new device_id seed.
     After restore the user logs in with the new PIN —
     their identity chain is re-established from the server.
════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ── MODAL HTML ───────────────────────────────────────────── */
  function _injectModal() {
    if (document.getElementById('restore-modal')) return;
    const el = document.createElement('div');
    el.id        = 'restore-modal';
    el.className = 'restore-overlay';
    el.innerHTML = `
      <div class="restore-box">
        <button class="restore-close" onclick="GNOKE_RESTORE.close()">✕</button>
        <h3>Restore Account</h3>
        <p class="restore-sub">Enter the OTP your admin provided, then set a new PIN for this device.</p>
        <div class="field">
          <label>OTP Code</label>
          <input id="restore-otp" type="text" placeholder="e.g. A1B2C3D4" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:.2em;" />
        </div>
        <div class="field">
          <label>New PIN</label>
          <input id="restore-pin" type="password" placeholder="••••••••" autocomplete="new-password" />
        </div>
        <button class="btn-primary" id="restore-submit" onclick="GNOKE_RESTORE.submit()">Restore Access</button>
        <div class="notify" id="restore-notify"></div>
      </div>`;
    document.body.appendChild(el);
  }

  /* ── NOTIFY ───────────────────────────────────────────────── */
  function _notify(msg, type = '') {
    const el = document.getElementById('restore-notify');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'notify' + (type ? ' ' + type : ' show');
  }

  function _setBusy(on) {
    const btn = document.getElementById('restore-submit');
    if (!btn) return;
    btn.disabled    = on;
    btn.textContent = on ? 'Restoring…' : 'Restore Access';
  }

  /* ── PUBLIC: open ─────────────────────────────────────────── */
  function open() {
    _injectModal();
    document.getElementById('restore-modal').classList.add('active');
    document.getElementById('restore-otp')?.focus();
  }

  /* ── PUBLIC: close ────────────────────────────────────────── */
  function close() {
    const el = document.getElementById('restore-modal');
    if (el) el.classList.remove('active');
  }

  /* ── PUBLIC: submit ───────────────────────────────────────── */
  async function submit() {
    const otp = document.getElementById('restore-otp')?.value.trim().toUpperCase();
    const pin = document.getElementById('restore-pin')?.value;

    if (!otp || otp.length < 6) { _notify('Enter a valid OTP.', 'err'); return; }
    if (!pin || pin.length < 4) { _notify('PIN must be at least 4 characters.', 'err'); return; }

    const identity = root.GnokeStore.getIdentity();
    if (!identity.company_id || !identity.app_id || !identity.endpoint) {
      _notify('Configuration error — check gnoke-config.js.', 'err');
      return;
    }

    _setBusy(true);
    _notify('Verifying OTP…');

    try {
      // Build device_id from the new PIN — same logic as gnoke-secure.js
      const raw     = `${identity.company_id}|${identity.app_id}|restore|${pin}`;
      let device_id;
      if (root.crypto?.subtle) {
        const buf    = new TextEncoder().encode(raw);
        const digest = await root.crypto.subtle.digest('SHA-256', buf);
        device_id    = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      } else {
        device_id = btoa(raw).replace(/[^a-z0-9]/gi, '').slice(0, 64);
      }

      const res  = await fetch(`${identity.endpoint}?action=redeem-otp`, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          otp,
          company_id : identity.company_id,
          app_id     : identity.app_id,
          device_id,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        _notify(data?.error || 'Invalid or expired OTP.', 'err');
        _setBusy(false);
        return;
      }

      const { token, user_id, profile } = data;
      const workspace_id = profile?.workspace_id || identity.workspace_id || identity.app_id;

      root.GnokeStore.configure({ user_id, workspace_id });

      GNOKE_SYNC.authorize(token);
      GNOKE_SYNC.init({
        endpoint    : identity.endpoint,
        workspaceId : workspace_id,
        dk          : device_id,
      });
      GNOKE_SYNC.start();

      if (root.GNOKE_PULL) {
        root.GNOKE_PULL.init();
        root.GNOKE_PULL.start();
      }

      localStorage.setItem('gnoke_session', JSON.stringify({
        user_id,
        workspace_id,
        role        : profile?.role || 'user',
        identifier  : profile?.phone || '',
        device_id,
      }));

      _notify('Restored. Launching…', 'ok');
      setTimeout(() => { location.href = 'app.html'; }, 700);

    } catch {
      _notify('Network error — check connection.', 'err');
      _setBusy(false);
    }
  }

  /* ── EXPORT ───────────────────────────────────────────────── */
  root.GNOKE_RESTORE = Object.freeze({ open, close, submit });

})(window);


