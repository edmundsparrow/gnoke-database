# GnokeDatabase v3 (Street-Beta)

**GnokeDatabase** is a raw, offline-first record storage engine built for unreliable networks, low-spec devices, and real-world field operations.

This repository is currently a **Street-Beta** release. It contains the frozen core engine, sync modules, and API handlers exactly as they are deployed.

> **Documentation will take shape as tests and edge cases unfold. For now, the code is the truth.**
>
> If you need a polished managed ecosystem, use Firebase. If you need a frozen, local-first core you can deploy on a cheap PHP host, you're in the right place.

---

## ⚡ Philosophy

- **Offline-First** → writes happen instantly on-device
- **Frozen Core** → engine modules stay stable across deployments
- **Identity Scoped** → Company → App → Workspace → User
- **Vanilla Stack** → Pure JS, PHP, and SQLite

---

## 📁 Structure

```text
/api        ← PHP + SQLite backend
/scripts    ← Frozen frontend modules
/app        ← Example app
/tools      ← Setup helpers
```

---

## 🚀 Deployment

### 1. Upload `/api`

Ensure the directory is writable. SQLite is created automatically.

### 2. Configure the Lock & Key

Edit only:

- `api/gnoke-config.php`
- `scripts/gnoke-config.js`

Set matching:

- `GNOKE_REG_SECRET`
- `GNOKE_ENDPOINT`

### 3. Perform the Handshake

Open `index.html` and register.

If `gnoke-data/` appears on the server, the engine initialized successfully.

---

## 🛠 Developer Contract

```js
GnokeStore.define('ledger', {
  scope: 'user'
});

GnokeStore.onChange('ledger', render);

GnokeStore.save('ledger', {
  title: 'Rice',
  amount: 5000
});
```

Writes happen locally first.

The Courier handles sync automatically in the background.

---

## 🔄 Example Record Shape

| Record ID | Collection | Workspace | User ID | Data (JSON) |
|---|---|---|---|---|
| r_abc123 | ledger | branch_01 | user_99 | {"title":"Rice","amount":5000} |

---

## ⚖️ License

MIT License — Copyright (c) 2026 Edmund Sparrow (Gnoke)

