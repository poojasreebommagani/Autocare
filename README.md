# AutoCare — Vercel deployment package

This package contains the AutoCare HTML/CSS/JavaScript frontend and Node.js/Express/MySQL backend, including the admin estimate approval flow and service-charge calculations.

## Project files

- `server.js` — Express API; exports the app for Vercel and runs locally with `npm start`.
- `public/index.html`, `public/app.js`, `public/styles.css` — frontend.
- `database/autocare.sql` — fresh database schema, starter services, and additional services.
- `database/existing_database_add_services.sql` — add services to an existing database.
- `vercel.json` — routes requests through the Express serverless function and includes frontend files.
- `.env.example` — environment-variable names only; do not commit real credentials.

## Important: Vercel needs a cloud database

Vercel cannot connect to MySQL installed only on your own computer at `localhost`. Use a reachable managed MySQL provider (for example, a MySQL service from Railway or Aiven) and make sure its network/access rules allow connections from your deployment. Copy the provider's host, port, database name, username, and password into Vercel Environment Variables.

## Deploy from GitHub to Vercel

1. Extract this ZIP into a folder.
2. Open the folder in VS Code and verify it contains `server.js`, `package.json`, `vercel.json`, and the `public` and `database` folders.
3. Create a GitHub repository and upload all project files. Do **not** upload `.env`, database passwords, or `node_modules`.
4. In your cloud MySQL provider, create a database and run `database/autocare.sql` in a SQL client. For an existing AutoCare database, do not re-run the whole schema blindly; see the existing-database instructions below.
5. In Vercel, choose **Add New → Project**, import the GitHub repository, and deploy from the project root. Framework preset can be **Other**; the included `vercel.json` configures the Node function.
6. Before or immediately after the first deployment, open **Project → Settings → Environment Variables** and add:
   - `DB_HOST` — cloud database host, not `localhost`
   - `DB_PORT` — usually the provider's port, often `3306`
   - `DB_USER` — database username
   - `DB_PASSWORD` — database password
   - `DB_NAME` — database name, e.g. `autocare_db`
   - `JWT_SECRET` — a long random secret (at least 32 characters)
   - `JWT_EXPIRES_IN` — `8h` (optional)
7. Add variables for **Production**, and for Preview/Development too if you plan to use those environments. Redeploy after changing environment variables.
8. Open `https://YOUR-VERCEL-DOMAIN/api/health`. It should return JSON similar to `{"status":"ok","app":"AutoCare"}` if the function is running. Then test registration/login and the admin estimate approval flow.

## Existing database migration

If you already have an AutoCare database and have already added `service_cost` to both `estimates` and `invoices`, do not add those columns again. Run `database/existing_database_add_services.sql` to add the extra service options. If the cloud database is new, run the complete `database/autocare.sql` instead.

## Make an admin account

Register an account in the app, then execute the following in your database SQL client, replacing the email:

```sql
USE autocare_db;
UPDATE users SET role='admin' WHERE email='your-email@example.com';
SELECT id, name, email, role FROM users WHERE email='your-email@example.com';
```

Log out and log in again after changing the role.

## Local Windows development

1. Install Node.js 18 or later and MySQL.
2. Copy `.env.example` to `.env` and enter your local database values.
3. Run `npm install`.
4. Run `npm start`.
5. Visit `http://localhost:5000`.

## Notes and troubleshooting

- `localhost` in Vercel environment variables points to the Vercel function itself, not your laptop. Use your cloud database hostname.
- If `/api/health` works but database-backed pages fail, check the Vercel function logs and verify DB credentials, TLS/network settings, and that the schema has been imported.
- If Vercel shows a 404 for frontend files, check that `public/index.html`, `public/app.js`, and `public/styles.css` were committed and that deployment used the repository root.
- The app records payment entries for demonstration; it does not process real card or UPI payments.


## Enhanced appearance and extra services

- The interface now uses a premium black-and-orange palette with subtle gradients and card animations.
- No car photo or external background image is used; the background is CSS-only.
- Extra service options are included in `database/existing_database_add_services.sql`. Run that script once in MySQL Workbench against the existing `autocare_db` database. `INSERT IGNORE` prevents duplicate service names.
- Added services include engine oil/filter change, brake pad replacement, coolant flush, transmission fluid change, suspension inspection, tyre replacement, wiper replacement, dent removal, windshield glass treatment, hybrid/EV diagnostics, pickup/drop-off, and pre-purchase inspection.

### Apply to an existing project
1. Back up your current project folder.
2. Extract this ZIP into a new folder first, then copy/merge the updated files.
3. Run `database/existing_database_add_services.sql` in MySQL Workbench.
4. Restart the server with `node server.js` and refresh the browser with `Ctrl + F5`.
