# Cheque Collection

A web app for collecting customer cheques. It works in any browser on PC and phone,
and can be added to a phone's home screen like an app.

- **Frontend:** React (Vite), hosted on Netlify
- **Database, login and photo storage:** Supabase
- **No server to run.** Permissions and workflow rules live in the database (`supabase/schema.sql`).

## How it works

| Step | Who | What happens | Status after |
|---|---|---|---|
| 1 | Customer → Sales | Customer says the cheque is ready (outside the app) | |
| 2 | Sales | Picks the customer, ticks the open invoices being settled (or types settlement instructions), confirms the amount, address and map pin | With finance |
| 3 | Finance | Assigns a driver and a collection date | To collect |
| 4 | Driver | Photographs each cheque, confirms or corrects the amount. If the total differs, finance and sales are notified | Collected |
| 5 | Finance | Confirms the physical cheques were handed over | To deposit |
| 6 | Driver (or finance) | Deposits and photographs the deposit slip | Deposited |
| 7 | Finance | Verifies the deposit and closes, or sends it back | Closed |

The driver can also report **"Couldn't collect"**, which returns the job to finance to rearrange.
Finance can cancel any open collection; sales can cancel their own before a driver is assigned.

**Who sees what:** finance sees everything, sales sees collections they recorded, drivers see
collections assigned to them.

**Customer data:** sales or finance upload two Business Central exports on the Customer data
page: the Customer list and the open Customer Ledger Entries (Share → Open in Excel, uploaded
unchanged). The customer list feeds the searchable dropdown; the ledger feeds the open-invoice
picker. Each ledger upload replaces the previous one, so export all customers with Open = Yes.
A collection keeps a copy of the invoices it settles, so later uploads never change it.
Invoices already on another open collection are greyed out. The customer's address and map pin
are remembered from their last collection.

**Photos:** compressed on the phone before upload (~200 KB each) and stored in a private bucket.
Under **Photo storage**, finance picks finished collections, downloads a zip backup (photos plus
`cheques.csv`), and only then can delete the photos. Cheque details are never deleted.

## One-time setup (about 20 minutes)

### 1. Supabase

1. Create a free account at supabase.com → **New project**. Pick the Mumbai or Singapore region
   (closest to Sri Lanka). Save the database password somewhere safe.
2. Open **SQL Editor → New query** and run the database scripts in order (schema, then
   002_customers_and_invoices). The scripts are kept outside this folder; ask for them if needed.
3. **Authentication → Sign In / Providers → Email:** keep Email enabled. Turn **off**
   "Allow new users to sign up" so only people you add can get in.
4. **Authentication → URL Configuration:** once Netlify gives you a site address (step 3),
   set **Site URL** to it (for example `https://oceanpick-cheques.netlify.app`) and add the same
   address under **Redirect URLs**. Sign-in links in emails go there.
5. **Project Settings → API:** copy the **Project URL** and the **anon / publishable key**.
   (Never use the `service_role` / secret key in this app.)

### 2. GitHub

Create a new private repository and upload this folder's contents to it
(GitHub → Add file → Upload files works fine; `node_modules` and `dist` are not needed).

### 3. Netlify

1. netlify.com → **Add new site → Import an existing project** → choose the GitHub repo.
   The build settings are read from `netlify.toml`; nothing to change.
2. Before deploying, open **Site configuration → Environment variables** and add:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key
3. **Deploy.** Then optionally rename the site under **Site configuration → Change site name**,
   and put that address into Supabase (step 1.4).

### 4. People

1. Supabase → **Authentication → Users → Add user → Create new user**. Enter the email and a
   starting password, tick **Auto confirm user**. Do this for yourself first:
   **the first user ever created becomes finance automatically.**
2. Add everyone else the same way. They appear in the app under **People** with "No access";
   finance gives each one a role (Sales, Driver or Finance) and clicks **Save**.
3. Each person can change their password under **Account**, and can install the app on their
   phone (Android: Chrome ⋮ menu → Add to Home screen; iPhone: Safari Share → Add to Home Screen).

## Updating the app

Change files in the GitHub repo; Netlify rebuilds automatically within a minute or two.
Database changes are made by running SQL in the Supabase SQL Editor.

## Running it on your own computer (optional)

```
npm install
cp .env.example .env      # then fill in the two values
npm run dev
```

## Good to know

- **Free-tier limits.** Supabase's free plan pauses a project after 7 days with no activity
  (daily use prevents this) and includes 1 GB of file storage (roughly 5,000 compressed photos).
  For a tool the business relies on, the Pro plan (about USD 25/month) removes the pausing and
  adds daily database backups.
- **Maps** use OpenStreetMap (free, no key). Address search uses OpenStreetMap's Nominatim,
  which is fine for occasional lookups. The **Directions** button opens Google Maps on the phone.
- **Notifications** appear inside the app (the bell). There are no emails or WhatsApp messages yet.
- **Database backups:** the photo zip backs up images only. On the Pro plan Supabase backs up the
  database daily; on the free plan, export tables from **Table Editor** now and then.

## Files

```
src/lib/bcimport.js     Reads Business Central Excel exports
src/pages/CustomerData.jsx     Upload customer list and open invoices
src/lib/                Supabase client, sign-in, workflow labels, formatting, photo compression
src/pages/List.jsx      Collections list (For you / Open / Closed, search)
src/pages/CollectionForm.jsx   New and edit (step 2)
src/pages/Detail.jsx    One collection: slip, progress, map, cheques, deposit, history
src/pages/actions.jsx   Step panels: assign, collect, receive, deposit, close, cancel
src/pages/Photos.jsx    Backup and delete photos (finance)
src/pages/Users.jsx     Roles and access (finance)
```

## Demo section

The header has a **Live / Demo** switch. Demo is a complete, separate copy of the database
(schema `demo`) and photo storage (bucket `cheques-demo`): every page works the same, and
nothing done there reaches live. People and passwords are shared.

Set up once, in order: `004_multi_line_slips.sql`, `005_demo_schema.sql`, then in Supabase
Project Settings → Data API → Exposed schemas add `demo` and save, then `006_demo_september_data.sql`.
Running 006 again resets the demo to its September starting point.

To remove the demo completely: `drop schema demo cascade;` and delete the `cheques-demo` bucket.
