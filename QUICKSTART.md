# 🚀 Gnoke Database — Quickstart Guide

**Your own offline-first record database.** For field clinics, farms, deliveries, classrooms — any app that needs reliable data storage without Firebase complexity.

---

## ⚡ 60-Second Deployment

1. **Open the Configurator**
   - Open `tool/g-configurator.html` in your browser
   - It's a one-file setup wizard — no installation needed

2. **Fill in 3 fields**
   - **API Endpoint**: `https://yourdomain.com/api/index.php`
   - **Registration Secret**: Something like `LAUNCH2026`
   - **Admin Secret**: Backend-only, e.g., `ADMIN_K3Y_S3CR3T`

3. **Download 3 files**
   - Copy the generated `connect.js` → your server's `scripts/` folder
   - Copy the generated `gnoke-config.js` → your server's `scripts/` folder
   - Copy the generated `gnoke-config.php` → your server's `api/` folder

4. **Upload & Open**
   - Upload `/api/` folder to your PHP host (must be writable)
   - Open `index.html` in a browser
   - Register with phone + PIN + registration secret
   - Done ✅

---

## 📦 What's Included

```
gnoke-database/
├── index.html                 ← Login screen (copy to web root)
├── scripts/
│   ├── connect.js            ← Auto-generated API bridge
│   ├── gnoke-config.js       ← Auto-generated app config
│   ├── main.js               ← Login logic (frozen)
│   ├── gnoke-store.js        ← Record storage (frozen)
│   ├── gnoke-sync.js         ← Offline sync (frozen)
│   └── gnoke-pull.js         ← Data pull (frozen)
├── api/
│   ├── index.php             ← Router (frozen)
│   ├── engine.php            ← Auth + identity (frozen)
│   ├── data.php              ← Records + sync (frozen)
│   └── gnoke-config.php      ← Auto-generated backend config
├── tool/
│   └── g-configurator.html   ← Setup wizard (this tool)
└── QUICKSTART.md             ← You are here
```

**"Frozen" = don't touch it.** Only edit config files.

---

## 🛠 How It Works

### Registration Flow
```
User enters phone + PIN + registration code
                ↓
Frontend sends to /api/index.php?action=register
                ↓
Backend stores user + PIN
                ↓
Backend issues session token
                ↓
Frontend saves token in localStorage
                ↓
Redirected to app page
```

### Data Storage
```
App saves record: GnokeStore.save('ledger', { item: 'Rice', amount: 5000 })
                ↓
Stored locally in IndexedDB (works offline)
                ↓
When online, syncs to server via /api/index.php?action=save
                ↓
Server stores in SQLite database (/gnoke-data/gnoke.db)
                ↓
Multiple devices sync automatically
```

---

## 📋 Configurator Fields Explained

### Shared Strip (All 3 Files)
- **API Endpoint**: Where your backend lives. Must match exactly.
- **Registration Secret**: Password to create accounts. Never expose this.
- **Admin Secret**: Backend-only. Used for admin tools (generate OTP, view users).

### Frontend Config (gnoke-config.js)
- **Workspaces**: Optional branches/locations. Leave empty if you don't need them.
- **Collections**: Define what data types your app stores.
  - `patient_visit` (scope: user)
  - `harvest` (scope: workspace)
  - `messages` (scope: company)

### Backend Config (gnoke-config.php)
- **Database Path**: Where SQLite stores records. Default: `/gnoke-data/gnoke.db`
- **OTP TTL**: How long restore codes last (default: 15 min)
- **Batch Limit**: Max records per sync request (default: 500)
- **Master Collections**: Server-owned data (price lists, route maps, etc.)
- **Payload Schemas**: Require specific fields before accepting a record (optional)
- **Roles**: Define what users can do (empty = all authenticated users pass)

---

## 🎯 Example: Build a Farm Ledger App

### Step 1: Configure
1. Open `tool/g-configurator.html`
2. Set API Endpoint: `https://farm.example.com/api/index.php`
3. Set Registration Secret: `HARVEST2026`
4. Add Collection:
   - Name: `harvest`
   - Scope: `workspace` (each farm branch)
5. Download all 3 files

