# Connect Smart Q to Supabase

Without these steps the app runs in demo mode (any code works). Follow them to turn on real login.

## 1. Create the project
1. Go to supabase.com, create a project, and wait until it is ready.
2. Open **SQL Editor**, paste `supabase/schema.sql`, and run it. This creates profiles, shops, tickets, subscriptions, saved shops, and the security rules.

## 2. Email login with a code
Smart Q sends a 6 digit code. By default Supabase emails a link, so edit the template:
1. **Authentication > Emails > Magic Link** (and **Confirm signup**).
2. Make sure the body shows the code: `Your Smart Q code is {{ .Token }}`.
3. Under **Authentication > Providers > Email**, keep email enabled. Set the OTP length to 6.
4. The built in email sender has a low hourly limit. For real use add your own SMTP provider.

## 3. Redirect URLs
**Authentication > URL Configuration**: set **Site URL** to your live address, for example `https://YOUR-USERNAME.github.io/YOUR-REPO/`, and add the same address (and `http://localhost:3000`) under **Redirect URLs**.

## 4. Optional: Google and phone login
- **Google**: Authentication > Providers > Google. Create OAuth credentials in Google Cloud and paste the client ID and secret. Add the Supabase callback URL it shows.
- **Phone codes**: Authentication > Providers > Phone needs an SMS provider (for example Twilio) and costs money per message. Email works without it.

## 5. Put the keys in the app
Open `js/config.js` and fill in:
```
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "your anon / publishable key"
```
Find both in **Project Settings > API**. The anon key is meant to be public. **Never** put the `service_role` key in this app, and never commit it to GitHub.

## 6. Check it works
1. Serve the folder (`npx serve .`) and open it.
2. Customer: enter your email, tap **Send code**, type the 6 digit code, tap **Verify and Log In**.
3. Shop: choose **I run a shop**, tap **New shop? Create account**, make an account, confirm the email, then log in.
4. In Supabase **Table Editor > profiles** you should see both users, one with role `shopkeeper`.

## What is real now and what is next
- Real: sign up and log in, sessions that survive a reload, customer and shop roles, name and contact saved to the account, delete my account.
- Next: the queue, tickets, saved services and subscription still run on this device. The database functions for them are ready (`join_queue`, `call_next`, `leave_queue`); the next step is to call them from the app and subscribe to realtime changes.
- Payments: the subscription is a demo. Connect Razorpay and update `subscriptions` from a server webhook using the service role key (on the server only).
