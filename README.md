# Gnoke Engine — Developer Guide

> One file to edit on the server. One file to edit on the client. Everything else is frozen.

---

## What is this?

Gnoke is a lightweight sync engine — think Firebase, but it's just PHP + SQLite files you own and deploy yourself. Each deployment is for **one company**. Staff devices write data locally first, then sync to the cloud in the background.

---

## Folder layout

```
your-project/
├── index.html          ← login page
├── app.html            ← your app (after login)
├── gnoke-config.js     ← ✏️  edit this (client config)
├── gnoke-store.js      ← frozen
├── gnoke-sync.js       ← frozen
├── gnoke-pull.js       ← frozen
├── gnoke-secure.js     ← frozen
└── api/
    ├── gnoke-config.php  ← ✏️  edit this (server config)
    ├── index.php         ← frozen (API router)
    └── gnoke/            ← frozen (core engine files)
```

**Rule:** You only ever edit the two config files. Everything else is engine internals.

---

## How to deploy a new project

1. Copy the whole project folder.
2. Open `api/gnoke-config.php` — set `DB_PATH`, `ADMIN_SECRET`, and your `ROLES`.
3. Open `gnoke-config.js` — set `GNOKE_ENDPOINT` to your server URL.
4. Define your collections (see Collections below).
5. Upload. Done.

---

## The two config files

### `gnoke-config.php` (server)

| Setting | What it does |
|---|---|
| `DB_PATH` | Where the SQLite database file lives. Keep it outside the web root. |
| `ADMIN_SECRET` | Password for admin-only actions (generate OTP, revoke token). Never put this in frontend code. |
| `MASTER_COLLECTIONS` | Collections the server owns. Devices get a hard copy on every pull. |
| `OTP_TTL` | How long a restore OTP stays valid (seconds). Default: 900 = 15 min. |
| `BATCH_LIMIT` | Max records per sync request. Default: 500. |
| `ROLES` | Who can do what. Leave empty to allow everything. |

### `gnoke-config.js` (client)

| Setting | What it does |
|---|---|
| `GNOKE_ENDPOINT` | Full URL to `api/index.php` on your server. |
| `GnokeStore.configure()` | Sets the endpoint and workspace. Called once on page load. |
| `GnokeStore.define()` | Registers a collection before you can read or write it. |

---

## Collections

A collection is like a database table. You define it once in `gnoke-config.js`:

```js
GnokeStore.define('invoices', { scope: 'workspace' });
```

| Scope | Who sees the data |
|---|---|
| `'user'` | Only the logged-in user on this device |
| `'workspace'` | Everyone in the same branch / group |
| `'company'` | Everyone in the whole deployment |

---

## How login works

1. Staff enter phone/email + PIN.
2. The browser hashes `identifier + PIN` into a `device_id` (SHA-256, no PIN sent to server).
3. Server looks up the profile, returns a **token**.
4. Token is saved to `localStorage`. Every future sync request carries it.
5. On next page load, the token is found and login is skipped automatically.

To log out: call `GNOKE_SECURE.signOut()` — clears token, goes back to `index.html`.

**Inactivity logout is the app's responsibility.** Gnoke validates the session on every page load but does not run an inactivity timer while the page is open. If you want to automatically sign out idle users, set a timer in your `app.html` and call `GNOKE_SECURE.signOut()` when it fires:

```js
// Example: sign out after 30 minutes of no interaction
let idleTimer;
const IDLE_MS = 30 * 60 * 1000; // adjust to suit your app

function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => GNOKE_SECURE.signOut(), IDLE_MS); }
['click','keydown','touchstart','scroll'].forEach(e => document.addEventListener(e, resetIdle));
resetIdle(); // start the timer on page load
```

Choose your timeout based on sensitivity: 5–10 min for finance, 30 min for general staff tools, longer for shift-based apps where a device stays open all day.

---

## How sync works

```
Staff device                    Server (api/index.php)
──────────────────              ──────────────────────
Write locally (instant)
       │
  every 30s ──── push ────────► saves to cloud DB
       │
  every 5min ◄─── pull ─────── returns updates
       │
GnokeStore.merge()
(UI re-renders via onChange)
```

- **Push** (`dispatch`): queued events are sent in batches. Works offline — retries until connected.
- **Pull** (`get`): fetches records changed since last sync using a timestamp cursor.
- **Master pull** (`updates`): hard-overwrites local copy for read-only server lists (e.g. product catalogue).

---

## Reading and writing data

```js
// Write
const id = GnokeStore.save('invoices', { amount: 5000, status: 'pending' });

// Read
const all    = GnokeStore.query('invoices');
const open   = GnokeStore.query('invoices', r => r.status === 'pending');
const single = GnokeStore.getOne('invoices', id);

// Update
GnokeStore.update('invoices', id, { status: 'paid' });

// Delete (soft — syncs deletion to server)
GnokeStore.remove('invoices', id);

// React to changes (fires on every local write + server pull)
GnokeStore.onChange('invoices', records => renderTable(records));
```

---

## Account restore (lost device / forgotten PIN)

**What the engine provides:**
- `index.html` already includes the staff-facing **Restore screen** — staff enter their identifier, OTP, and new PIN. Nothing to build there.
- You are responsible for building the **admin generator tab** inside your `app.html` — a simple form that lets an admin pick a staff member, call the API, and read back the OTP to send on.

**The flow:**

1. Admin selects a staff member in your app and triggers OTP generation.
2. Your app calls `?action=generate-otp` — engine returns an 8-character code valid for 15 minutes.
3. Admin sends the OTP to staff (WhatsApp, SMS, etc.).
4. Staff opens `index.html`, selects Restore, enters identifier + OTP + new PIN.
5. Server issues a new token tied to the new device. Old device tokens still work until explicitly revoked.

**Admin generator — example call:**

```js
const res = await fetch(GNOKE_ENDPOINT + '?action=generate-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    admin_secret : 'your-admin-secret',  // from gnoke-config.php
    user_id      : 'staff-user-id'       // the user to restore
  })
});
const { otp } = await res.json();
// Display otp to admin — expires in OTP_TTL seconds (default 15 min)
```

> **Note:** `admin_secret` is server-side only. Never expose it in frontend code outside a role-protected admin view.

---

## Roles (optional)

Define in `gnoke-config.php`:

```php
define('ROLES', [
    'operator' => ['save', 'get', 'dispatch', 'updates'],
    'admin'    => ['*'],
]);
```

Role is set on the profile when a user registers. `'*'` means full access. Leave `ROLES` as `[]` to skip role checks entirely.

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `GnokeStore not loaded` | Script order wrong | Load `gnoke-store.js` before `gnoke-config.js` |
| `collection not defined` | Forgot `GnokeStore.define()` | Add it to `gnoke-config.js` |
| `workspace_id is not set` | Login didn't complete before a write | Write only after login resolves |
| `Invalid or revoked token` | Token expired or wiped | User needs to sign in again |
| `Bad admin secret` | Wrong `ADMIN_SECRET` | Check `gnoke-config.php` |
| `Cannot create database directory` | Server folder permissions | `chmod 750` the `gnoke-data/` folder |

---

## Reusing for a new client

1. Copy the entire project folder.
2. Edit `api/gnoke-config.php` — new `DB_PATH` (different filename), new `ADMIN_SECRET`.
3. Edit `gnoke-config.js` — new `GNOKE_ENDPOINT`.
4. Deploy.

Each client is a completely separate SQLite file. They share no data.
