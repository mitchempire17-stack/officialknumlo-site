# KNUMLO: quick start (about 15 minutes, no coding)

This one project contains the website, the officials portal, the API and the database setup. Three free accounts make it run: GitHub, Neon (database) and Netlify (hosting).

1. **Database.** Create a free project at neon.tech and copy its connection string (starts with `postgresql://`).
2. **GitHub.** Create a private repository and upload everything in this folder (extract the ZIP first, then drag the files and folders in). In the repository open *Settings, Secrets and variables, Actions* and add four secrets: `DATABASE_URL` (from step 1), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters) and `ADMIN_NAME`. Then open the *Actions* tab, choose *Set up database* and click *Run workflow*. This creates every table and your administrator login automatically.
3. **Netlify.** Choose *Add new site, Import an existing project*, pick the repository, and deploy. Then add the settings from the table in section 3 below (database address, secret keys, Paybill number) and redeploy.

Your site is then live, and officials sign in at `/admin` with the email and password from step 2.

If the hidden `.github` folder does not upload, create the file `.github/workflows/setup-database.yml` through *Add file, Create new file* and paste in its contents from the ZIP. Or skip it and paste `database/all.sql` into Neon's SQL Editor instead.

---

# KNUMLO on Netlify

One project holds the website (`site/`), the API (`server.js`, run as a Netlify Function), and the database scripts (`database/`). Netlify does not provide a database, so the data lives in a free hosted PostgreSQL (Neon is used below; Supabase also works).

## 1. Create the database

1. Create a free account and project at Neon (neon.tech). Copy the **connection string** (it starts with `postgresql://`).
2. Open Neon's SQL Editor, paste the whole of `database/all.sql` and run it. (Or from a computer with psql: `psql "<connection string>" -f database/all.sql`.)
3. Create the first official in the SQL Editor (change the name, email and password):
   ```sql
   INSERT INTO staff_users (full_name, email, password_hash, role)
   VALUES ('Your Name', 'you@knumlo.or.ke', crypt('A-long-password-here', gen_salt('bf', 12)), 'super_admin');
   ```
   Roles: `super_admin`, `secretary` (approves members), `treasurer` (payments), `branch_officer`, `viewer`.

Do **not** run `04_demo_data.sql` on the real database.

## 2. Put the project on Netlify

Use one of these. (Dragging a folder onto Netlify Drop may publish only the website and skip the API, so use Git or the CLI.)

- **Git (recommended):** upload this folder to a private GitHub repository. In Netlify choose *Add new site, Import an existing project*, pick the repository. The settings are read from `netlify.toml`, so just deploy.
- **CLI:** install Node, then `npm i -g netlify-cli`, `netlify login`, `netlify init`, and `netlify deploy --prod`.

## 3. Add the settings

In Netlify: *Site configuration, Environment variables*. Add these, then **redeploy**.

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `PGSSL` | `true` |
| `JWT_SECRET` | a long random string |
| `MPESA_CALLBACK_SECRET` | another long random string |
| `PAYBILL_NUMBER` | your Paybill number |
| `PUBLIC_SITE_URL` | your site address, e.g. `https://knumlo.netlify.app` |
| `PUBLIC_API_URL` | the same address |
| `CORS_ORIGINS` | the same address |
| `SMS_PROVIDER` | `log` until Africa's Talking is set up, then `africastalking` with `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` |
| `DARAJA_ENV`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY` | leave empty for now (M-Pesa runs in mock mode) |

## 4. Check it

- Open `https://your-site/api/health`. You should see `{"ok":true}`.
- On the site, click **Member**, choose *KNUMLO official* and log in with the account from step 1.

## 5. Officials portal (your backend landing page)

Open `https://your-site/admin`. It is not linked from the public site and search engines are told to ignore it.

Sign in with the official's email and **admin verification password**. These are the account details created in the database (step 1 above); the password is stored scrambled, never as plain text. To add more officials, insert more rows into `staff_users` with the SQL from step 1, choosing a role for each.

| Role | Can do |
|---|---|
| `super_admin` | Everything, including the audit log |
| `secretary` | Members, approvals, import, member downloads, payments view |
| `treasurer` | Members (view), payments, matching Paybill payments, payment downloads |
| `branch_officer` | View members |
| `viewer` | Progress charts and totals only (no personal details) |

Pages: **Progress** (registered, approved, pending, collection, charts by day, sector and county, data quality), **Members** (search, filter, approve or reject), **Payments**, **Downloads** (CSV files that open in Excel; every download is logged), and **Import data**.

To make the members you already collected visible: sign in, open **Import data**, upload the Google Form responses as CSV. They appear under **Members** as pending, ready for approval.

## 6. Real M-Pesa

1. Get your Daraja credentials and fill the `DARAJA_*` settings, then redeploy.
2. Register the Paybill confirmation address once, from your computer: put the same settings in a local `.env` file and run `node scripts/register-c2b-urls.js`.
3. Safaricom's live approval for a production Paybill is arranged with them and can take time.

## 7. Loading the existing members (command line alternative)

Run `python3 database/import_registrations.py registrations.csv`, review `import_report.csv`, then run the generated `import_members.sql` in Neon. See `database/README.md` for the full process.

## Good to know

- Passwords are never stored in plain text. Members set theirs from an SMS link sent after approval. Until real SMS is set up, those links only appear in Netlify's function logs.
- A scheduled function creates each month's dues invoices daily (it only adds missing ones).
- Netlify functions have a short time limit and free-plan usage limits. This suits a union of this size, but watch usage as it grows.
- Login attempt limits are kept per running function instance, so they are weaker than on a dedicated server. Accounts also lock after repeated wrong passwords.
- Turn on Neon's automatic backups and keep the connection string secret.
