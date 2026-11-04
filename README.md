# AVE Staff Records

Private website for Grupo AVE employee files: documents (INE, CURP, NSS, contracts, DC-3), safety-training expiry warnings and birthday reminders. One admin login. No AI is used when it runs.

## Deploy on Render (about 10 minutes)

1. **Put the code on GitHub.** Create a new **private** repository on github.com (for example `ave-staff-records`). Click "uploading an existing file", drag in everything from this folder, and commit.
2. **Create the service on Render.** In the Render dashboard click **New → Blueprint**, connect your GitHub account if asked, and pick the repository. Render reads `render.yaml` and sets up:
   - a **Starter** web service (paid; the free plan can't keep files),
   - a **1 GB persistent disk** at `/var/data` where the records and documents are kept,
   - the settings below.
3. **Enter the password.** Render asks for `ADMIN_PASSWORD`. Type the password you want for the first sign-in. It is stored only in Render, not in the code. The username is `admin`.
4. Click **Apply**. When the deploy turns green, open the `https://ave-staff-records-xxxx.onrender.com` address Render shows, sign in, and use **Change password** to set your own.

Optional: in the service's **Settings → Custom Domains** you can point something like `personal.gpoave.com` at it.

## Settings (Environment tab)

| Setting | What it does |
|---|---|
| `ADMIN_USER` | Username. `admin` by default. |
| `ADMIN_PASSWORD` | Password used the **first** time the app starts. After that, the app keeps its own (scrambled) copy, so changing it in the app is what counts. |
| `SESSION_SECRET` | Random value Render generates. Keeps sign-ins secure. Don't share it. |
| `DATA_DIR` | `/var/data`, the persistent disk. |
| `RESET_PASSWORD` | Forgot the password? Set this to `1`, put a new `ADMIN_PASSWORD`, redeploy, sign in, then **delete** `RESET_PASSWORD` and redeploy again. |

## Security

- The password is checked on the server and stored scrambled (scrypt), never as plain text.
- Documents are kept on the disk outside the website folder and only open after signing in.
- 5 wrong passwords lock that connection out for 15 minutes.
- Sessions last 12 hours. Changing the password signs out every other device.
- Pages are marked so search engines don't index them.

## Files

- Accepted: PDF, JPG, PNG, WEBP up to 20 MB. Save Word files as PDF first.
- 1 GB holds roughly 1,000–3,000 scanned documents. You can enlarge the disk in Render at any time (it can't be shrunk).
- `db.json` on the disk holds all records; `db.json.bak` is the previous version.

## Run on your own computer (optional)

```
npm install
SESSION_SECRET=any-long-random-text ADMIN_USER=admin ADMIN_PASSWORD=your-password node server.js
```
Then open http://localhost:3000. Data goes to the `data/` folder.
