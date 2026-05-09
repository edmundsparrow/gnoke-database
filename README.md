# Gnoke-Database: Firebase in your pocket.

Every indie developer knows the moment.

You build something real. People start using it. Then you open your Firebase console and see the bill growing — and you realise you don't own any of it. Your users' data lives on someone else's machine. Your app's survival depends on a pricing page you didn't write.

I built the exit door.

---

**What Gnoke-Database is:**

It is a complete backend engine — collections, auth, offline sync, roles, identity isolation, OTP recovery — that runs on any PHP host with SQLite.

Not a cloud service. Not a monthly subscription. A folder you upload once.

The cheapest shared host you can find. The one that costs less than your data bill. That host is now your Firebase.

---

**What it actually does:**

Your app saves records locally first. Always. No network required. When the connection returns, Gnoke pushes the queue silently. When a teammate makes a change on their device, Gnoke pulls it down. Your UI reacts. Nobody waited. Nobody lost data.

This is not a workaround. This is how it should have worked from the beginning.

Collections are scoped automatically — per user, per branch, per company — without you writing a single access rule by hand. The identity chain handles it. Same user, different app: separate data. Same app, different branch: separate data. No accidental bleed. Ever.

Roles are defined once in a config file and enforced on every request. Operators save and sync. Managers delete. Admins touch everything. You write the rule once. Gnoke enforces it everywhere.

Staff changes device. Forgets PIN. OTP recovery re-establishes the chain in under a minute. No data lost. No admin panic.

---

**The number that matters:**

Firebase charges by reads, writes, and storage — and the meter runs whether you're watching or not.

Gnoke-Database runs on SQLite. One file on your server. The bill is your hosting fee. Fixed. Predictable. Yours.

One deployment serves your entire company. Multi-tenant mode gives every client their own isolated database file — same server, zero bleed, independent backups.

---

**What this is not:**

This is not a Firebase killer for Google-scale infrastructure. If you are serving 50 million concurrent users across five continents, you have different problems.

This is for the courier startup in Lagos. The school management system in Accra. The inventory app a developer built for a family business. The SaaS that doesn't need a San Francisco budget to survive.

Most apps are over-engineered by default — hosted on infrastructure designed for companies a hundred times their size, paying for headroom they will never use.

Gnoke-Database is the right size. Deployable in an afternoon. Owned completely.

---

**The philosophy in one line:**

Your backend should live on your terms — not on a pricing page you didn't write.

---

*Gnoke-Database — MIT License. Your own Firebase, on your own server.*

https://github.com/edmundsparrow/gnoke-database

#GnokeDatabase #LocalFirst #Firebase #IndieHacker #SovereignTech #VibeEngineering

Your own Firebase. Self-hosted, offline-first, zero dependencies.

if i can breathe i can think if i can think i can win
