/* ════════════════════════════════════════════════════════════
   gnoke-secure.js  v1.0
   Universal login/register handler for GnokeDatabase runtime.

   FLOW
     Register : identifier + PIN + name → save-profile → authorize → app.html
     Sign In  : identifier + PIN        → save-profile → authorize → app.html

   DEVICE ID
     device_id = SHA-256( company_id + app_id + identifier + PIN )
     Deterministic — same credentials on any device = same device_id.
     Wrong PIN = different device_id = new token, broken identity chain.
     This is the auth gate — the server issues a token per device_id.

   WORKSPACE
     Returned from the server profile row (workspace_id field).
     Server assigns office/branch at registration or via admin.
     If blank on first register, falls back to app_id as default
     workspace so data is always namespaced — never orphaned.

   IDENTITY CHAIN (data isolation guarantee)
     gnoke_{company_id}_{app_id}_{workspace_id}_{user_id}_{collection}
     Same user + different app      = different namespace
     Same app  + different company  = different namespace
     Same app  + different workspace = different namespace
     Collision is structurally impossible.

   DEPENDS ON
     GnokeStore  (gnoke-store.js)   — configure + isReady
     GNOKE_SYNC  (gnoke-sync.js)    — authorize + init + start
     gnoke-config.js                — endpoint, company_id, app_id
════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ── STATE ────────────────────────────────────────────────── */
  let _mode    = 'signin';   // 'signin' | 'register'
  let _tab     = 'phone';    // 'phone'  | 'email'
  let _busy    = false;

  /* ── DEVICE FINGERPRINT ───────────────────────────────────── */
  /*
    Deterministic device_id from credentials.
    SHA-256 is available natively in all modern browsers via SubtleCrypto.
    No library needed. Falls back to a weaker btoa hash on very old browsers.
  */
  async function _deviceId(company_id, app_id, identifier, pin) {
    const raw = `${company_id}|${app_id}|${identifier.trim().toLowerCase()}|${pin}`;
    if (root.crypto?.subtle) {
      const buf    = new TextEncoder().encode(raw);
      const digest = await root.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for legacy browsers
    return btoa(raw).replace(/[^a-z0-9]/gi, '').slice(0, 64);
  }

  /* ── SESSION CHECK ────────────────────────────────────────── */
  /*
    On page load check if there's already a valid session.
    If GnokeStore is already ready (identity fully resolved) and
    GNOKE_SYNC is authorized, skip the login page entirely.
  */
  function checkExistingSession() {
    try {
      const auth = JSON.parse(localStorage.getItem('gnoke_sync_auth'));
      if (!auth?.syncAuthorized || !auth?.syncToken) return false;

      const session = JSON.parse(localStorage.getItem('gnoke_session'));
      if (!session?.user_id || !session?.workspace_id) return false;

      const identity = root.GnokeStore.getIdentity();
      if (!identity.company_id || !identity.app_id) return false;

      // Re-hydrate identity from saved session
      root.GnokeStore.configure({
        user_id      : session.user_id,
        workspace_id : session.workspace_id,
      });

      GNOKE_SYNC.init({
        endpoint    : identity.endpoint,
        workspaceId : session.workspace_id,
        phone       : session.identifier,
        dk          : session.device_id,
      });

      GNOKE_SYNC.start();
      if (root.GNOKE_PULL) {
        root.GNOKE_PULL.init();
        root.GNOKE_PULL.start();
      }

      _launch();
      return true;
    } catch { return false; }
  }

  /* ── LAUNCH ───────────────────────────────────────────────── */
  function _launch() {
    location.href = 'app.html';
  }

  /* ── NOTIFY ───────────────────────────────────────────────── */
  function _notify(msg, type = '') {
    const el = document.getElementById('notify');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'notify' + (type ? ' ' + type : ' show');
  }

  function _setBusy(on) {
    _busy = on;
    const btn = document.getElementById('btn-submit');
    if (!btn) return;
    btn.disabled    = on;
    btn.textContent = on ? 'Please wait…' : (_mode === 'signin' ? 'Sign In' : 'Create Identity');
  }

  /* ── PUBLIC: switchTab ────────────────────────────────────── */
  function switchTab(tab) {
    _tab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.tab-btn[onclick*="${tab}"]`);
    if (active) active.classList.add('active');

    const label = document.getElementById('identifier-label');
    const input = document.getElementById('gnk-identifier');
    if (tab === 'phone') {
      if (label) label.textContent = 'Phone Number';
      if (input) { input.type = 'tel'; input.placeholder = '080...'; }
    } else {
      if (label) label.textContent = 'Email Address';
      if (input) { input.type = 'email'; input.placeholder = 'you@example.com'; }
    }
    _notify('');
  }

  /* ── PUBLIC: toggleMode ───────────────────────────────────── */
  function toggleMode() {
    _mode = _mode === 'signin' ? 'register' : 'signin';

    const isRegister = _mode === 'register';
    const title      = document.getElementById('mode-title');
    const subtitle   = document.getElementById('mode-subtitle');
    const fieldName  = document.getElementById('field-username');
    const toggleBtn  = document.getElementById('toggle-btn');
    const toggleText = document.getElementById('toggle-text');
    const submitBtn  = document.getElementById('btn-submit');

    if (title)      title.textContent    = isRegister ? 'Create Identity' : 'Sign In';
    if (subtitle)   subtitle.textContent = isRegister ? 'Register a new account' : 'Access your existing account';
    if (fieldName)  fieldName.style.display = isRegister ? '' : 'none';
    if (toggleBtn)  toggleBtn.textContent   = isRegister ? 'Sign In Instead' : 'Create Identity';
    if (toggleText) toggleText.textContent  = isRegister ? 'Already registered? ' : "Don't have an account? ";
    if (submitBtn)  submitBtn.textContent   = isRegister ? 'Create Identity' : 'Sign In';
    _notify('');
  }

  /* ── PUBLIC: handleSubmit ─────────────────────────────────── */
  async function handleSubmit(e) {
    e.preventDefault();
    if (_busy) return;

    const identifier = document.getElementById('gnk-identifier')?.value.trim();
    const pin        = document.getElementById('gnk-password')?.value;
    const name       = document.getElementById('gnk-name')?.value.trim();

    if (!identifier) { _notify('Enter your ' + (_tab === 'phone' ? 'phone number' : 'email address') + '.', 'err'); return; }
    if (!pin || pin.length < 4) { _notify('PIN must be at least 4 characters.', 'err'); return; }
    if (_mode === 'register' && !name) { _notify('Enter your display name.', 'err'); return; }

    const identity = root.GnokeStore.getIdentity();
    if (!identity.company_id || !identity.app_id || !identity.endpoint) {
      _notify('Configuration error — check gnoke-config.js.', 'err');
      return;
    }

    _setBusy(true);
    _notify('Connecting…');

    try {
      const device_id = await _deviceId(identity.company_id, identity.app_id, identifier, pin);

      const body = {
        company_id : identity.company_id,
        app_id     : identity.app_id,
        phone      : identifier,       // server stores identifier in phone field
        device_id,
        ...(name ? { name } : {}),
      };

      const res  = await fetch(`${identity.endpoint}?action=save-profile`, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        _notify(data?.error || 'Server error — try again.', 'err');
        _setBusy(false);
        return;
      }

      const { token, user_id, role } = data;

      /*
        workspace_id comes from the server profile row.
        If the server hasn't assigned one yet (new user, no admin assignment),
        fall back to app_id so data is always namespaced — never orphaned.
        Admin can later assign workspace_id via save-profile with admin_secret.
      */
      const workspace_id = data.workspace_id || identity.workspace_id || identity.app_id;

      // Hydrate GnokeStore identity with resolved user + workspace
      root.GnokeStore.configure({ user_id, workspace_id });

      // Authorize sync
      GNOKE_SYNC.authorize(token);
      GNOKE_SYNC.init({
        endpoint    : identity.endpoint,
        workspaceId : workspace_id,
        phone       : identifier,
        dk          : device_id,
      });
      GNOKE_SYNC.start();

      if (root.GNOKE_PULL) {
        root.GNOKE_PULL.init();
        root.GNOKE_PULL.start();
      }

      // Persist session for auto-login on next page load
      localStorage.setItem('gnoke_session', JSON.stringify({
        user_id,
        workspace_id,
        role,
        identifier,
        device_id,
      }));

      _notify('Authorized. Launching…', 'ok');
      setTimeout(_launch, 600);

    } catch (err) {
      _notify('Network error — check connection.', 'err');
      _setBusy(false);
    }
  }

  /* ── PUBLIC: signOut ──────────────────────────────────────── */
  /*
    Full session teardown. Safe to call from app.html.
    Clears sync auth and session but leaves queue intact —
    unsynced events survive a sign-out and push on next login.
  */
  function signOut() {
    localStorage.removeItem('gnoke_sync_auth');
    localStorage.removeItem('gnoke_session');
    location.href = 'index.html';
  }

  /* ── BOOT ─────────────────────────────────────────────────── */
  /*
    On DOMContentLoaded — check for an existing valid session first.
    If found, skip login page entirely and go straight to app.html.
  */
  document.addEventListener('DOMContentLoaded', () => {
    checkExistingSession();
  });

  /* ── EXPORT ───────────────────────────────────────────────── */
  root.GNOKE_SECURE = Object.freeze({
    handleSubmit,
    switchTab,
    toggleMode,
    signOut,
  });

})(window);


