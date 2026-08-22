# Oshin Capital — Compliance Portal (project report generator)

Free to run: static frontend + tiny serverless functions, both on Vercel's
free tier. No server to rent, no monthly hosting bill.

## What's free vs. not

| Piece | Cost |
|---|---|
| Hosting (Vercel free tier) | ₹0 |
| Serverless functions (payment verify, admin check) | ₹0 (well within free tier limits for this traffic) |
| UPI direct transfer | ₹0 — but verification is manual (you confirm each UTR by hand) |
| Razorpay checkout | ~2% per transaction — this is Razorpay's fee, unavoidable if you want automatic online payment. Nothing upfront or monthly. |

---

## 1. Get the code onto GitHub

1. Create a new **private** GitHub repo, e.g. `oshin-compliance-portal`.
2. Push everything in this folder to it.

```bash
cd oshin-compliance-portal
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/oshin-compliance-portal.git
git push -u origin main
```

## 2. Deploy to Vercel (free)

1. Go to vercel.com → sign up/log in with GitHub.
2. **Add New → Project** → import the repo you just pushed.
3. Framework preset: Vite (should auto-detect). Leave build settings default.
4. Before clicking Deploy, add environment variables (Project Settings →
   Environment Variables) using `.env.example` as the guide:
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your Razorpay
     dashboard → Settings → API Keys. Use **live** keys when you're ready to
     take real payments; use **test** keys while trying it out.
   - `ACCESS_TOKEN_SECRET` — any long random string (command in the file).
   - `ADMIN_CODE` — your super-admin passphrase.
5. Click **Deploy**. You'll get a free `*.vercel.app` URL immediately.

## 3. Point compliance.oshin-capital.com at it

1. In Vercel: Project → Settings → Domains → add `compliance.oshin-capital.com`.
2. Vercel gives you a DNS record to add (usually a `CNAME` to
   `cname.vercel-dns.com`, or an `A` record if it's a root domain).
3. Add that record wherever `oshin-capital.com`'s DNS is managed (your
   domain registrar or DNS provider). Propagation is usually minutes to a
   couple of hours.
4. Vercel issues a free HTTPS certificate automatically once DNS resolves.

No cost at any step here — domain DNS changes are free; you're only paying
for the domain itself, which you already own.

## 4. Test before going live

- Use Razorpay **test mode** keys first. Razorpay's test cards:
  `4111 1111 1111 1111`, any future expiry, any CVV.
- Try the UPI path too — submit a fake UTR and confirm you see it (check
  your Vercel function logs, or wherever you wired `NOTIFY_WEBHOOK_URL`).
- Try the admin code and confirm it unlocks without payment.
- Only then swap in **live** Razorpay keys.

## Important limitations to know about

- **UPI verification is manual.** There's no free way to auto-confirm a UPI
  transfer landed in your account — that requires a paid bank-statement API.
  Budget a few minutes per user to check your bank app and reply with
  access. If volume grows, this is the first thing worth automating (paid).
- **Report generation still happens in the browser** (the Excel export via
  SheetJS, the PDF via print-to-PDF). The access gate stops people from
  *seeing the form*, but someone determined could still inspect the page
  and call those functions directly. For real enforcement at scale, move
  report generation itself into a serverless function that checks the
  access token before returning a file — happy to build that next if this
  tool starts seeing real traffic.
- **The admin code is a single shared secret**, not individual logins. Fine
  for one person (you); if more than one person needs admin access, this
  should become real accounts with passwords, which is a bigger change.
- **The PDF "print" button** relies on the visitor's browser print dialog —
  works in a normal browser tab (this concern was specific to previewing
  inside Claude's sandboxed artifact viewer, not to the deployed site).