### Step 2: Deploy Backend
1. Copy generated `gnoke-config.php` → upload to server's `/api/` folder
2. Ensure `/api/` is writable (DB auto-creates `gnoke-data/`)
3. Test: `curl https://farm.example.com/api/index.php?action=ping`
4. Should return: `{"ok":true,"version":"3.0.0","db":true,"time":"..."}`

### Step 3: Deploy Frontend
1. Copy `index.html` to web root
2. Copy generated `connect.js` to `scripts/` folder
3. Copy generated `gnoke-config.js` to `scripts/` folder
4. Upload all `/scripts/` files
5. Open `https://farm.example.com/index.html`

### Step 4: Use in Your App
Create an app page (`harvest.html`):
```html
<!DOCTYPE html>
<html>
<head>
    <script src="scripts/gnoke-config.js"></script>
    <script src="scripts/gnoke-store.js"></script>
</head>
<body>
    <h1>Daily Harvest Log</h1>
    <form onsubmit="saveHarvest(event)">
        <input id="crop" placeholder="Crop name">
        <input id="weight" type="number" placeholder="Weight (kg)">
        <button>Record Harvest</button>
    </form>
    <ul id="list"></ul>

    <script>
        // Start listening for changes
        GnokeStore.onChange('harvest', (records) => {
            document.getElementById('list').innerHTML = records.map(r =>
                `<li>${r.data.crop}: ${r.data.weight}kg</li>`
            ).join('');
        });

        function saveHarvest(e) {
            e.preventDefault();
            GnokeStore.save('harvest', {
                crop: document.getElementById('crop').value,
                weight: parseInt(document.getElementById('weight').value),
                date: new Date().toISOString().split('T')[0],
            });
            e.target.reset();
        }
    </script>
</body>
</html>
```

---

## 🔐 Security Basics

### Secrets
- **GNOKE_REG_SECRET**: Shared (frontend + backend). Protect it like a password.
- **ADMIN_SECRET**: Backend only. Never put in frontend code.

### Device Tracking
- Each device gets a unique ID stored in localStorage
- PIN is stored as that device ID
- Users can restore access with OTP if they lose their device

### Tokens
- Session tokens stored in localStorage (frontend)
- Tokens in database (backend), can be revoked
- No authentication = 401 response

---

## 🆘 Troubleshooting

### Registration Fails: "Invalid registration code"
- Verify `GNOKE_REG_SECRET` matches in both files
- Use configurator to regenerate both files if unsure

### "Cannot create database directory"
- Ensure `/api/` folder is writable on server
- Create `/api/gnoke-data/` manually if needed
- Check file permissions: `chmod 750 api/`

### No data syncing offline
- Open browser dev tools → Application tab
- Check that `gnoke_*` entries appear in localStorage/IndexedDB
- Check network tab in DevTools when going online

### Admin tools not working
- Verify `ADMIN_SECRET` header is correct
- Send as `X-Admin-Secret: YOUR_SECRET` in request headers

---

## 📚 API Reference

### Save a Record
```javascript
GnokeStore.save('ledger', {
    item: 'Rice',
    amount: 5000,
    vendor: 'Local supplier'
});
```

### Watch for Changes
```javascript
GnokeStore.onChange('ledger', (records) => {
    console.log('Records updated:', records);
    render(records);
});
```

### Get Specific Record
```javascript
const record = GnokeStore.get('ledger', 'record_id');
```

### Delete Record
```javascript
GnokeStore.delete('ledger', 'record_id');
```

### Manual Sync
```javascript
GnokeStore.sync();  // Push local changes to server
```

---

## 🚢 Production Deployment

