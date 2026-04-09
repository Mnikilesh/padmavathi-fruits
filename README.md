# 🍎 Padmavathi Fruits Company — Web App v4

A full-stack serverless web app for fresh fruit delivery in Warangal, Telangana.
Built on **Netlify Functions** + **MongoDB Atlas** + **Cloudinary**.

---

## ✨ What's New in v4

| Feature | Detail |
|---|---|
| GPS Checkout | Custom in-app popup → OSM reverse-geocode fills address automatically |
| Driver Login | Separate `/driver-login` portal, role-checked endpoint `/api/driver/auth/login` |
| Atomic Order Accept | `findOneAndUpdate({assignedDriver:null})` prevents two drivers claiming same order |
| On-Duty Toggle | Driver can go ON/OFF duty; off-duty drivers don't appear in dispatch |
| Order Reject | Driver can skip an order — it stays visible to other drivers |
| Real-Time Polling | Driver dashboard polls every 5s; vibrates on new order (mobile) |
| Live Location Push | Driver app sends GPS every 30s → stored on order → user can track |
| User Tracking | "On the Way" orders show "Track Driver Live" Google Maps link |
| Admin GPS Panel | Active deliveries show both customer pin and current driver location |

---

## 🚀 Quick Start

```
1_INSTALL.bat      → npm install
2_CONFIGURE.bat    → copy .env.example → .env, fill in values
3_VAPID.bat        → generate push notification keys
4_RUN_LOCAL.bat    → netlify dev  (local dev server on :8888)
5_DEPLOY.bat       → netlify deploy --prod
```

---

## 🔑 Environment Variables

Copy `.env.example` → `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `MONGODB_URI` | MongoDB Atlas → Connect → Node.js driver |
| `JWT_SECRET` | Any random 32+ char string |
| `JWT_REFRESH_SECRET` | Another random 32+ char string |
| `ADMIN_EMAIL` | Your admin login email |
| `ADMIN_PASSWORD` | Your admin password (min 8 chars) |
| `CLOUDINARY_CLOUD_NAME` | cloudinary.com → Dashboard |
| `CLOUDINARY_API_KEY` | cloudinary.com → Dashboard |
| `CLOUDINARY_API_SECRET` | cloudinary.com → Dashboard |
| `VAPID_PUBLIC_KEY` | Run `node scripts/generate-vapid.js` |
| `VAPID_PRIVATE_KEY` | Run `node scripts/generate-vapid.js` |

---

## 📡 API Routes

### Auth (users + admin)
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
PATCH /api/auth/update-profile
PATCH /api/auth/change-password
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/addresses
DELETE /api/auth/addresses/:id
POST /api/auth/wishlist/:id
DELETE /api/auth/wishlist/:id
```

### Driver (separate login + dashboard)
```
POST  /api/driver/auth/login          ← role=driver enforced server-side
GET   /api/driver/profile             ← profile + today's delivery stats
PATCH /api/driver/status              ← { isOnDuty: true|false }
POST  /api/driver/location            ← { lat, lng, orderId? }
GET   /api/driver/orders?status=confirmed|mine|done|all
POST  /api/driver/orders/:orderId/accept   ← ATOMIC — prevents race conditions
POST  /api/driver/orders/:orderId/reject   ← adds to rejectedBy[], hides from this driver
POST  /api/driver/orders/:orderId/deliver
POST  /api/driver/register            ← admin only
```

### Orders
```
POST   /api/orders                    ← place order (GPS lat/lng saved)
GET    /api/orders/my
GET    /api/orders/track/:orderId     ← live driver location for user tracking
PATCH  /api/orders/:orderId/cancel
GET    /api/orders/admin/all
PATCH  /api/orders/admin/:orderId/status
DELETE /api/orders/admin/:orderId
GET    /api/orders/admin/analytics
```

### Fruits
```
GET    /api/fruits
GET    /api/fruits/featured
GET    /api/fruits/search
GET    /api/fruits/admin/all
POST   /api/fruits
PATCH  /api/fruits/:id
DELETE /api/fruits/:id
PATCH  /api/fruits/:id/stock
PATCH  /api/fruits/:id/price
POST   /api/fruits/upload-image
DELETE /api/fruits/delete-image
```

---

## 🏗️ Architecture

```
Browser (PWA)
   │
   ├── GPS Modal → Nominatim reverse geocode → fills address
   ├── Polls /api/driver/orders every 5s (driver dashboard)
   ├── Polls /api/orders/track/:id every 10s (user tracking)
   │
   └── Netlify CDN (index.html + assets)
          │
          └── Netlify Functions (api.js)
                 │
                 ├── MongoDB Atlas (users, orders, fruits)
                 │     └── Atomic findOneAndUpdate (no race conditions)
                 ├── Cloudinary (fruit images)
                 └── Web Push (new order notifications to admin)
```

---

## 👥 Roles

| Role | Login Page | Can Do |
|---|---|---|
| `user` | Main site auth modal | Shop, track orders, manage profile |
| `admin` | Main site auth modal | Everything — manage fruits, orders, drivers, users |
| `driver` | `/page-driverlogin` (green portal) | Accept/reject/deliver orders, share location, toggle on-duty |

---

## 📦 Real-Time Strategy (Polling vs WebSockets)

Netlify serverless functions cannot hold open WebSocket connections.
The app uses **smart polling** instead:

- **Driver dashboard**: `GET /api/driver/orders` every **5 seconds** — compares order ID snapshot, re-renders only if changed, vibrates phone on new order
- **Location sync**: driver GPS pushed to server every **30 seconds** while on delivery
- **User tracking**: `GET /api/orders/track/:id` every **10 seconds** — shows driver coordinates + "Track Live" Maps link
- **Admin dashboard**: manual refresh + pull-to-refresh

For production scale (100+ drivers), upgrade to: **Ably**, **Pusher**, or **Socket.IO on a persistent server** — the polling architecture is designed to be drop-in replaceable.
