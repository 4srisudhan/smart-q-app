# Smart Q prototype

Interactive front-end prototype of Smart Q, a smart queue management app.
Tagline: Skip the Wait. Smart Q Knows Your Turn.

## What is inside

- Splash, role selection, separate customer and shopkeeper logins
- Customer: home, select service, digital token, live queue tracking, notifications, profile
- Profile photo upload and name change (saved in the browser only)
- Live map with distance and travel time (walk, bike, car), schematic view
- QR scan to join a queue (camera, photo, or shop code)
- Shop dashboard: call next, add walk-in, pause queue, average service time, queue QR code
- The shop dashboard and the customer screens share one queue in this demo, so
  "Call Next" updates the customer's place, wait time and alerts
- Profile: My Queue History (with Join again), Saved Services, Account Settings (name, contact, theme, travel mode, alerts), Subscription, Security & Privacy (permissions, delete my data), Terms of Service, Help
- Home search and category buttons filter the service list
- Subscription: 3 day free trial, then 25 INR per month. Premium covers the live map, leave on time reminders and turn alerts
- Distance and travel time from the user location on service cards, home and the token screen
- Privacy Policy and Terms of Service pages

## Docs

- `docs/Smart-Q-Pitch-Deck.pptx`: pitch deck
- `docs/ROADMAP.md`: plan for turning the prototype into a real app
- `docs/SUPABASE_SETUP.md`: step by step guide to turn on real login
- `supabase/schema.sql`: database tables and security rules

## Real login (Supabase)

Customers sign in with a 6 digit code sent to their email (phone codes and Google are optional). Shopkeepers use email and password and can create a shop account. Roles are stored on the server and the app blocks customers from the shop dashboard.

## Run it

Open `index.html` in a browser. For camera and location use a local server or
https (GitHub Pages works):

```
npx serve .
```

## Folder structure

```
index.html
css/styles.css
js/app.js
assets/logo.png, favicon-64.png, apple-touch-icon.png
assets/qr/GH01.svg ... RS05.svg   (printable shop QR codes, text: smartq:join:<CODE>)
```

## Not production yet

- Data is sample data in `js/app.js` (objects `D`, `MS`, `QS`). Replace with Supabase.
- The subscription is a demo and no money is charged. Connect a payment gateway (for example Razorpay with UPI) and keep trial and plan dates in Supabase, checked on the server.
- Real login is built in but off until you fill `js/config.js` (see `docs/SUPABASE_SETUP.md`). Until then the app runs in demo mode and any code works.
- Sharing one queue across devices needs Supabase Realtime.
- The map is a schematic drawing. Use a real map provider and a routing API.
- QR scanning uses the browser BarcodeDetector, with the jsQR library as a fallback.
- The Privacy Policy and Terms text in `js/app.js` is a template. Have a lawyer review it.
- Confirm the contact email and company name in the legal text before launch.
- Replace the sample name and email before launch.