### Before Going Live
1. **Change all secrets** (don't use examples)
2. **Move database outside web root** (set `DB_PATH` accordingly)
3. **Enable HTTPS** (required for production)
4. **Set strong admin secret** (use random string)
5. **Test OTP restore** flow with a real user
6. **Backup your database regularly** (SQLite file)

### Environment Variables (Optional)
Instead of hardcoding in `gnoke-config.php`:
```php
define('ADMIN_SECRET', getenv('GNOKE_ADMIN') ?: 'fallback');
```

### Database Backups
```bash
# Copy the SQLite database
cp api/gnoke-data/gnoke.db api/gnoke-data/gnoke.backup.db

# Or use SQLite CLI
sqlite3 api/gnoke-data/gnoke.db ".backup api/gnoke-data/gnoke.backup.db"
```

---

## 🎓 What Makes This Different from Firebase?

| Feature | Gnoke | Firebase |
|---------|-------|----------|
| **Setup** | Edit configs, upload files | Complex console, SDKs |
| **Cost** | Just hosting | Pay-per-read/write |
| **Offline** | Native (IndexedDB) | With offline SDK |
| **Data Control** | Fully yours | Google's servers |
| **For Juniors** | Simple config files | Steep learning curve |
| **Deployment** | Any PHP host ($5-15/mo) | $25+/mo minimum |

---

## 📞 Need Help?

- **Configurator not working?** → Open it in latest Chrome/Firefox
- **Database won't create?** → Check server write permissions
- **Phone/email conflict?** → Users are unique per phone or email, not both
- **Role errors?** → Check that role exists in ROLES config

---

## 🔧 Extending the Engine

The engine is already capable of storing any kind of record for any domain — parcels, patients, harvests, ledgers, inventory, bookings. You do not need to touch `index.php` to add new data types.

**Collections are defined in the configurator. The engine handles the rest.**

### Adding a New Collection

1. Open `tool/g-configurator.html`
2. Add your collection under **Collections** — name it and set its scope (`user`, `workspace`, or `company`)
3. Optionally add a **Payload Schema** to enforce required fields
4. Optionally add a **Role** to control who can read/write it
5. Download and redeploy `gnoke-config.js` and `gnoke-config.php`

That's it. No backend code changes. No touching `index.php`.

```js
// Your app immediately has access to the new collection
GnokeStore.save('bookings', {
    customer : 'Amara Osei',
    date     : '2026-06-01',
    service  : 'Delivery',
});

GnokeStore.onChange('bookings', render);
```

### The Only Rules

**1. Never edit the frozen files.**
`engine.php`, `data.php`, `gnoke-store.js`, `gnoke-sync.js`, `gnoke-pull.js`, and `main.js` are frozen. If you feel the need to edit one, the answer is almost always a config change in the configurator instead.

**2. Never hardcode the endpoint.**
`GNOKE_ENDPOINT` is defined once in `gnoke-config.js` by the configurator. Every frontend file — including any admin panel you build — must load `gnoke-config.js` first and reference `GNOKE_ENDPOINT` directly.

```html
<!-- Always load this first -->
<script src="../scripts/gnoke-config.js"></script>
```

```js
// Correct
const _API = GNOKE_ENDPOINT;

// Wrong — breaks on every redeployment
const _API = 'https://yourdomain.com/api/index.php';
```

**3. The configurator is the single source of truth.**
Secrets, endpoint, roles, schemas, workspaces — all defined once in the configurator and pushed to exactly two files: `gnoke-config.php` and `gnoke-config.js`. Never manually maintain config values across files.

### What the Engine Already Gives You

| Action | Protection | What it does |
|--------|-----------|--------------|
| `register` | Public | Create user account |
| `sign-in` | Public | Authenticate + issue token |
| `redeem-otp` | Public | Restore access via OTP |
| `generate-otp` | Admin secret | Issue invite/restore code |
| `revoke-token` | Admin secret | Deactivate a device |
| `admin-profiles` | Admin secret | List all users |
| `admin-tokens` | Admin secret | List active devices |
| `admin-records` | Admin secret | Browse all collections |
| `save` | Token + role | Write a record |
| `get` | Token + role | Read records |
| `delete` | Token + role | Soft-delete a record |
| `dispatch` | Token + role | Push local queue to server |
| `updates` | Token + role | Pull changes from server |

Any collection you define in the configurator is immediately accessible through these actions — no new backend code required.

## ✅ You're Ready!

1. Open `/tool/g-configurator.html`
2. Fill in your domain + secrets
3. Download the 3 files
4. Upload to your server
5. Register your first user
6. Start recording data

**That's it. No Firebase, no complexity. Just records.** 🎉

---

*Gnoke Database v3 — Frozen core for field operations. Made for unreliable networks and junior developers.*
