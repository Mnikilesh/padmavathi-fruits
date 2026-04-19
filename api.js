/*
 ╔══════════════════════════════════════════════════════════════╗
 ║   PADMAVATHI FRUITS COMPANY — Netlify Serverless Function    ║
 ║   v4 — GPS · Real-Time Polling · Atomic Accept · Driver UI   ║
 ╚══════════════════════════════════════════════════════════════╝
*/
require('dotenv').config();
'use strict';

// ─── CRITICAL: Fail fast if required env vars are missing ────
// Never allow fallback defaults for security-critical values.
const _REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];
const _MISSING_ENV  = _REQUIRED_ENV.filter(k => !process.env[k]);
if (_MISSING_ENV.length) {
  console.error('[PFC] FATAL: Missing required environment variables:', _MISSING_ENV.join(', '));
  console.error('[PFC] Set these in your Render/Netlify dashboard. Server will not start.');
  process.exit(1);
}
console.log('[PFC] ENV check OK — JWT, MONGO set.');

const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const crypto        = require('crypto');
const Busboy        = require('busboy');
const cloudinary    = require('cloudinary').v2;

const JWT_SECRET         = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const MONGODB_URI        = process.env.MONGODB_URI;
const BCRYPT_ROUNDS      = parseInt(process.env.BCRYPT_ROUNDS) || 10;

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
  secure     : true,
});

// ─── EMAIL (Nodemailer) ───────────────────────────────────────
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
  console.log('[PFC] EMAIL: nodemailer loaded OK');
} catch(e) {
  console.error('[PFC] EMAIL: nodemailer FAILED to load —', e.message);
}

const EMAIL_FROM    = 'padmavathifruitscompany@gmail.com';
const EMAIL_TO_LIST = ['mamidalaanand80@gmail.com', 'nikileshmamidala@gmail.com'];

// Log env var presence at startup (never log the actual password)
const _emailPass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS || '';
const _emailUser = process.env.EMAIL_USER || EMAIL_FROM;
console.log('[PFC] EMAIL_USER:', _emailUser);
console.log('[PFC] EMAIL_PASS set:', _emailPass ? 'YES (length=' + _emailPass.length + ')' : 'NO ← SET GMAIL_APP_PASSWORD in Render env vars');

function createMailTransport() {
  if (!nodemailer) { console.error('[PFC] EMAIL: nodemailer not available'); return null; }
  if (!_emailPass) { console.error('[PFC] EMAIL: GMAIL_APP_PASSWORD not set — skipping email'); return null; }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: _emailUser, pass: _emailPass },
  });
}

async function sendOrderEmail(order) {
  console.log('[PFC] EMAIL: attempting to send for orderId:', order.orderId);
  const transport = createMailTransport();
  if (!transport) { console.error('[PFC] EMAIL: transport is null — email not sent'); return; }

  const itemLines = (order.items || []).map(i =>
    `  * ${i.emoji || ''} ${i.name}${i.weightLabel ? ' - ' + i.weightLabel : ''}  x${i.quantity}  Rs.${i.subtotal?.toFixed(2) || ''}`
  ).join('\n');

  const subject = `New Order ${order.orderId} - Rs.${order.totalAmount?.toFixed(0)} | Padmavathi Fruits`;
  const text = [
    'New order received on Padmavathi Fruits Company!',
    '',
    'Order ID   : ' + order.orderId,
    'Customer   : ' + order.customerName + '  |  ' + order.customerPhone,
    'Payment    : ' + (order.paymentMethod || '').toUpperCase(),
    'Status     : ' + order.status,
    '',
    '--- Items ---',
    itemLines,
    '-------------',
    'Subtotal   : Rs.' + (order.subtotal || 0).toFixed(2),
    'Delivery   : Rs.' + (order.deliveryFee || 0).toFixed(2),
    'TOTAL      : Rs.' + (order.totalAmount || 0).toFixed(2),
    '',
    '--- Delivery Address ---',
    order.deliveryAddress?.street || '',
    (order.deliveryAddress?.city || 'Warangal') + ', ' + (order.deliveryAddress?.state || 'Telangana') + ' - ' + (order.deliveryAddress?.pincode || ''),
    order.deliveryAddress?.mapsUrl ? 'Maps: ' + order.deliveryAddress.mapsUrl : '',
    '',
    order.orderNotes ? 'Notes: ' + order.orderNotes : '',
    '',
    '- Padmavathi Fruits Company',
  ].filter(l => l !== undefined).join('\n');

  try {
    const info = await transport.sendMail({
      from: '"Padmavathi Fruits Company" <' + EMAIL_FROM + '>',
      to:   EMAIL_TO_LIST.join(', '),
      subject,
      text,
    });
    console.log('[PFC] ORDER_EMAIL_SENT orderId:' + order.orderId + ' messageId:' + info.messageId);
  } catch(e) {
    console.error('[PFC] ORDER_EMAIL_FAILED orderId:' + order.orderId + ' error:' + e.message);
    console.error('[PFC] ORDER_EMAIL_FAILED full:', e);
  }
}

// ─── OTP EMAIL ───────────────────────────────────────────────

// ─── OTP EMAIL ───────────────────────────────────────────────
async function sendOtpEmail(toEmail, otp, userName, type) {
  // type: 'register' | 'reset'  (defaults to 'reset')
  console.log('[PFC] OTP_EMAIL type=' + (type||'reset') + ' attempting send to:', toEmail);
  const transport = createMailTransport();
  if (!transport) {
    console.error('[PFC] OTP_EMAIL: transport is null — GMAIL_APP_PASSWORD not set in env vars. OTP not delivered.');
    return { sent: false, reason: 'Email transport not configured (GMAIL_APP_PASSWORD missing).' };
  }
  const isRegister = type === 'register';
  const subject = isRegister
    ? 'Verify your Padmavathi Fruits account'
    : 'Your Padmavathi Fruits password reset code';
  const greeting = 'Hello' + (userName ? ' ' + userName : '') + ',';
  const purpose  = isRegister
    ? 'You are creating an account on Padmavathi Fruits. Use the code below to verify your email address:'
    : 'You requested a password reset for your Padmavathi Fruits account. Use the code below:';
  const text = [
    greeting,
    '',
    purpose,
    '',
    '  ' + otp,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this, you can safely ignore this email.',
    '',
    '— Padmavathi Fruits Company',
    'padmavathifruits.in',
  ].join('\n');
  try {
    const info = await transport.sendMail({
      from: '"Padmavathi Fruits Company" <' + EMAIL_FROM + '>',
      to:   toEmail,
      subject,
      text,
    });
    console.log('[PFC] OTP_EMAIL_SENT to:' + toEmail + ' messageId:' + info.messageId);
    return { sent: true };
  } catch(e) {
    console.error('[PFC] OTP_EMAIL_FAILED to:' + toEmail + ' error:' + e.message);
    return { sent: false, reason: e.message };
  }
}

let webpush = null;
try {
  webpush = require('web-push');
  const pub  = (process.env.VAPID_PUBLIC_KEY  || '').replace(/=+$/, '');
  const priv = (process.env.VAPID_PRIVATE_KEY || '').replace(/=+$/, '');
  if (pub && priv) { webpush.setVapidDetails('mailto:padmavathifruitscompany@gmail.com', pub, priv); }
  else { webpush = null; }
} catch (_) { webpush = null; }

let mongoConn = null;
async function connectDB() {
  if (mongoConn && mongoose.connection.readyState === 1) return mongoConn;
  if (!MONGODB_URI) throw new Error('MONGODB_URI environment variable is not set.');
  mongoConn = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000,
  });
  return mongoConn;
}

// ─── MODELS ──────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:    { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  role:     { type: String, enum: ['user','admin','driver'], default: 'user' },
  language: { type: String, default: 'en' },
  addresses:[{ label:String, street:String, city:String, state:String, pincode:String, isDefault:Boolean }],
  wishlist:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Fruit' }],
  isActive:  { type: Boolean, default: true },
  // ── Driver-specific fields ──
  isOnDuty:  { type: Boolean, default: false },   // driver availability toggle
  vehicleType: { type: String, default: 'bike' }, // bike | auto | car
  currentLat:  Number,
  currentLng:  Number,
  locationUpdatedAt: Date,
  refreshTokens: [{ token:String, expiresAt:Date }],
  lastLogin: Date,
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});
userSchema.methods.comparePassword = function(c) { return bcrypt.compare(c, this.password); };
userSchema.set('toJSON', { transform: (d,r) => {
  delete r.password; delete r.refreshTokens; delete r.__v; return r;
}});

const fruitSchema = new mongoose.Schema({
  name:              { type:String, required:true, trim:true },
  slug:              { type:String, unique:true, lowercase:true },
  variety:           { type:String, required:true, trim:true },
  emoji:             { type:String, default:'🍎' },
  category:          { type:String, required:true, enum:['Daily','Seasonal','Imported','Wholesale'] },
  price:             { type:Number, required:true, min:1 },
  discountPercent:   { type:Number, default:0, min:0, max:90 },
  stock:             { type:Number, default:0, min:0 },
  badge:             { type:String, enum:['','hot','sea','imp','org','new','sale'], default:'' },
  badgeLabel:        { type:String, default:'' },
  images:            [{ url:String, alt:String, isPrimary:Boolean }],
  imageUrl:          String,
  tags:              [String],
  description:       String,
  benefits:          { type: mongoose.Schema.Types.Mixed, default: [] },
  unitType:          { type:String, enum:['weight','piece','large','box','custom'], default:'weight' },
  customUnits:       { type: mongoose.Schema.Types.Mixed, default: [] },
  lowStockThreshold: { type:Number, default:5, min:0 },
  fruit_images:      { type:[String], default:[], validate: v => v.length <= 3 },
  origin:            { region:String, country:{ type:String, default:'India' } },
  isFeatured:        { type:Boolean, default:false },
  isAvailable:       { type:Boolean, default:true },
  isDeleted:         { type:Boolean, default:false },
  averageRating:     { type:Number, default:0 },
  totalReviews:      { type:Number, default:0 },
  totalSold:         { type:Number, default:0 },
}, { timestamps:true, toJSON:{ virtuals:true } });

fruitSchema.virtual('effectivePrice').get(function() {
  return this.discountPercent > 0
    ? parseFloat((this.price * (1 - this.discountPercent / 100)).toFixed(2))
    : this.price;
});
fruitSchema.pre('save', function(next) {
  if (this.isModified('name'))
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  next();
});

const orderItemSchema = new mongoose.Schema({
  fruit:    { type:mongoose.Schema.Types.ObjectId, ref:'Fruit', required:false, default:undefined },
  isJuice:  { type:Boolean, default:false },
  juiceId:  { type:String },
  name:String, emoji:{ type:String, default:'🍎' }, variety:String,
  pricePerKg:Number, weightGrams:Number, weightLabel:String,
  quantity:{ type:Number, default:1, min:1 }, subtotal:Number
}, { _id:false });

const orderSchema = new mongoose.Schema({
  orderId:     { type:String, unique:true, default:()=>'PFC-'+Math.floor(10000+Math.random()*90000) },
  orderToken:  { type:String, unique:true, required:true }, // idempotency key — REQUIRED, prevents duplicate orders
  user:        { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  customerName:String, customerPhone:String, customerEmail:String,
  items:    { type:[orderItemSchema], validate:v=>v.length>0 },
  deliveryAddress: {
    street:String, city:String, state:String, pincode:String,
    lat:Number, lng:Number, mapsUrl:String,
  },
  orderNotes:String,
  subtotal:Number, deliveryFee:{ type:Number, default:0 }, totalAmount:Number,
  paymentMethod:  { type:String, enum:['cod','upi','razorpay'], required:true },
  paymentStatus:  { type:String, enum:['pending','paid','failed','refunded'], default:'pending' },
  razorpayOrderId:String, razorpayPaymentId:String,
  status: {
    type:String,
    enum:['placed','confirmed','packed','out_for_delivery','dispatched','delivered','cancelled'],
    default:'placed'
  },
  statusHistory:  [{ status:String, timestamp:{ type:Date, default:Date.now }, note:String }],
  estimatedDelivery:Date, deliveredAt:Date, cancelledAt:Date, cancellationReason:String,
  // ── Driver assignment ──────────────────────────────────
  assignedDriver:      { type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
  assignedDriverName:  String,
  assignedDriverPhone: String,
  assignedDriverVehicle: String,
  rejectedBy:          [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }], // drivers who rejected
  // ── Live driver location (updated every 30s by driver app) ──
  driverLat:               Number,
  driverLng:               Number,
  driverLocationUpdatedAt: Date,
  // ── Admin override audit trail ────────────────────────────
  isAdminModified:  { type:Boolean, default:false },
  adminModifications: [{
    modifiedBy:   { type:mongoose.Schema.Types.ObjectId, ref:'User' },
    modifiedByEmail: String,
    reason:       String,
    originalItems:   mongoose.Schema.Types.Mixed,
    originalTotal:   Number,
    originalStatus:  String,
    changes:         mongoose.Schema.Types.Mixed,
    timestamp:    { type:Date, default:Date.now },
  }],
}, { timestamps:true });

orderSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.statusHistory.push({ status:this.status });
    if (this.status==='delivered') this.deliveredAt = new Date();
    if (this.status==='cancelled') this.cancelledAt = new Date();
  }
  next();
});

const reviewSchema = new mongoose.Schema({
  fruit:   { type:mongoose.Schema.Types.ObjectId, ref:'Fruit', required:true },
  user:    { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  rating:  { type:Number, required:true, min:1, max:5 },
  title:   { type:String, trim:true, maxlength:100 },
  comment: { type:String, trim:true, maxlength:500 },
  isVerifiedPurchase:{ type:Boolean, default:false },
  isApproved:        { type:Boolean, default:true },
}, { timestamps:true });

reviewSchema.index({ fruit:1, user:1 }, { unique:true });
reviewSchema.post('save', async function() {
  const Fruit = mongoose.model('Fruit');
  const stats = await mongoose.model('Review').aggregate([
    { $match: { fruit:this.fruit, isApproved:true } },
    { $group: { _id:'$fruit', avg:{ $avg:'$rating' }, count:{ $sum:1 } } }
  ]);
  if (stats.length)
    await Fruit.findByIdAndUpdate(this.fruit, {
      averageRating: parseFloat(stats[0].avg.toFixed(1)),
      totalReviews:  stats[0].count
    });
});

const pushSubSchema = new mongoose.Schema({
  endpoint:     { type:String, required:true, unique:true },
  subscription: { type:mongoose.Schema.Types.Mixed, required:true },
  role:         { type:String, default:'user' },
  userId:       String,
  ts:           { type:Number, default:Date.now },
}, { timestamps:true });

// ── Settings: key/value store for admin config (platform fee, order-now toggle, etc.)
// Stored in MongoDB so all platforms (Render, Netlify, Cloudflare) read the same values.
const settingsSchema = new mongoose.Schema({
  key:   { type:String, required:true, unique:true },
  value: { type:mongoose.Schema.Types.Mixed },
}, { timestamps:true });

// ── Juice schema ─────────────────────────────────────────────
const juiceSchema = new mongoose.Schema({
  name:            { type:String, required:true, trim:true },
  desc:            String,
  img:             String,
  img2:            String,
  price:           { type:Number, required:true, min:1 },
  discountPercent: { type:Number, default:0, min:0, max:90 },
  moo:             { type:Number, default:500 },   // minimum order ml
  category:        { type:String, default:'Fresh' },
  status:          { type:String, enum:['available','soon'], default:'available' },
  stock:           { type:Number, default:0 },     // litres
  benefits:        [String],
  isDeleted:       { type:Boolean, default:false },
}, { timestamps:true });

// ── Admin Password Change Log ────────────────────────────────
const adminPasswordLogSchema = new mongoose.Schema({
  targetUserId:  { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  targetEmail:   String,
  adminId:       { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  adminEmail:    String,
  action:        { type:String, default:'password_reset' },
  timestamp:     { type:Date, default:Date.now },
  ip:            String,
}, { timestamps:true });


const basketSchema = new mongoose.Schema({
  name:      { type:String, required:true, trim:true },
  desc:      String,
  emoji:     { type:String, default:'🎁' },
  price:     { type:Number, required:true },
  origPrice: Number,
  items:     String,   // display string e.g. "Apple 1kg, Mango 500g"
  badge:     String,
  active:    { type:Boolean, default:true },
  isDeleted: { type:Boolean, default:false },
}, { timestamps:true });

// ── Offline Sale schema ───────────────────────────────────────
const offlineSaleSchema = new mongoose.Schema({
  saleId:      { type:String, unique:true, default:()=>'OS-'+Math.floor(10000+Math.random()*90000) },
  name:        { type:String, default:'Walk-in' },
  phone:       String,
  items:       String,
  itemsDetail: [{ item:String, qty:Number, unit:String, price:Number }],
  amount:      { type:Number, required:true },
  pay:         { type:String, default:'Cash' },
  notes:       String,
  date:        String,   // YYYY-MM-DD
}, { timestamps:true });

// ─── RATE LIMITER (Task 10) ──────────────────────────────────
// Per-IP: max 100 requests per 15 minutes — in-memory, free-tier safe
// ── Route-aware rate limiter ─────────────────────────────────
// Bucket key = `${ip}:${bucketName}` — each bucket has its own window/max.
// Auth routes get a tight 20 req/min to prevent brute-force.
// Public data gets 200 req/15 min (generous for normal browsing).
// Everything else gets 100 req/15 min.
const _rlMap = new Map();

function _rlCheck(key, max, windowMs) {
  const now = Date.now();
  if (!_rlMap.has(key)) _rlMap.set(key, []);
  const reqs = _rlMap.get(key).filter(t => now - t < windowMs);
  if (reqs.length >= max) return false;
  reqs.push(now);
  _rlMap.set(key, reqs);
  // Prune stale entries to prevent unbounded growth
  if (_rlMap.size > 1000) {
    for (const [k, v] of _rlMap) {
      if (!v.length) _rlMap.delete(k);
    }
  }
  return true;
}

function rateLimit(ip, path) {
  // Auth routes — tight window to stop brute-force / OTP spam
  if (path.startsWith('/api/auth/')) {
    return _rlCheck(ip + ':auth', 20, 60 * 1000);
  }
  // Product data + all admin ops (discount, price, stock, juices, baskets) —
  // generous shared bucket so rapid admin edits never trigger 429.
  // Admin write ops (PATCH/POST/DELETE for price, stock, discount) are included
  // here so setting discounts, updating stock, or adding fruits/juices/baskets
  // never collides with background polling calls.
  if (
    path.startsWith('/api/juices')  ||
    path.startsWith('/api/baskets') ||
    path.startsWith('/api/fruits')  ||
    path.startsWith('/api/admin/')  ||
    path.startsWith('/api/settings')
  ) {
    return _rlCheck(ip + ':public', 400, 15 * 60 * 1000);
  }
  // All other routes (orders, driver, push, etc.)
  return _rlCheck(ip + ':general', 150, 15 * 60 * 1000);
}

function getIP(event) {
  return (event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
}

function getModels() {
  return {
    User:     mongoose.models.User     || mongoose.model('User',     userSchema),
    Fruit:    mongoose.models.Fruit    || mongoose.model('Fruit',    fruitSchema),
    Order:    mongoose.models.Order    || mongoose.model('Order',    orderSchema),
    Review:   mongoose.models.Review   || mongoose.model('Review',   reviewSchema),
    PushSub:  mongoose.models.PushSub  || mongoose.model('PushSub',  pushSubSchema),
    Settings:    mongoose.models.Settings    || mongoose.model('Settings',    settingsSchema),
    Juice:       mongoose.models.Juice       || mongoose.model('Juice',       juiceSchema),
    Basket:      mongoose.models.Basket      || mongoose.model('Basket',      basketSchema),
    OfflineSale: mongoose.models.OfflineSale || mongoose.model('OfflineSale', offlineSaleSchema),
    AdminPasswordLog: mongoose.models.AdminPasswordLog || mongoose.model('AdminPasswordLog', adminPasswordLogSchema),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────

const signAccess  = p => jwt.sign(p, JWT_SECRET,         { expiresIn:'7d',  issuer:'pfc' });
const signRefresh = p => jwt.sign(p, JWT_REFRESH_SECRET, { expiresIn:'30d', issuer:'pfc' });
const tokenPair   = u => {
  const p = { id:u._id, email:u.email, role:u.role };
  return { accessToken:signAccess(p), refreshToken:signRefresh(p) };
};

// ─── CORS: strict origin allowlist — never use '*' ───────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean)
  .concat([
    'https://padmavathi-fruits.pages.dev',
    'https://padmavathifruits.netlify.app',
    'https://padmavathifruits.in',
    'https://www.padmavathifruits.in',
    // Local development — never reaches production since Render runs on 10000
    'http://localhost:10000',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:10000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5500',
  ]);

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  if (!allowed) return { 'Content-Type': 'application/json' };
  return {
    'Access-Control-Allow-Origin':      origin,
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

// R helpers — origin is threaded from the request context via _reqOrigin
let _reqOrigin = '';
const R = {
  json:    (data, code=200)  => ({ statusCode:code, headers:corsHeaders(_reqOrigin), body:JSON.stringify(data) }),
  ok:      (data={},msg='OK',code=200) => R.json({ success:true,  message:msg, ...data }, code),
  created: (data={},msg='Created')     => R.ok(data, msg, 201),
  bad:     (msg, errs=null)            => R.json({ success:false, message:msg, ...(errs&&{errors:errs}) }, 400),
  unauth:  (msg='Unauthorized')        => R.json({ success:false, message:msg }, 401),
  noauth:  (msg='Forbidden')           => R.json({ success:false, message:msg }, 403),
  nf:      (msg='Not found')           => R.json({ success:false, message:msg }, 404),
  err:     (msg='Server error',code=500)=> R.json({ success:false, message:msg }, code),
};

function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(v => sanitize(v));
  if (typeof obj !== 'object' || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !k.includes('$') && !k.includes('.'))
      .map(([k,v]) => [k, sanitize(v)])
  );
}

function isValidWeight(g) { const n=+g; return Number.isFinite(n)&&n>0&&n<=100000; }
function isValidObjectId(id) { return id && /^[a-f\d]{24}$/i.test(id); }

// ── Auth user cache — avoids a DB round-trip on every authenticated request ──
// TTL: 45s — short enough to reflect isActive toggles, long enough to collapse
// the burst of parallel calls from the driver dashboard init (profile + 2 order fetches).
// ── Auth user cache — avoids a DB round-trip on every authenticated request ──
// TTL: 45s — short enough to reflect isActive toggles, long enough to survive
// the burst of parallel calls from the driver dashboard init (Promise.all × 3).
const _authCache   = new Map();   // cacheKey → { user, exp }
const _authFlight  = new Map();   // cacheKey → Promise<user>  ← DEDUP: prevents
                                  // parallel requests sharing the same token from
                                  // each firing their own User.findById() call.
const AUTH_CACHE_TTL_MS = 45_000;

function _pruneAuthCache() {
  const now = Date.now();
  for (const [k, v] of _authCache) { if (v.exp < now) _authCache.delete(k); }
}
// Call this whenever user data is mutated so stale cache is never served.
function _invalidateUserCache(userId) {
  const prefix = String(userId) + ':';
  for (const k of _authCache.keys()) { if (k.startsWith(prefix)) _authCache.delete(k); }
}

async function authenticate(headers) {
  // Netlify may lowercase headers in transit — check all casings
  const auth = headers.authorization
             || headers.Authorization
             || headers.AUTHORIZATION
             || headers['Authorization']
             || '';
  if (!auth.startsWith('Bearer ')) {
    const hkeys = Object.keys(headers).filter(k => k.toLowerCase().includes('auth'));
    console.error('[PFC] Token required. Auth-related headers present:', hkeys.length ? hkeys : 'none');
    return { err: R.unauth('Token required.') };
  }
  const token = auth.split(' ')[1];
  let dec;
  try { dec = jwt.verify(token, JWT_SECRET, { issuer:'pfc' }); }
  catch(e) { return { err: R.unauth(e.name==='TokenExpiredError' ? 'Session expired.' : 'Invalid token.') }; }

  // Cache key: userId + last-8 chars of token (unique per token rotation)
  const cacheKey = dec.id + ':' + token.slice(-8);

  // 1. Hot path — valid cache entry exists
  const hit = _authCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return { user: hit.user };

  // 2. In-flight dedup — another async call for the SAME key is already awaiting
  //    User.findById(). Return the same Promise instead of spawning a duplicate DB read.
  //    This is the critical fix for initDriverDashboard's Promise.all(3 parallel GETs):
  //    all three arrive simultaneously, all three miss the empty cache, but only the
  //    FIRST one starts the DB fetch — the other two await its result.
  if (_authFlight.has(cacheKey)) {
    const u = await _authFlight.get(cacheKey);
    return u ? { user: u } : { err: R.unauth('User not found.') };
  }

  // 3. Cache miss — start a new DB fetch and register it as the in-flight Promise
  const { User } = getModels();
  const fetchPromise = User.findById(dec.id).select('-password').then(u => u || null);
  _authFlight.set(cacheKey, fetchPromise);

  let u;
  try { u = await fetchPromise; }
  finally { _authFlight.delete(cacheKey); } // always clean up regardless of outcome

  if (!u || !u.isActive) return { err: R.unauth('User not found.') };

  _authCache.set(cacheKey, { user: u, exp: Date.now() + AUTH_CACHE_TTL_MS });
  if (_authCache.size % 50 === 0) _pruneAuthCache();
  return { user: u };
}

// ─── CLOUDINARY ──────────────────────────────────────────────

function parseMultipartUpload(event) {
  return new Promise((resolve, reject) => {
    // Prefer _rawBuffer (set by HTTP server) — avoids string-encoding corruption of binary data.
    // Fall back to legacy base64/string body for Netlify handler compatibility.
    let body;
    if (event._rawBuffer && Buffer.isBuffer(event._rawBuffer)) {
      body = event._rawBuffer;
    } else if (event.isBase64Encoded && event.body) {
      body = Buffer.from(event.body, 'base64');
    } else {
      body = Buffer.from(event.body || '');
    }
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    const bb = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer = null, fileName = '', fileMime = '';
    const fields = {};
    bb.on('file', (name, stream, info) => {
      fileName = info.filename; fileMime = info.mimeType;
      const chunks = [];
      stream.on('data', d => chunks.push(d));
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('close', () => resolve({ fileBuffer, fileName, fileMime, fields }));
    bb.on('error', reject);
    bb.write(body);
    bb.end();
  });
}

async function uploadToCloudinary(buffer, mimeType) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('Cloudinary not configured.');
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder:'padmavathi-fruits', resource_type:'image', format:'webp', quality:'auto' },
      (err,result) => { if (err) reject(err); else resolve(result); }
    );
    stream.end(buffer);
  });
}

async function deleteFromCloudinary(publicId) {
  try { await cloudinary.uploader.destroy(publicId); } catch(_) {}
}

async function _sendPushToRole(roles, title, body, data, tag) {
  if (!webpush) return;
  const { PushSub } = getModels();
  const subs = await PushSub.find({ role: { $in: roles } });
  const dead = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({
        title, body,
        icon:  '/favicon.ico',
        badge: '/favicon.ico',
        tag:   tag || 'pfc-new-order',
        data:  data || { url: '/' },
        vibrate: [300,100,300,100,300],
        requireInteraction: true,
      }));
    } catch(e) {
      if (e.statusCode===410||e.statusCode===404) dead.push(s.endpoint);
    }
  }
  if (dead.length) await PushSub.deleteMany({ endpoint:{ $in:dead } });
}

// Push to admins (for new orders)
async function sendPushToAdmins(title, body, data) {
  return _sendPushToRole(['admin'], title, body, data, 'pfc-new-order');
}

// Push to drivers (for new available orders)
async function sendPushToDrivers(title, body, data) {
  return _sendPushToRole(['driver'], title, body, data, 'pfc-new-order');
}

// Push to a specific user by their MongoDB userId string
async function sendPushToUser(userId, title, body, data) {
  if (!webpush || !userId) return;
  const { PushSub } = getModels();
  const subs = await PushSub.find({ userId: String(userId) }).lean();
  const dead = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({
        title, body,
        icon:  '/favicon.ico',
        badge: '/favicon.ico',
        tag:   'pfc-order-status',
        data:  data || { url: '/?page=profile' },
      }));
    } catch(e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(s.endpoint);
    }
  }
  if (dead.length) await PushSub.deleteMany({ endpoint: { $in: dead } });
}

// ─── SEED DATA ───────────────────────────────────────────────

const SEED_FRUITS = [
  {name:'Apple',variety:'Himachal Pradesh Red',emoji:'🍎',category:'Daily',price:180,stock:100,badge:'',badgeLabel:'',isFeatured:true,tags:['vitamin-c','daily','fresh'],description:'Crisp apples directly from Himachal Pradesh farms.',benefits:['High in fiber & Vitamin C','Supports heart health','Helps with weight management','Boosts immune system'],unitType:'piece'},
  {name:'Banana',variety:'Robusta',emoji:'🍌',category:'Daily',price:60,stock:200,badge:'org',badgeLabel:'Organic',isFeatured:true,tags:['energy','daily','organic'],description:'Farm-fresh Robusta bananas packed with energy.',benefits:['Rich in potassium','Improves digestion','Boosts energy levels','Good for heart health'],unitType:'piece'},
  {name:'Orange',variety:'Nagpur Santra',emoji:'🍊',category:'Daily',price:120,stock:150,badge:'',badgeLabel:'',isFeatured:true,tags:['vitamin-c','daily','juicy'],description:"Premium Nagpur Santra — India's finest orange."},
  {name:'Pomegranate',variety:'Bhagwa',emoji:'🍑',category:'Daily',price:160,stock:80,badge:'hot',badgeLabel:'Popular',isFeatured:true,tags:['antioxidant','daily','premium'],description:'Deep-red Bhagwa pomegranates rich in antioxidants.'},
  {name:'Grapes',variety:'Thompson Seedless',emoji:'🍇',category:'Daily',price:140,stock:90,badge:'',badgeLabel:'',isFeatured:false,tags:['seedless','daily','sweet'],description:'Plump seedless Thompson grapes from Nashik.'},
  {name:'Papaya',variety:'Red Lady',emoji:'🍈',category:'Daily',price:45,stock:120,badge:'org',badgeLabel:'Organic',isFeatured:false,tags:['digestive','organic'],description:'Locally grown Red Lady papayas.'},
  {name:'Alphonso Mango',variety:'Premium Ratnagiri',emoji:'🥭',category:'Seasonal',price:280,stock:50,badge:'sea',badgeLabel:'Seasonal',isFeatured:true,tags:['premium','seasonal','mango'],description:'King of Mangoes — authentic Ratnagiri Alphonso.'},
  {name:'Watermelon',variety:'Seedless',emoji:'🍉',category:'Seasonal',price:25,stock:300,badge:'sea',badgeLabel:'Seasonal',isFeatured:true,tags:['seasonal','hydrating','summer'],description:'Giant seedless watermelons from local farms.',benefits:['92% water keeps you hydrated','Rich in lycopene','Reduces muscle soreness','Good for skin'],unitType:'large'},
  {name:'Muskmelon',variety:'Honey Dew',emoji:'🍈',category:'Seasonal',price:60,stock:80,badge:'sea',badgeLabel:'Seasonal',isFeatured:false,tags:['seasonal','sweet','summer'],description:'Sweet Honey Dew muskmelons.'},
  {name:'Kiwi',variety:'Zespri Green',emoji:'🥝',category:'Imported',price:350,stock:60,badge:'imp',badgeLabel:'Imported',isFeatured:true,tags:['imported','vitamin-c','exotic'],description:'Premium Zespri Green Kiwis from New Zealand.'},
  {name:'Dragon Fruit',variety:'Red Pitaya',emoji:'🐉',category:'Imported',price:400,stock:30,badge:'imp',badgeLabel:'Imported',isFeatured:false,tags:['imported','exotic','antioxidant'],description:'Red Pitaya dragon fruit from Vietnam.'},
  {name:'Avocado',variety:'Hass variety',emoji:'🥑',category:'Imported',price:320,stock:25,badge:'imp',badgeLabel:'Imported',isFeatured:false,tags:['imported','healthy-fat','keto'],description:'Creamy Hass avocados — perfect for salads.'},
];

const SEED_JUICES = [
  { name:'Fresh Orange Juice',  desc:'Cold pressed · no added sugar',     price:60,  moo:500, stock:25, category:'Cold Pressed', status:'available', benefits:['Rich in Vitamin C','Boosts immunity'] },
  { name:'Lemon Mint Cooler',   desc:'Fresh squeezed with mint leaves',   price:40,  moo:500, stock:20, category:'Fresh',        status:'available', benefits:['Refreshing & hydrating','Good for digestion'] },
  { name:'Watermelon Juice',    desc:'Seasonal special · naturally sweet',price:50,  moo:500, stock:15, category:'Seasonal',     status:'available', benefits:['Keeps you hydrated','Rich in lycopene'] },
  { name:'Mango Lassi',         desc:'Alphonso mango blend · creamy',     price:80,  moo:500, stock:10, category:'Blend',        status:'available', benefits:['Rich in Vitamin A','Probiotic benefits'] },
  { name:'Grape Juice',         desc:'Seedless grapes · chilled',         price:70,  moo:500, stock:18, category:'Cold Pressed', status:'available', benefits:['Antioxidant rich','Good for heart health'] },
  { name:'Pineapple Ginger',    desc:'Fresh blend with ginger kick',      price:65,  moo:500, stock:12, category:'Blend',        status:'available', benefits:['Anti-inflammatory','Aids digestion'] },
];

let _seeded = false;
async function seedIfEmpty() {
  if (_seeded) return;   // run at most once per process lifetime
  _seeded = true;
  const { Fruit, User, Juice } = getModels();
  if (await Fruit.countDocuments()===0) { await Fruit.insertMany(SEED_FRUITS); }
  if (await Juice.countDocuments()===0) { await Juice.insertMany(SEED_JUICES); }
  // SECURITY: Never seed a default admin with a known password.
  // Admin account must be created manually or via a secure bootstrap script.
  const ae = process.env.ADMIN_EMAIL;
  const ap = process.env.ADMIN_PASSWORD;
  if (!ae || !ap) {
    console.warn('[PFC] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed. Create admin manually.');
    return;
  }
  if (!await User.findOne({ email: ae.toLowerCase() })) {
    await User.create({ name: 'Admin', email: ae, phone: process.env.ADMIN_PHONE || '9999999999', password: ap, role: 'admin' });
    console.log('[PFC] Admin account seeded for:', ae);
  }
}

const resetOtps    = new Map();  // email → {otp, exp}   for password reset
const registerOtps = new Map();  // email → {otp, exp, name, phone, password, language}  for signup verification

// ─── ROUTE HANDLER ───────────────────────────────────────────

async function route(method, path, event) {
  // Thread the request origin so corsHeaders() always echoes the correct origin
  _reqOrigin = (event.headers.origin || event.headers.Origin || '').trim();

  const { User, Fruit, Order, Review, PushSub } = getModels();
  let body={};
  try { if (event.body) body=sanitize(JSON.parse(event.body)); } catch(_) {}
  const q = event.queryStringParameters || {};

  // ── RATE LIMIT: route-aware per-IP limits ─────────────────────
  const clientIP = getIP(event);
  if (!rateLimit(clientIP, path)) {
    return R.json({ success: false, message: 'Too many requests. Please wait a few seconds and try again.' }, 429);
  }
  

  if (method==='GET' && path==='/health') return R.ok({ uptime:process.uptime().toFixed(0)+'s' });

  // ── AUTH ────────────────────────────────────────────────────

  // ── STEP 1 of 2: Validate fields + send OTP to email ──────
  if (method==='POST' && path==='/api/auth/send-register-otp') {
    const {name,email,phone,password,language}=body;
    if (!name||!email||!phone||!password) return R.bad('All fields required.');
    if (!/^\S+@\S+\.\S+$/.test(email))    return R.bad('Invalid email address.');
    if (!/^[6-9]\d{9}$/.test(phone))      return R.bad('Valid 10-digit mobile number required.');
    if (password.length<8)                return R.bad('Password must be at least 8 characters.');
    // Check duplicates before sending OTP — no point sending if already registered
    const existingEmail = await User.findOne({email:email.toLowerCase()});
    if (existingEmail) return R.bad('An account with this email already exists. Please login instead.');
    const existingPhone = await User.findOne({phone});
    if (existingPhone) return R.bad('An account with this mobile number already exists.');
    // Generate OTP and hold pending registration data
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    registerOtps.set(email.toLowerCase(), {
      otp, exp: Date.now() + 10 * 60 * 1000,
      name, phone, password, language: language || 'en',
    });
    console.log('[PFC] REGISTER_OTP_GENERATED for:', email, '(value not logged)');
    const result = await sendOtpEmail(email, otp, name, 'register');
    if (!result.sent) {
      registerOtps.delete(email.toLowerCase());
      console.error('[PFC] REGISTER_OTP_EMAIL_FAILED:', result.reason);
      return R.err('Could not send verification email. Please try again later.');
    }
    return R.ok({}, 'Verification code sent to ' + email + '. Check your inbox (and spam folder).');
  }

  // ── STEP 2 of 2: Verify OTP → create account ───────────────
  if (method==='POST' && path==='/api/auth/register') {
    const {email, otp} = body;
    if (!email || !otp) return R.bad('Email and verification code are required.');
    const pending = registerOtps.get(email.toLowerCase());
    if (!pending)                        return R.bad('No pending registration found. Please start again.');
    if (Date.now() > pending.exp)        { registerOtps.delete(email.toLowerCase()); return R.bad('Verification code expired. Please start again.'); }
    if (pending.otp !== String(otp).trim()) return R.bad('Invalid verification code.');
    // Final duplicate check (race condition — another request may have registered in the meantime)
    const existingEmail = await User.findOne({email:email.toLowerCase()});
    if (existingEmail) { registerOtps.delete(email.toLowerCase()); return R.bad('An account with this email already exists. Please login.'); }
    const existingPhone = await User.findOne({phone:pending.phone});
    if (existingPhone) { registerOtps.delete(email.toLowerCase()); return R.bad('An account with this mobile number already exists.'); }
    const u = await User.create({
      name: pending.name, email, phone: pending.phone,
      password: pending.password, language: pending.language,
    });
    registerOtps.delete(email.toLowerCase());
    const {accessToken,refreshToken} = tokenPair(u);
    u.refreshTokens.push({token:crypto.createHash('sha256').update(refreshToken).digest('hex'),expiresAt:new Date(Date.now()+30*864e5)});
    u.lastLogin = new Date();
    await u.save({validateBeforeSave:false});
    console.log('[PFC] REGISTER_COMPLETE userId:', u._id, 'email:', email);
    return R.created({accessToken, refreshToken, user: u}, 'Account created! Welcome to Padmavathi Fruits.');
  }

  if (method==='POST' && path==='/api/auth/login') {
    const {email,password}=body;
    if (!email||!password) return R.bad('Email and password required.');
    const u=await User.findOne({email:String(email).toLowerCase()}).select('+password');
    if (!u||!(await u.comparePassword(password))) return R.unauth('Invalid email or password.');
    if (!u.isActive) return R.unauth('Account deactivated.');
    const {accessToken,refreshToken}=tokenPair(u);
    u.refreshTokens=u.refreshTokens.filter(t=>t.expiresAt>new Date()).slice(-10);
    u.refreshTokens.push({token:crypto.createHash('sha256').update(refreshToken).digest('hex'),expiresAt:new Date(Date.now()+30*864e5)});
    u.lastLogin=new Date(); await u.save({validateBeforeSave:false});
    return R.ok({accessToken,refreshToken,user:u},'Login successful');
  }

  if (method==='POST' && path==='/api/auth/refresh') {
    const {refreshToken}=body;
    if (!refreshToken) return R.bad('Refresh token required.');
    let dec;
    try { dec=jwt.verify(refreshToken,JWT_REFRESH_SECRET,{issuer:'pfc'}); }
    catch { return R.unauth('Invalid refresh token.'); }
    const hashed=crypto.createHash('sha256').update(refreshToken).digest('hex');
    const u=await User.findOne({_id:dec.id,'refreshTokens.token':hashed});
    if (!u||!u.isActive) return R.unauth('Not recognised.');
    u.refreshTokens=u.refreshTokens.filter(t=>t.token!==hashed);
    const {accessToken,refreshToken:nr}=tokenPair(u);
    u.refreshTokens.push({token:crypto.createHash('sha256').update(nr).digest('hex'),expiresAt:new Date(Date.now()+30*864e5)});
    await u.save({validateBeforeSave:false});
    return R.ok({accessToken,refreshToken:nr},'Refreshed');
  }

  if (method==='POST' && path==='/api/auth/logout') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const {refreshToken}=body;
    if (refreshToken) {
      const h=crypto.createHash('sha256').update(refreshToken).digest('hex');
      await User.findByIdAndUpdate(auth.user._id,{$pull:{refreshTokens:{token:h}}});
    }
    return R.ok({},'Logged out');
  }

  if (method==='GET' && path==='/api/auth/me') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const u=await User.findById(auth.user._id).populate('wishlist','name emoji price slug');
    return R.ok({user:u});
  }

  if (method==='PATCH' && path==='/api/auth/update-profile') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const {name,phone,language}=body;
    const up={};
    if (name)     up.name=name;
    if (phone)    up.phone=phone;
    if (language) up.language=language;
    const u=await User.findByIdAndUpdate(auth.user._id,up,{new:true,runValidators:true});
    return R.ok({user:u},'Updated');
  }

  if (method==='PATCH' && path==='/api/auth/change-password') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const {currentPassword,newPassword}=body;
    if (!currentPassword||!newPassword) return R.bad('Both passwords required.');
    const u=await User.findById(auth.user._id).select('+password');
    if (!(await u.comparePassword(currentPassword))) return R.unauth('Current password wrong.');
    if (newPassword.length<8) return R.bad('New password min 8 chars.');
    u.password=newPassword; u.refreshTokens=[]; await u.save();
    return R.ok({},'Password changed.');
  }

  if (method==='POST' && path.startsWith('/api/auth/wishlist/')) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const id=path.split('/').pop();
    await User.findByIdAndUpdate(auth.user._id,{$addToSet:{wishlist:id}});
    return R.ok({},'Added to wishlist');
  }

  if (method==='DELETE' && path.startsWith('/api/auth/wishlist/')) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const id=path.split('/').pop();
    await User.findByIdAndUpdate(auth.user._id,{$pull:{wishlist:id}});
    return R.ok({},'Removed');
  }

  if (method==='POST' && path==='/api/auth/addresses') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const u=await User.findById(auth.user._id);
    if (u.addresses.length>=5) return R.bad('Max 5 addresses.');
    if (body.isDefault) u.addresses.forEach(a=>{a.isDefault=false;});
    u.addresses.push(body); await u.save();
    return R.created({addresses:u.addresses},'Address added');
  }

  if (method==='DELETE' && path.startsWith('/api/auth/addresses/')) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const aid=path.split('/').pop();
    await User.findByIdAndUpdate(auth.user._id,{$pull:{addresses:{_id:aid}}});
    return R.ok({},'Deleted');
  }

  if (method==='POST' && path==='/api/auth/forgot-password') {
    const {email}=body;
    if (!email) return R.bad('Email required.');
    const user=await User.findOne({email:email.toLowerCase()});
    // Return a clear message — this is a fruit delivery app, not a security-critical platform.
    // Telling the user "no account found" is helpful UX; it directs them to register instead.
    if (!user) return R.bad('No account found with this email. Please register first.');
    const otp=String(Math.floor(100000+Math.random()*900000));
    resetOtps.set(email.toLowerCase(),{otp,exp:Date.now()+10*60*1000});
    console.log('[PFC] OTP generated for:', email, '(value not logged)');
    // Actually email the OTP to the user
    const result = await sendOtpEmail(user.email, otp);
    if (!result.sent) {
      resetOtps.delete(email.toLowerCase()); // clean up so the user can retry
      console.error('[PFC] OTP_EMAIL_FAILED, reason:', result.reason);
      return R.err('Could not send reset email. Please try again later or contact support.');
    }
    return R.ok({},'Reset code sent! Check your email (and spam/junk folder).');
  }

  if (method==='POST' && path==='/api/auth/reset-password') {
    const {email,otp,newPassword}=body;
    if (!email||!otp||!newPassword) return R.bad('All fields required.');
    if (newPassword.length<8) return R.bad('Password must be at least 8 characters.');
    const record=resetOtps.get(email.toLowerCase());
    if (!record) return R.bad('No reset request found.');
    if (Date.now()>record.exp) { resetOtps.delete(email.toLowerCase()); return R.bad('Code expired.'); }
    if (record.otp!==otp) return R.bad('Invalid code.');
    const user=await User.findOne({email:email.toLowerCase()});
    if (!user) return R.bad('User not found.');
    // Assign plain text — userSchema.pre('save') handles hashing.
    // Do NOT manually bcrypt.hash here or the password gets double-hashed
    // (hash-of-hash) and every subsequent login will fail with 'invalid password'.
    user.password = newPassword;
    await user.save(); resetOtps.delete(email.toLowerCase());
    return R.ok({},'Password reset successfully.');
  }


  // ── BOOTSTRAP: one call returns fruits + user (replaces 2 separate calls) ──
  // Frontend calls this ONCE at init() instead of GET /fruits + GET /auth/me
  if (method==='GET' && path==='/api/bootstrap') {
    const [fruitsRes, userRes] = await Promise.all([
      // Fetch fruits (same query as GET /fruits with limit=100)
      Fruit.find({ isAvailable: true, isDeleted: false })
        .sort({ isFeatured: -1, createdAt: -1 }).limit(100).lean(),
      // Fetch user if authenticated
      (async () => {
        if (!event.headers.authorization && !event.headers.Authorization) return null;
        const auth = await authenticate(event.headers);
        if (auth.err) return null;
        return User.findById(auth.user._id).populate('wishlist', 'name emoji price slug');
      })(),
    ]);
    return {
      ...R.ok({ fruits: fruitsRes, user: userRes || null }),
      headers: {
        ...R.ok({}).headers,
        // private = CDN must NOT cache (contains user data). Browser can cache briefly.
        'Cache-Control': 'private, max-age=0, no-store',
      }
    };
  }

  // ── FRUITS: public ──────────────────────────────────────────

  if (method==='GET' && path==='/api/fruits') {
    const filter={isAvailable:true,isDeleted:false};
    const {category,search,minPrice,maxPrice,featured,inStock,tag}=q;
    if (category&&category!=='All') filter.category={$regex:'^'+category+'$',$options:'i'};
    if (featured==='true')  filter.isFeatured=true;
    if (inStock==='true')   filter.stock={$gt:0};
    if (tag)                filter.tags=tag;
    if (minPrice||maxPrice) { filter.price={}; if(minPrice)filter.price.$gte=+minPrice; if(maxPrice)filter.price.$lte=+maxPrice; }
    if (search) filter.$or=[{name:{$regex:search,$options:'i'}},{variety:{$regex:search,$options:'i'}}];
    let sort={isFeatured:-1,createdAt:-1};
    if (q.sort==='price_asc')  sort={price:1};
    if (q.sort==='price_desc') sort={price:-1};
    if (q.sort==='name')       sort={name:1};
    if (q.sort==='popular')    sort={totalSold:-1};
    const page=Math.max(1,+q.page||1),limit=Math.min(100,+q.limit||50);
    const [fruits,total]=await Promise.all([
      Fruit.find(filter).sort(sort).skip((page-1)*limit).limit(limit).lean(),
      Fruit.countDocuments(filter)
    ]);
    // Cache fruits list at CDN for 30s max so newly added fruits appear quickly.
    return {
      ...R.ok({fruits,pagination:{page,limit,total,pages:Math.ceil(total/limit)}}),
      headers: {
        ...R.ok({}).headers,
        'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=10',
        'Vary': 'Accept-Encoding',
      }
    };
  }

  if (method==='GET' && path==='/api/fruits/featured') {
    const fruits=await Fruit.find({isFeatured:true,isAvailable:true,isDeleted:false}).sort({totalSold:-1}).limit(8).lean();
    return {
      ...R.ok({fruits}),
      headers: { ...R.ok({}).headers, 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60' }
    };
  }

  if (method==='GET' && path==='/api/fruits/categories') {
    const cats=await Fruit.aggregate([
      {$match:{isAvailable:true,isDeleted:false}},
      {$group:{_id:'$category',count:{$sum:1},minPrice:{$min:'$price'}}},
      {$sort:{count:-1}}
    ]);
    return {
      ...R.ok({categories:cats}),
      headers: { ...R.ok({}).headers, 'Cache-Control': 'public, max-age=120, s-maxage=600' }
    };
  }

  if (method==='GET' && path==='/api/fruits/search') {
    const {q:sq}=q;
    if (!sq) return R.bad('Query required.');
    const fruits=await Fruit.find({isAvailable:true,isDeleted:false,$or:[
      {name:{$regex:sq,$options:'i'}},{variety:{$regex:sq,$options:'i'}},{tags:{$regex:sq,$options:'i'}}
    ]}).limit(10).lean();
    return R.ok({fruits,count:fruits.length});
  }

  if (method==='GET' && path==='/api/fruits/admin/all') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const page=Math.max(1,+q.page||1),limit=Math.min(100,+q.limit||50);
    const filter={isDeleted:{$ne:true}};
    if (q.search) filter.$or=[{name:{$regex:q.search,$options:'i'}},{variety:{$regex:q.search,$options:'i'}}];
    if (q.category) filter.category={$regex:'^'+q.category+'$',$options:'i'};
    const [fruits,total]=await Promise.all([
      Fruit.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit),
      Fruit.countDocuments(filter)
    ]);
    return R.ok({fruits,total,page,pages:Math.ceil(total/limit)});
  }

  if (method==='POST' && path==='/api/fruits/upload-image') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    try {
      const {fileBuffer,fileMime}=await parseMultipartUpload(event);
      if (!fileBuffer) return R.bad('No image received.');
      if (!['image/jpeg','image/png','image/webp'].includes(fileMime)) return R.bad('Images only (jpg/png/webp).');
      if (fileBuffer.length>5*1024*1024) return R.bad('Image must be under 5MB.');
      const result=await uploadToCloudinary(fileBuffer,fileMime);
      return R.ok({url:result.secure_url,publicId:result.public_id},'Image uploaded');
    } catch(e) { return R.err(e.message||'Upload failed.'); }
  }

  if (method==='DELETE' && path==='/api/fruits/delete-image') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const {publicId}=body;
    if (!publicId) return R.bad('publicId required.');
    await deleteFromCloudinary(publicId);
    return R.ok({},'Deleted.');
  }

  if (method==='POST' && path==='/api/fruits') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    try {
      const { fileBuffer, fileMime, fields } = await parseMultipartUpload(event);
      let imageUrl = fields.imageUrl || '';
      if (fileBuffer && fileBuffer.length > 0) {
        if (!['image/jpeg','image/png','image/webp'].includes(fileMime)) return R.bad('Images only (jpg/png/webp).');
        if (fileBuffer.length > 5*1024*1024) return R.bad('Image must be under 5MB.');
        const uploaded = await uploadToCloudinary(fileBuffer, fileMime);
        imageUrl = uploaded.secure_url;
      }
      let fruit_images;
      try { fruit_images = fields.fruit_images ? JSON.parse(fields.fruit_images) : (imageUrl ? [imageUrl] : []); }
      catch(_) { fruit_images = imageUrl ? [imageUrl] : []; }
      let benefits;
      try { benefits = fields.benefits ? JSON.parse(fields.benefits) : []; }
      catch(_) { benefits = []; }
      let customUnits;
      try { customUnits = fields.customUnits ? JSON.parse(fields.customUnits) : []; }
      catch(_) { customUnits = []; }
      let origin;
      try { origin = fields.origin ? JSON.parse(fields.origin) : {}; }
      catch(_) { origin = {}; }
      const fruit = await Fruit.create({
        name:              fields.name,
        variety:           fields.variety || fields.name,
        category:          fields.category || 'Daily',
        emoji:             fields.emoji || '🍎',
        price:             Number(fields.price),
        stock:             Number(fields.quantity || fields.stock || 0),
        discountPercent:   Number(fields.discountPercent || 0),
        description:       fields.description || '',
        benefits,
        unitType:          fields.unitType || 'weight',
        customUnits,
        badge:             fields.badge || '',
        badgeLabel:        fields.badgeLabel || '',
        isFeatured:        fields.isFeatured === 'true',
        isAvailable:       fields.isAvailable !== 'false',
        lowStockThreshold: Number(fields.lowStockThreshold || 5),
        origin,
        imageUrl,
        fruit_images,
      });
      return {
        ...R.created({ fruit }, 'Fruit added'),
        headers: { ...R.ok({}).headers, 'Cache-Control': 'no-store' }
      };
    } catch(e) { return R.err(e.message || 'Failed to create fruit.'); }
  }

  if (method==='PATCH' && /^\/api\/fruits\/[^/]+\/stock$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[3];
    const {stock}=body;
    if (stock===undefined||stock<0) return R.bad('Valid stock required.');
    const fruit=await Fruit.findByIdAndUpdate(id,{stock:+stock},{new:true});
    if (!fruit) return R.nf('Fruit not found.');
    return R.ok({fruit},'Stock updated');
  }

  if (method==='PATCH' && /^\/api\/fruits\/[^/]+\/price$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[3];
    const {price,discountPercent}=body;
    if (!price||price<1) return R.bad('Valid price required.');
    const up={price:+price};
    if (discountPercent!==undefined) up.discountPercent=+discountPercent;
    const fruit=await Fruit.findByIdAndUpdate(id,up,{new:true});
    if (!fruit) return R.nf('Fruit not found.');
    return R.ok({fruit},'Price updated');
  }

  if (method==='GET' && path.startsWith('/api/fruits/slug/')) {
    const slug=path.split('/').pop();
    const fruit=await Fruit.findOne({slug,isAvailable:true,isDeleted:false});
    if (!fruit) return R.nf('Fruit not found.');
    const reviews=await Review.find({fruit:fruit._id,isApproved:true}).populate('user','name').sort({createdAt:-1}).limit(10);
    return R.ok({fruit,reviews});
  }

  if (method==='GET' && /^\/api\/fruits\/[^/]+\/my-review$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const id=path.split('/')[3];
    const review=await Review.findOne({fruit:id,user:auth.user._id}).lean();
    return R.ok({review:review||null});
  }

  if (method==='GET' && /^\/api\/fruits\/[^/]+\/reviews$/.test(path)) {
    const id=path.split('/')[3];
    const page=Math.max(1,+q.page||1),limit=Math.min(20,+q.limit||10);
    const [reviews,total]=await Promise.all([
      Review.find({fruit:id,isApproved:true}).populate('user','name role').sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      Review.countDocuments({fruit:id,isApproved:true})
    ]);
    // Filter out admin test reviews before returning
    const filteredRevs = reviews.filter(rv => !rv.user || rv.user.role !== 'admin');
    const filteredTotal = total - (reviews.length - filteredRevs.length);
    // Cache reviews at CDN for 5 min — they change only when a new review is submitted.
    // Browser also caches for 60s so rapid popup open/close is free.
    return {
      ...R.ok({reviews:filteredRevs,total:filteredTotal,page,pages:Math.ceil(filteredTotal/limit)}),
      headers: {
        ...R.ok({}).headers,
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
        'Vary': 'Accept-Encoding',
      }
    };
  }

  if (method==='POST' && /^\/api\/fruits\/[^/]+\/reviews$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const id=path.split('/')[3];
    const {rating,title,comment}=body;
    if (!rating||rating<1||rating>5) return R.bad('Rating 1-5 required.');
    if (await Review.findOne({fruit:id,user:auth.user._id})) return R.bad('Already reviewed.');
    const review=await Review.create({fruit:id,user:auth.user._id,rating,title,comment});
    await review.populate('user','name');
    return R.created({review},'Review added!');
  }

  if (method==='PUT' && /^\/api\/fruits\/[^/]+\/reviews$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const id=path.split('/')[3];
    const {rating,comment}=body;
    if (!rating||rating<1||rating>5) return R.bad('Rating 1-5 required.');
    const review=await Review.findOneAndUpdate(
      {fruit:id,user:auth.user._id},
      {rating,comment,updatedAt:new Date()},
      {new:true}
    );
    if (!review) return R.bad('No existing review to edit.');
    await review.populate('user','name');
    return R.ok({review},'Review updated!');
  }

  // GET /api/reviews/home — public, returns top reviews (rating>=4, approved) for homepage
  if (method==='GET' && path==='/api/reviews/home') {
    const { Review: ReviewM, Fruit: FruitM } = getModels();
    const limit = Math.min(20, parseInt(q.limit)||12);
    const reviews = await ReviewM.find({ isApproved: true, rating: { $gte: 4 } })
      .populate('user', 'name role')
      .populate('fruit', 'name emoji')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const publicReviews = reviews.filter(rv => !rv.user || rv.user.role !== 'admin');
    return R.ok({ reviews: publicReviews });
  }

  if (method==='PATCH' && /^\/api\/fruits\/[^/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id = path.split('/').pop();
    try {
      const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '');
      const isJson = contentType.includes('application/json') || (!contentType.includes('multipart/form-data') && body && Object.keys(body).length > 0);

      let fields, fileBuffer = null, fileMime = '';
      if (isJson) {
        // JSON body — inline price/stock/visibility edits from admin panel
        fields = { ...body };
        // Coerce array/object fields that come pre-parsed from JSON
        if (Array.isArray(fields.benefits))    fields.benefits    = JSON.stringify(fields.benefits);
        if (Array.isArray(fields.customUnits)) fields.customUnits = JSON.stringify(fields.customUnits);
        if (typeof fields.origin === 'object' && fields.origin !== null) fields.origin = JSON.stringify(fields.origin);
        if (Array.isArray(fields.fruit_images)) fields.fruit_images = JSON.stringify(fields.fruit_images);
        // Normalise booleans sent as real booleans (not strings)
        if (typeof fields.isFeatured === 'boolean') fields.isFeatured = String(fields.isFeatured);
        if (typeof fields.isAvailable === 'boolean') fields.isAvailable = String(fields.isAvailable);
      } else {
        // Multipart — full edit form with optional image upload
        const parsed = await parseMultipartUpload(event);
        fields = parsed.fields; fileBuffer = parsed.fileBuffer; fileMime = parsed.fileMime;
      }

      let imageUrl = fields.imageUrl || undefined;
      if (fileBuffer && fileBuffer.length > 0) {
        if (!['image/jpeg','image/png','image/webp'].includes(fileMime)) return R.bad('Images only (jpg/png/webp).');
        if (fileBuffer.length > 5*1024*1024) return R.bad('Image must be under 5MB.');
        const uploaded = await uploadToCloudinary(fileBuffer, fileMime);
        imageUrl = uploaded.secure_url;
      }
      const up = {};
      if (fields.name !== undefined)            up.name = fields.name;
      if (fields.variety !== undefined)         up.variety = fields.variety;
      if (fields.category !== undefined)        up.category = fields.category;
      if (fields.emoji !== undefined)           up.emoji = fields.emoji;
      if (fields.price !== undefined)           up.price = Number(fields.price);
      if (fields.quantity !== undefined)        up.stock = Number(fields.quantity);
      if (fields.stock !== undefined)           up.stock = Number(fields.stock);
      if (fields.discountPercent !== undefined) up.discountPercent = Number(fields.discountPercent);
      if (fields.description !== undefined)     up.description = fields.description;
      if (fields.benefits !== undefined)        { try { up.benefits = typeof fields.benefits === 'string' ? JSON.parse(fields.benefits) : fields.benefits; } catch(_) {} }
      if (fields.unitType !== undefined)        up.unitType = fields.unitType;
      if (fields.customUnits !== undefined)     { try { up.customUnits = typeof fields.customUnits === 'string' ? JSON.parse(fields.customUnits) : fields.customUnits; } catch(_) {} }
      if (fields.badge !== undefined)           up.badge = fields.badge;
      if (fields.badgeLabel !== undefined)      up.badgeLabel = fields.badgeLabel;
      if (fields.isFeatured !== undefined)      up.isFeatured = fields.isFeatured === 'true' || fields.isFeatured === true;
      if (fields.isAvailable !== undefined)     up.isAvailable = fields.isAvailable !== 'false' && fields.isAvailable !== false;
      if (fields.lowStockThreshold !== undefined) up.lowStockThreshold = Number(fields.lowStockThreshold);
      if (fields.origin !== undefined)          { try { up.origin = typeof fields.origin === 'string' ? JSON.parse(fields.origin) : fields.origin; } catch(_) {} }
      if (fields.fruit_images !== undefined)    { try { up.fruit_images = typeof fields.fruit_images === 'string' ? JSON.parse(fields.fruit_images) : fields.fruit_images; } catch(_) {} }
      if (imageUrl)                             up.imageUrl = imageUrl;
      const fruit = await Fruit.findByIdAndUpdate(id, { $set: up }, { new: true, runValidators: true });
      if (!fruit) return R.nf('Fruit not found.');
      return R.ok({ fruit }, 'Updated');
    } catch(e) { return R.err(e.message || 'Failed to update fruit.'); }
  }

  if (method==='DELETE' && /^\/api\/fruits\/[^/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/').pop();
    const fruit=await Fruit.findByIdAndDelete(id);
    if (!fruit) return R.nf('Fruit not found.');
    return R.ok({},'Fruit permanently deleted.');
  }

  if (method==='GET' && /^\/api\/fruits\/[^/]+$/.test(path)) {
    const id=path.split('/').pop();
    const fruit=await Fruit.findOne({_id:id,isDeleted:false});
    if (!fruit) return R.nf('Fruit not found.');
    return R.ok({fruit});
  }

  // ── ORDERS ──────────────────────────────────────────────────

  if (method==='POST' && path==='/api/orders') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const {items,customerName,customerPhone,deliveryAddress,orderNotes,paymentMethod,orderToken}=body;
    if (!orderToken)                                          return R.bad('orderToken required (idempotency key missing).');
    if (!items?.length)                              return R.bad('Items required.');
    if (!customerName||!customerPhone)               return R.bad('Name and phone required.');
    if (!deliveryAddress?.street||!deliveryAddress?.pincode) return R.bad('Address required.');
    if (!['cod','upi','razorpay'].includes(paymentMethod))   return R.bad('Invalid payment method.');

    // ── IDEMPOTENCY CHECK 1: orderToken (primary — UUID from frontend, REQUIRED) ──
    const existing = await Order.findOne({ orderToken });
    if (existing) {
      console.log(`[PFC] DUPLICATE_ORDER_PREVENTED orderToken:${orderToken} userId:${auth.user._id} ip:${clientIP}`);
      return R.ok({ order: existing }, 'Order already placed (duplicate prevented).');
    }

    // ── GPS coordinates — required for delivery navigation
    const hasGPS = deliveryAddress.lat && deliveryAddress.lng &&
                   Math.abs(+deliveryAddress.lat) <= 90 && Math.abs(+deliveryAddress.lng) <= 180;

    // ── STRICT VALIDATION (Task 13) ───────────────────────────
    // 1. Verify user still exists and is active
    const userCheck = await User.findById(auth.user._id).select('_id isActive');
    if (!userCheck || !userCheck.isActive) return R.bad('User account not found or inactive.');
    // 2. Cart must not be empty (belt-and-suspenders after items?.length check)
    if (!Array.isArray(items) || items.length === 0) return R.bad('Cart is empty.');
    // 3. Validate totalAmount from client is a positive number (will be recomputed server-side but sanity check early)
    if (body.totalAmount !== undefined && (isNaN(+body.totalAmount) || +body.totalAmount <= 0))
      return R.bad('Invalid totalAmount.');

    const { Juice: JuiceM } = getModels();
    const resolved=[]; let subtotal=0;
    for (const item of items) {
      const looksLikeJuice=item.isJuice||!item.fruit||!mongoose.Types.ObjectId.isValid(item.fruit);
      if (looksLikeJuice) {
        // ── SERVER-SIDE JUICE VALIDATION ──────────────────────────
        // Look up the juice in DB by its ID to verify it still exists and is active.
        // This prevents Cloudflare-cached pages from placing orders for deleted/unavailable juices.
        const juiceId = item.juiceId || item.fruit || '';
        let juiceDoc = null;
        if (juiceId) {
          // Try by _id first (ObjectId), then by the custom string id field
          if (mongoose.Types.ObjectId.isValid(juiceId)) {
            juiceDoc = await JuiceM.findById(juiceId).lean();
          }
          if (!juiceDoc) {
            juiceDoc = await JuiceM.findOne({ id: juiceId }).lean();
          }
        }
        if (!juiceDoc) {
          return R.bad(`"${item.name || 'A juice'}" is no longer available. Please refresh and update your cart.`);
        }
        if (juiceDoc.status === 'unavailable' || juiceDoc.status === 'deleted') {
          return R.bad(`"${juiceDoc.name}" is currently unavailable. Please update your cart.`);
        }
        // Use DB price — never trust client-supplied price
        const dbPrice = juiceDoc.discountPercent > 0
          ? parseFloat((juiceDoc.price * (1 - juiceDoc.discountPercent / 100)).toFixed(2))
          : juiceDoc.price;
        const qty=Math.max(1,+item.quantity||1);
        const sub=parseFloat((dbPrice*qty).toFixed(2));
        const wl=item.weightLabel||(item.weightGrams?item.weightGrams+'ml':'');
        resolved.push({isJuice:true,juiceId:juiceId,name:juiceDoc.name,emoji:juiceDoc.emoji||item.emoji||'🧃',pricePerKg:dbPrice,weightGrams:+(item.weightGrams||juiceDoc.moo||500),weightLabel:wl,quantity:qty,subtotal:sub});
        subtotal+=sub; continue;
      }
      const f=await Fruit.findById(item.fruit);
      if (!f||!f.isAvailable||f.isDeleted) return R.bad('Fruit unavailable.');
      if (f.stock<=0) return R.bad(`${f.name} is out of stock.`);
      if (!isValidWeight(item.weightGrams)) return R.bad(`Invalid weight: ${item.weightGrams}g.`);
      const qty=Math.max(1,+item.quantity||1);
      const reqKg=(+item.weightGrams/1000)*qty;
      if (reqKg>f.stock) return R.bad(`Only ${f.stock}kg of ${f.name} available.`);
      const pp=f.effectivePrice;
      const sub=(item.clientSubtotal&&item.clientSubtotal>0)
        ? parseFloat(item.clientSubtotal.toFixed(2))
        : parseFloat((pp*(item.weightGrams/1000)*qty).toFixed(2));
      const wl=item.weightGrams>=1000?(item.weightGrams/1000)+'kg':item.weightGrams+'g';
      resolved.push({fruit:f._id,name:f.name,emoji:f.emoji,variety:f.variety,pricePerKg:pp,weightGrams:+item.weightGrams,weightLabel:wl,quantity:qty,subtotal:sub});
      subtotal+=sub;
    }
    const totalKgOrdered=resolved.filter(i=>!i.isJuice).reduce((s,i)=>(s+(i.weightGrams/1000)*i.quantity),0);
    if (totalKgOrdered>100) return R.bad(`Order exceeds 100kg limit.`);

    // ── PINCODE-BASED DELIVERY FEE ────────────────────────────
    // Default charges (fallback if not configured in admin settings):
    //   Warangal pincodes (506001-506015): ₹40
    //   Hanamkonda pincodes (506001,506370-506380): ₹50
    //   Kazipet pincodes (506003,506004): ₹60
    const DEFAULT_PINCODE_FEES = {
      '506001': 40, '506002': 40, '506005': 40, '506006': 40,
      '506007': 40, '506008': 40, '506009': 40, '506010': 40,
      '506011': 40, '506013': 40, '506015': 40,
      '506370': 50, '506371': 50, '506372': 50,
      '506003': 60, '506004': 60,
    };
    const { Settings: SettingsM } = getModels();
    const pincodeFeeSetting = await SettingsM.findOne({ key: 'pincode_delivery_fees' }).lean();
    const pincodeFees = (pincodeFeeSetting && typeof pincodeFeeSetting.value === 'object' && !Array.isArray(pincodeFeeSetting.value))
      ? pincodeFeeSetting.value
      : DEFAULT_PINCODE_FEES;
    const orderPincode = (deliveryAddress.pincode || '').trim();
    const deliveryFee = pincodeFees[orderPincode] !== undefined ? pincodeFees[orderPincode] : 50; // default ₹50 for unknown pincodes

    // ── SERVER-SIDE COUPON VALIDATION ─────────────────────────────────────
    // coupon code is optional — sent by frontend as body.coupon
    let couponDiscount = 0;
    let appliedCouponCode = null;
    let appliedCouponId   = null;
    if (body.coupon) {
      const { Settings } = getModels();
      const couponSetting = await Settings.findOne({ key: 'coupons' }).lean();
      const coupons = Array.isArray(couponSetting?.value) ? couponSetting.value : [];
      const now = new Date();
      const coupon = coupons.find(c =>
        c.code === String(body.coupon).trim().toUpperCase() &&
        c.status === 'active' &&
        (!c.expiryDate || new Date(c.expiryDate) >= now)
      );
      if (coupon) {
        if (!coupon.minOrder || subtotal >= coupon.minOrder) {
          couponDiscount = parseFloat((subtotal * coupon.discountPercent / 100).toFixed(2));
          appliedCouponCode = coupon.code;
          appliedCouponId   = coupon.id;
        }
        // If minOrder not met, silently ignore coupon (don't block order)
      }
      // Unknown or expired coupon — silently ignore (don't block order)
    }

    const totalAmount=parseFloat((subtotal + deliveryFee - couponDiscount).toFixed(2));
    const initialPaymentStatus=(paymentMethod==='upi'||paymentMethod==='razorpay')?'paid':'pending';

    // ── IDEMPOTENCY CHECK 2: time-window fallback (catches token-less retries) ──
    // Only block if SAME total AND same item names — allows up to 5 genuinely different orders in the same timestamp.
    const recentOrders = await Order.find({
      user: auth.user._id,
      createdAt: { $gte: new Date(Date.now() - 10000) }
    }).lean();
    if (recentOrders.length > 0) {
      const incomingItemKey = resolved.map(i => (i.name || '') + ':' + i.weightGrams).sort().join('|');
      const trueDuplicate = recentOrders.find(ro => {
        const existingKey = (ro.items || []).map(i => (i.name || '') + ':' + i.weightGrams).sort().join('|');
        return Math.abs((ro.totalAmount || 0) - totalAmount) < 0.01 && existingKey === incomingItemKey;
      });
      if (trueDuplicate) {
        console.log(`[PFC] RECENT_DUPLICATE_PREVENTED userId:${auth.user._id} amount:${totalAmount} ip:${clientIP}`);
        return R.ok({ order: trueDuplicate }, 'Recent duplicate order prevented.');
      }
      // Allow up to 5 concurrent different orders — block if this would be the 6th
      if (recentOrders.length >= 5) {
        console.log(`[PFC] ORDER_RATE_LIMIT userId:${auth.user._id} recent:${recentOrders.length} ip:${clientIP}`);
        return R.bad('Too many orders placed at once. Please wait a moment before placing another order.');
      }
    }

    // Build orderNotes — append coupon info if applied
    const couponNote = appliedCouponCode
      ? ` [Coupon: ${appliedCouponCode} -₹${couponDiscount.toFixed(0)}]` : '';
    const finalOrderNotes = (orderNotes || '') + couponNote;

    const order=await Order.create({
      user:auth.user._id, customerName, customerPhone, customerEmail:auth.user.email,
      items:resolved,
      orderToken: orderToken, // always required — frontend must supply UUID
      deliveryAddress:{
        street:deliveryAddress.street,
        city:deliveryAddress.city||'Warangal',
        state:deliveryAddress.state||'Telangana',
        pincode:deliveryAddress.pincode,
        lat: hasGPS ? +deliveryAddress.lat : null,
        lng: hasGPS ? +deliveryAddress.lng : null,
        mapsUrl: deliveryAddress.mapsUrl || (hasGPS ? `https://maps.google.com/?q=${deliveryAddress.lat},${deliveryAddress.lng}` : ''),
      },
      orderNotes: finalOrderNotes, subtotal, deliveryFee, totalAmount, paymentMethod,
      paymentStatus:initialPaymentStatus,
      statusHistory:[{status:'placed'}],
      estimatedDelivery:new Date(Date.now()+24*36e5),
    });

    for (const it of resolved) {
      if (it.isJuice) continue;
      const deductKg=(it.weightGrams/1000)*it.quantity;
      await Fruit.findByIdAndUpdate(it.fruit,{$inc:{stock:-deductKg,totalSold:deductKg}});
    }

    // ── UPDATE COUPON USAGE STATS in MongoDB ───────────────────
    if (appliedCouponId && couponDiscount > 0) {
      try {
        const { Settings } = getModels();
        const couponSetting = await Settings.findOne({ key: 'coupons' });
        if (couponSetting && Array.isArray(couponSetting.value)) {
          const idx = couponSetting.value.findIndex(c => c.id === appliedCouponId);
          if (idx > -1) {
            couponSetting.value[idx].usageCount    = (couponSetting.value[idx].usageCount    || 0) + 1;
            couponSetting.value[idx].totalDiscount = (couponSetting.value[idx].totalDiscount || 0) + couponDiscount;
            couponSetting.markModified('value');
            await couponSetting.save();
          }
        }
      } catch(e) { console.warn('[PFC] Coupon usage update failed:', e.message); }
    }
    const itemSummary=resolved.slice(0,3).map(i=>`${i.emoji||'🍎'} ${i.name}`).join(', ');
    const pushTitle = `🛒 New Order — ₹${totalAmount.toFixed(0)}`;
    const pushBody  = `${customerName} · ${itemSummary}${resolved.length>3?' +more':''}`;
    // Notify admins
    sendPushToAdmins(pushTitle, pushBody,
      { url:'/?page=admin&tab=orders', orderId:order.orderId }
    ).catch(()=>{});
    // Notify all on-duty drivers immediately
    sendPushToDrivers(
      `🚴 New Delivery Available — ₹${totalAmount.toFixed(0)}`,
      `${customerName} · Tap to accept`,
      { url:'/?page=driver', orderId:order.orderId }
    ).catch(()=>{});
    // Send email to owners
    sendOrderEmail(order).catch(e => console.error('[PFC] sendOrderEmail uncaught:', e.message));
    console.log(`[PFC] ORDER_CREATED orderId:${order.orderId} orderToken:${orderToken} userId:${auth.user._id} ip:${clientIP} amount:${totalAmount}${appliedCouponCode?' coupon:'+appliedCouponCode+' discount:'+couponDiscount:''}`);
    return R.created({ order, couponDiscount, appliedCoupon: appliedCouponCode }, 'Order placed! 🎉');
  }

  if (method==='GET' && path==='/api/orders/my') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const page=Math.max(1,+q.page||1),limit=Math.min(50,+q.limit||10);
    const [orders,total]=await Promise.all([
      Order.find({user:auth.user._id}).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      Order.countDocuments({user:auth.user._id})
    ]);
    return R.ok({orders,pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
  }

  if (method==='GET' && path==='/api/orders/admin/all') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const page=Math.max(1,+q.page||1),limit=Math.min(100,+q.limit||20);
    const filter={};
    if (q.status) filter.status=q.status;
    if (q.search) filter.$or=[{orderId:{$regex:q.search,$options:'i'}},{customerName:{$regex:q.search,$options:'i'}}];
    const [orders,total]=await Promise.all([
      Order.find(filter).populate('user','name email phone').sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      Order.countDocuments(filter)
    ]);
    return R.ok({orders,pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
  }

  if (method==='GET' && path==='/api/orders/admin/analytics') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const days=+(q.days||30),since=new Date(Date.now()-days*864e5);
    const [tot,rev,stat,top,daily]=await Promise.all([
      Order.countDocuments({createdAt:{$gte:since},status:{$ne:'cancelled'}}),
      Order.aggregate([{$match:{createdAt:{$gte:since},status:{$ne:'cancelled'}}},{$group:{_id:null,total:{$sum:'$totalAmount'},avg:{$avg:'$totalAmount'}}}]),
      Order.aggregate([{$match:{createdAt:{$gte:since}}},{$group:{_id:'$status',count:{$sum:1}}}]),
      Order.aggregate([{$match:{createdAt:{$gte:since},status:{$ne:'cancelled'}}},{$unwind:'$items'},{$group:{_id:'$items.name',revenue:{$sum:'$items.subtotal'},qty:{$sum:'$items.quantity'}}},{$sort:{revenue:-1}},{$limit:5}]),
      Order.aggregate([{$match:{createdAt:{$gte:since},status:{$ne:'cancelled'}}},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$createdAt'}},orders:{$sum:1},revenue:{$sum:'$totalAmount'}}},{$sort:{_id:1}}])
    ]);
    return R.ok({period:`Last ${days} days`,summary:{totalOrders:tot,totalRevenue:rev[0]?.total||0,avgOrderValue:rev[0]?.avg||0},statusBreakdown:stat,topFruits:top,dailySales:daily});
  }

  if (method==='POST' && path==='/api/orders/admin/fix-payment-status') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const orders=await Order.find({});
    let fixed=0;
    for (const o of orders) {
      let changed=false;
      const pm=(o.paymentMethod||'').toLowerCase();
      if ((pm==='upi'||pm==='razorpay')&&o.paymentStatus==='pending'){o.paymentStatus='paid';changed=true;}
      if (o.status==='delivered'&&o.paymentStatus==='pending'){o.paymentStatus='paid';changed=true;}
      if (o.status==='cancelled'&&o.paymentStatus==='pending'){o.paymentStatus='failed';changed=true;}
      if (changed){await o.save();fixed++;}
    }
    return R.ok({fixed},`Fixed ${fixed} orders`);
  }

  if (method==='GET' && /^\/api\/orders\/admin\/[^/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const orderId=path.split('/').pop();
    const order=await Order.findOne({orderId}).populate('user','name email phone');
    if (!order) return R.nf('Order not found.');
    return R.ok({order});
  }

  if (method==='PATCH' && /^\/api\/orders\/admin\/[^/]+\/status$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const parts=path.split('/');
    const orderId=parts[4];
    const {status,note}=body;
    if (!['confirmed','packed','out_for_delivery','dispatched','delivered','cancelled'].includes(status)) return R.bad('Invalid status.');
    const order=await Order.findOne({orderId});
    if (!order) return R.nf('Order not found.');
    order.status=status;
    if (note) order.statusHistory[order.statusHistory.length-1].note=note;
    if (status==='delivered') order.paymentStatus='paid';
    if (status==='cancelled'&&order.paymentStatus==='pending') order.paymentStatus='failed';
    await order.save();

    // ── Push customer so they don't need to poll ─────────────────
    // When admin updates status, we fire a push to the customer's device.
    // This makes order tracking event-driven instead of poll-driven,
    // eliminating up to 4,320 /api/orders/track calls per day.
    const STATUS_MSG = {
      confirmed:       '✅ Your order has been confirmed!',
      packed:          '📦 Your order is packed and ready.',
      out_for_delivery:'🚴 Your order is on the way!',
      dispatched:      '🚴 Your order has been dispatched.',
      delivered:       '✅ Delivered! Enjoy your fruits 🍎',
      cancelled:       '❌ Your order has been cancelled.',
    };
    if (STATUS_MSG[status]) {
      sendPushToUser(
        order.user,
        'Padmavathi Fruits — Order ' + order.orderId,
        STATUS_MSG[status],
        { url: '/?page=profile', orderId: order.orderId }
      ).catch(() => {});
    }

    return R.ok({order},`Status: ${status}`);
  }

  if (method==='DELETE' && /^\/api\/orders\/admin\/[^/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const orderId=path.split('/').pop();
    const order=await Order.findOne({orderId});
    if (!order) return R.nf('Order not found.');
    await order.deleteOne();
    return R.ok({},'Order deleted.');
  }

  // ── ORDER TRACKING — user polls this to see live driver location ──
  if (method==='GET' && /^\/api\/orders\/track\/[^/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const orderId=path.split('/').pop();
    const order=await Order.findOne({orderId}).lean();
    if (!order) return R.nf('Order not found.');
    // Only allow order owner or admin/driver
    if (auth.user.role==='user' && order.user.toString()!==auth.user._id.toString()) return R.noauth();
    return R.ok({
      orderId:         order.orderId,
      status:          order.status,
      assignedDriverName:  order.assignedDriverName  || null,
      assignedDriverPhone: order.assignedDriverPhone || null,
      driverLat:       order.driverLat  || null,
      driverLng:       order.driverLng  || null,
      driverLocationUpdatedAt: order.driverLocationUpdatedAt || null,
      deliveryAddress: order.deliveryAddress,
    });
  }

  if (method==='GET' && /^\/api\/orders\/[^/]+$/.test(path) && !path.includes('/admin/') && !path.includes('/track/')) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const orderId=path.split('/').pop();
    const order=await Order.findOne({orderId}).populate('user','name email phone');
    if (!order) return R.nf('Order not found.');
    if (auth.user.role!=='admin'&&order.user._id.toString()!==auth.user._id.toString()) return R.noauth();
    return R.ok({order});
  }

  if (method==='PATCH' && /^\/api\/orders\/[^/]+\/cancel$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    const orderId=path.split('/')[3];
    const order=await Order.findOne({orderId,user:auth.user._id});
    if (!order) return R.nf('Order not found.');
    if (!['placed','confirmed'].includes(order.status)) return R.bad(`Cannot cancel "${order.status}" order.`);
    order.status='cancelled'; order.cancellationReason=body.reason||'Customer request';
    await order.save();
    for (const it of order.items) await Fruit.findByIdAndUpdate(it.fruit,{$inc:{stock:(it.weightGrams/1000)*it.quantity,totalSold:-((it.weightGrams/1000)*it.quantity)}});
    return R.ok({order},'Cancelled');
  }


  // ── ADMIN: lightweight new-order poll (replaces full order list fetch) ──
  // Returns ONLY count + latest orderId — no full document scan
  // Frontend compares count to trigger UI notification
  if (method==='GET' && path==='/api/admin/new-orders-check') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const since = q.since ? new Date(+q.since) : new Date(Date.now() - 6 * 60 * 1000); // 6 min window (frontend polls every 5 min)
    const [pendingCount, latestOrder] = await Promise.all([
      Order.countDocuments({ status: { $in: ['placed', 'confirmed'] } }),
      Order.findOne({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).select('orderId createdAt').lean(),
    ]);
    return R.ok({ pendingCount, latestOrderId: latestOrder?.orderId || null, serverTs: Date.now() });
  }

  // ── ADMIN ────────────────────────────────────────────────────

  if (method==='GET' && path==='/api/admin/dashboard') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const today=new Date(); today.setHours(0,0,0,0);
    const [tu,tf,to,pend,tod,rev,totalRev,low,recent]=await Promise.all([
      User.countDocuments({role:'user',isActive:true}),
      Fruit.countDocuments({isAvailable:true,isDeleted:false}),
      Order.countDocuments({status:{$ne:'cancelled'}}),
      Order.countDocuments({status:{$in:['placed','confirmed']}}),
      Order.countDocuments({createdAt:{$gte:today}}),
      Order.aggregate([{$match:{createdAt:{$gte:today},status:{$ne:'cancelled'}}},{$group:{_id:null,total:{$sum:'$totalAmount'}}}]),
      Order.aggregate([{$match:{status:{$ne:'cancelled'}}},{$group:{_id:null,total:{$sum:'$totalAmount'}}}]),
      Fruit.find({stock:{$lt:5},isAvailable:true}).select('name emoji stock category').limit(10),
      Order.find().sort({createdAt:-1}).limit(5).populate('user','name phone').lean()
    ]);
    return R.ok({stats:{totalUsers:tu,totalFruits:tf,totalOrders:to,pendingOrders:pend,todayOrders:tod,todayRevenue:rev[0]?.total||0,totalRevenue:totalRev[0]?.total||0},lowStock:low,recentOrders:recent});
  }

  if (method==='GET' && path==='/api/admin/users') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const page=Math.max(1,+q.page||1),limit=Math.min(100,+q.limit||20);
    const filter={};
    if (q.search) filter.$or=[{name:{$regex:q.search,$options:'i'}},{email:{$regex:q.search,$options:'i'}}];
    if (q.role)   filter.role=q.role;
    const [users,total]=await Promise.all([
      User.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    return R.ok({users,total,page,pages:Math.ceil(total/limit)});
  }

  if (method==='PATCH' && /^\/api\/admin\/users\/[^/]+\/toggle$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid user ID.');
    const u=await User.findById(id);
    if (!u) return R.nf();
    if (u.role==='admin') return R.bad('Cannot deactivate admin.');
    u.isActive=!u.isActive; await u.save({validateBeforeSave:false});
    _invalidateUserCache(id); // flush auth cache so next request reflects isActive change
    return R.ok({isActive:u.isActive},u.isActive?'Activated':'Deactivated');
  }

  if (method==='PATCH' && /^\/api\/admin\/users\/[^\/]+\/edit$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid user ID.');
    const u=await User.findById(id);
    if (!u) return R.nf('User not found.');
    if (u.role==='admin') return R.bad('Cannot edit admin accounts here.');
    const {name,phone,password}=body;
    if (name)  u.name=name.trim();
    if (phone) u.phone=phone.trim();
    if (password && password.length < 8) return R.bad('Password must be at least 8 characters.');
    if (password && password.length >= 8) {
      u.password = password; // pre-save hook hashes it correctly
      u.refreshTokens = [];  // invalidate all sessions
      _invalidateUserCache(u._id);
    }
    await u.save();
    return R.ok({user:{_id:u._id,name:u.name,email:u.email,phone:u.phone,role:u.role,isActive:u.isActive}},'User updated.');
  }

  // Admin: reset any user password directly (no OTP — admin privilege)
  if (method==='POST' && /^\/api\/admin\/users\/[^\/]+\/reset-password$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid user ID.');
    const {newPassword}=body;
    if (!newPassword || newPassword.length<8) return R.bad('New password must be at least 8 characters.');
    const u=await User.findById(id);
    if (!u) return R.nf('User not found.');
    if (u.role==='admin') return R.bad('Cannot reset admin passwords via this endpoint.');
    u.password = newPassword; // pre-save hook hashes it
    u.refreshTokens = [];     // force logout from all devices
    _invalidateUserCache(u._id);
    await u.save();
    console.log('[PFC] ADMIN_PASSWORD_RESET userId:'+id+' by admin:'+auth.user._id);
    return R.ok({}, 'Password reset. User has been logged out of all devices.');
  }

  if (method==='DELETE' && /^\/api\/admin\/users\/[^\/]+$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const id=path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid driver ID.');
    const u=await User.findById(id);
    if (!u) return R.nf();
    if (u.role==='admin') return R.bad('Cannot delete admin accounts.');
    await User.deleteOne({_id:id});
    return R.ok({},'Driver account deleted.');
  }

  // ── ADMIN: Driver delivery statistics ────────────────────────
  // Returns per-driver totals: total delivered, today, active now, last seen
  if (method==='GET' && path==='/api/admin/driver-stats') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');

    const today = new Date(); today.setHours(0,0,0,0);

    // Aggregate deliveries per driver
    const [delivStats, activeNow, allDrivers] = await Promise.all([
      Order.aggregate([
        { $match: { assignedDriver: { $ne: null }, status: { $in: ['out_for_delivery','delivered'] } } },
        { $group: {
          _id: '$assignedDriver',
          totalDelivered:  { $sum: { $cond: [{ $eq: ['$status','delivered'] }, 1, 0] } },
          todayDelivered:  { $sum: { $cond: [{ $and: [{ $eq: ['$status','delivered'] }, { $gte: ['$deliveredAt', today] }] }, 1, 0] } },
          totalRevenue:    { $sum: { $cond: [{ $eq: ['$status','delivered'] }, '$totalAmount', 0] } },
          activeOrder:     { $sum: { $cond: [{ $eq: ['$status','out_for_delivery'] }, 1, 0] } },
          lastDelivery:    { $max: '$deliveredAt' },
        }}
      ]),
      Order.find({ status: 'out_for_delivery' }).distinct('assignedDriver'),
      User.find({ role: 'driver' }).select('name email phone isActive isOnDuty currentLat currentLng locationUpdatedAt createdAt vehicleType').lean(),
    ]);

    // Build a map of stats keyed by driver _id
    const statsMap = {};
    for (const s of delivStats) {
      statsMap[String(s._id)] = s;
    }
    const activeSet = new Set(activeNow.map(id => String(id)));

    const drivers = allDrivers.map(d => {
      const s = statsMap[String(d._id)] || {};
      return {
        ...d,
        totalDelivered: s.totalDelivered || 0,
        todayDelivered: s.todayDelivered || 0,
        totalRevenue:   s.totalRevenue   || 0,
        isActiveNow:    activeSet.has(String(d._id)),
        lastDelivery:   s.lastDelivery   || null,
      };
    });

    return R.ok({ drivers });
  }

  if (method==='GET' && path==='/api/admin/stock') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const fruits=await Fruit.find({isDeleted:false}).select('name emoji category stock isAvailable price').sort({stock:1}).lean();
    return R.ok({fruits,summary:{
      total:fruits.length,
      inStock:fruits.filter(f=>f.stock>0).length,
      lowStock:fruits.filter(f=>f.stock>0&&f.stock<5).length,
      outOfStock:fruits.filter(f=>f.stock===0).length
    }});
  }

  // ── PUSH NOTIFICATIONS ───────────────────────────────────────

  if (method==='GET' && path==='/api/push/vapid-public-key') {
    return R.ok({publicKey:(process.env.VAPID_PUBLIC_KEY||'').replace(/=+$/,'')||null});
  }

  if (method==='POST' && path==='/api/push/subscribe') {
    const {subscription,role,userId}=body;
    if (!subscription||!subscription.endpoint) return R.bad('No subscription.');
    await PushSub.findOneAndUpdate(
      {endpoint:subscription.endpoint},
      {subscription,role:role||'user',userId:userId||null,ts:Date.now()},
      {upsert:true,new:true}
    );
    return R.ok({},'Subscribed');
  }

  // ═══════════════════════════════════════════════════════════
  //  DRIVER ROUTES (v4) — separate, role-gated, real-time ready
  // ═══════════════════════════════════════════════════════════

  // ── DRIVER: Login (separate endpoint — same DB, role-checked) ──
  if (method==='POST' && path==='/api/driver/auth/login') {
    const {email,password}=body;
    if (!email||!password) return R.bad('Email and password required.');
    const u=await User.findOne({email:String(email).toLowerCase()}).select('+password');
    if (!u||!(await u.comparePassword(password))) return R.unauth('Invalid email or password.');
    if (!u.isActive) return R.unauth('Account deactivated. Contact admin.');
    if (u.role!=='driver') return R.unauth('This login is for drivers only.');
    const {accessToken,refreshToken}=tokenPair(u);
    u.refreshTokens=u.refreshTokens.filter(t=>t.expiresAt>new Date()).slice(-10);
    u.refreshTokens.push({token:crypto.createHash('sha256').update(refreshToken).digest('hex'),expiresAt:new Date(Date.now()+30*864e5)});
    u.lastLogin=new Date(); await u.save({validateBeforeSave:false});
    return R.ok({accessToken,refreshToken,user:u},'Driver login successful');
  }

  // ── DRIVER: Get profile ──────────────────────────────────────
  if (method==='GET' && path==='/api/driver/profile') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='driver') return R.noauth('Driver only.');
    const today=new Date(); today.setHours(0,0,0,0);
    const weekAgo=new Date(Date.now()-7*864e5);
    const [totalDeliveries,todayDeliveries,weekDeliveries,activeDelivery]=await Promise.all([
      Order.countDocuments({assignedDriver:auth.user._id,status:'delivered'}),
      Order.countDocuments({assignedDriver:auth.user._id,status:'delivered',deliveredAt:{$gte:today}}),
      Order.countDocuments({assignedDriver:auth.user._id,status:'delivered',deliveredAt:{$gte:weekAgo}}),
      Order.findOne({assignedDriver:auth.user._id,status:'out_for_delivery'}).lean(),
    ]);
    return R.ok({
      user:auth.user,
      stats:{
        totalDeliveries,
        todayDeliveries,
        weekDeliveries,
        hasActiveDelivery:!!activeDelivery,
        activeOrderId:activeDelivery?.orderId||null,
      }
    });
  }

  // ── DRIVER: Toggle on-duty status ────────────────────────────
  if (method==='PATCH' && path==='/api/driver/status') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='driver') return R.noauth('Driver only.');
    const {isOnDuty}=body;
    const u=await User.findByIdAndUpdate(auth.user._id,{isOnDuty:!!isOnDuty},{new:true});
    return R.ok({isOnDuty:u.isOnDuty},u.isOnDuty?'You are now ON duty':'You are now OFF duty');
  }

  // ── DRIVER: Update own location (persisted to DB) ────────────
  if (method==='POST' && path==='/api/driver/location') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='driver') return R.noauth('Driver only.');
    const {lat,lng,orderId}=body;
    if (!lat||!lng) return R.bad('lat and lng required.');
    const now = new Date();
    // Update driver's own profile
    await User.findByIdAndUpdate(auth.user._id,{
      currentLat:+lat, currentLng:+lng, locationUpdatedAt:now
    });
    // Update active out_for_delivery order(s) for this driver —
    // use orderId if provided, otherwise find the active order automatically.
    // This ensures location always reaches the order even if the client
    // didn't pass orderId (e.g. after a page reload).
    const orderFilter = orderId
      ? { orderId, assignedDriver:auth.user._id, status:'out_for_delivery' }
      : { assignedDriver:auth.user._id, status:'out_for_delivery' };
    await Order.updateMany(orderFilter, {
      driverLat:+lat, driverLng:+lng, driverLocationUpdatedAt:now
    });
    return R.ok({},'Location updated');
  }

  // ── DRIVER: Get available orders (poll endpoint) ──
  // Client polls at 30s (idle) or 60s (active delivery) — see initDriverDashboard()
  if (method==='GET' && path==='/api/driver/orders') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (!['admin','driver'].includes(auth.user.role)) return R.noauth('Driver access only.');
    const status=q.status||'confirmed';

    let filter={};
    if (status==='confirmed') {
      // Available orders: BOTH 'placed' and 'confirmed', not assigned, not rejected by this driver
      // 'placed' orders are shown immediately so drivers don't have to wait for admin to confirm
      filter={status:{$in:['placed','confirmed']},assignedDriver:null,rejectedBy:{$ne:auth.user._id}};
    } else if (status==='mine') {
      // This driver's active delivery
      filter={assignedDriver:auth.user._id,status:'out_for_delivery'};
    } else if (status==='done') {
      // All completed deliveries by this driver (all-time, ordered newest first)
      // Stats are shown in the profile card; this tab is the full history
      filter={assignedDriver:auth.user._id,status:'delivered'};
    } else if (status==='all') {
      filter={status:{$in:['confirmed','out_for_delivery']}};
      if (auth.user.role==='driver') filter.rejectedBy={$ne:auth.user._id};
    } else {
      filter={status};
    }

    // ── Field projection: driver card only renders these fields ──
    // Full Order doc includes statusHistory[], razorpayOrderId, razorpayPaymentId,
    // cancellationReason, driverLat/Lng, etc — none used by renderDriverOrderCard().
    // Trimming saves ~60% of JSON payload on the most-polled endpoint.
    const DRIVER_CARD_FIELDS = 'orderId customerName customerPhone createdAt status ' +
      'items deliveryAddress totalAmount paymentMethod deliveredAt assignedDriver ' +
      'assignedDriverName assignedDriverPhone assignedDriverVehicle';

    const orders=await Order.find(filter)
      .select(DRIVER_CARD_FIELDS)
      .sort({createdAt:-1}).limit(50).lean();
    // Include server timestamp so client can detect new orders
    return R.ok({orders,serverTs:Date.now()});
  }

  // ── DRIVER: Accept order (ATOMIC — prevents race conditions) ──
  if (method==='POST' && /^\/api\/driver\/orders\/[^/]+\/accept$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (!['admin','driver'].includes(auth.user.role)) return R.noauth('Driver access only.');
    const orderId=path.split('/')[4];

    // ATOMIC findOneAndUpdate: the query condition {status:'confirmed',assignedDriver:null}
    // ensures only ONE driver can claim the order — if another driver already accepted it,
    // this query returns null and we return a clear error instead of a 500.
    const order=await Order.findOneAndUpdate(
      { orderId, status:{$in:['placed','confirmed']}, assignedDriver:null },
      {
        $set:{
          status:'out_for_delivery',
          assignedDriver:auth.user._id,
          assignedDriverName:auth.user.name,
          assignedDriverPhone:auth.user.phone,
          assignedDriverVehicle:auth.user.vehicleType||'bike',
        },
        $push:{ statusHistory:{ status:'out_for_delivery', note:'Picked up by '+auth.user.name, timestamp:new Date() } }
      },
      { new:true }
    );
    if (!order) {
      // Either already taken by another driver, or order doesn't exist/not confirmed
      const existing=await Order.findOne({orderId});
      if (!existing) return R.nf('Order not found.');
      if (existing.assignedDriver) return R.bad('Order already accepted by another driver.');
      return R.bad(existing.status==='placed'||existing.status==='confirmed' ? 'Order already accepted by another driver.' : 'Order is no longer available for pickup.');
    }
    return R.ok({order},'Order accepted! Head to store for pickup. 🚴');
  }

  // ── DRIVER: Reject order (removes from this driver's list) ───
  if (method==='POST' && /^\/api\/driver\/orders\/[^/]+\/reject$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='driver') return R.noauth('Driver only.');
    const orderId=path.split('/')[4];
    const order=await Order.findOneAndUpdate(
      {orderId,status:{$in:['placed','confirmed']}},
      {$addToSet:{rejectedBy:auth.user._id}},
      {new:true}
    );
    if (!order) return R.nf('Order not found or already dispatched.');
    return R.ok({},'Order skipped. It will stay available for other drivers.');
  }

  // ── DRIVER: Mark delivered ────────────────────────────────────
  if (method==='POST' && /^\/api\/driver\/orders\/[^/]+\/deliver$/.test(path)) {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (!['admin','driver'].includes(auth.user.role)) return R.noauth('Driver access only.');
    const orderId=path.split('/')[4];
    const order=await Order.findOne({orderId});
    if (!order) return R.nf('Order not found.');
    if (auth.user.role==='driver'&&String(order.assignedDriver)!==String(auth.user._id))
      return R.noauth('Not your delivery.');
    order.status='delivered';
    order.deliveredAt=new Date();
    order.paymentStatus='paid';
    order.statusHistory.push({status:'delivered',note:'Delivered by '+auth.user.name,timestamp:new Date()});
    await order.save();
    return R.ok({order},'Marked as delivered! Great job! 🎉');
  }

  // ── DRIVER: Register (admin only) ────────────────────────────
  if (method==='POST' && path==='/api/driver/register') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const {name,email,phone,password,vehicleType}=body;
    if (!name||!email||!phone||!password) return R.bad('All fields required.');
    if (password.length<8) return R.bad('Password min 8 chars.');
    const exists=await User.findOne({email:email.toLowerCase()});
    if (exists) return R.bad('Email already registered.');
    const existsPhone=await User.findOne({phone});
    if (existsPhone) return R.bad('An account with this mobile number already exists.');
    const driver=await User.create({name,email,phone,password,role:'driver',vehicleType:vehicleType||'bike'});
    return R.created({driver:{_id:driver._id,name:driver.name,email:driver.email,phone:driver.phone,role:driver.role,vehicleType:driver.vehicleType}},'Driver account created.');
  }

  // ── PUBLIC: pincode delivery fee lookup ──────────────────────
  // GET /api/delivery-fee?pincode=506002  → { fee: 40, found: true }
  if (method==='GET' && path==='/api/delivery-fee') {
    const pincode = (q.pincode || '').trim();
    if (!pincode) return R.bad('pincode query param required.');
    const { Settings: SettingsM2 } = getModels();
    const DEFAULT_PINCODE_FEES = {
      '506001': 40, '506002': 40, '506005': 40, '506006': 40,
      '506007': 40, '506008': 40, '506009': 40, '506010': 40,
      '506011': 40, '506013': 40, '506015': 40,
      '506370': 50, '506371': 50, '506372': 50,
      '506003': 60, '506004': 60,
    };
    const pincodeFeeSetting2 = await SettingsM2.findOne({ key: 'pincode_delivery_fees' }).lean();
    const pincodeFees2 = (pincodeFeeSetting2 && typeof pincodeFeeSetting2.value === 'object' && !Array.isArray(pincodeFeeSetting2.value))
      ? pincodeFeeSetting2.value
      : DEFAULT_PINCODE_FEES;
    const found = pincodeFees2[pincode] !== undefined;
    const fee   = found ? pincodeFees2[pincode] : null;
    return R.ok({ pincode, fee, found, message: found ? `Delivery available — ₹${fee}` : 'Pincode not in delivery area.' });
  }

  // ── SETTINGS: public read — no auth, used by checkout to get platformFee ──
  if (method==='GET' && path==='/api/settings/public') {
    const { Settings } = getModels();
    const rows = await Settings.find({}).lean();
    const settings = Object.fromEntries(rows.map(r=>[r.key, r.value]));
    return { ...R.ok({ settings }), headers: { ...R.ok({}).headers, 'Cache-Control': 'no-store' } };
  }

  // ── SETTINGS: admin read ──
  if (method==='GET' && path==='/api/admin/settings') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const { Settings } = getModels();
    const rows = await Settings.find({}).lean();
    const settings = Object.fromEntries(rows.map(r=>[r.key, r.value]));
    return R.ok({ settings });
  }

  // ── SETTINGS: admin write — upserts a key/value setting into MongoDB ──
  if (method==='POST' && path==='/api/admin/settings') {
    const auth=await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role!=='admin') return R.noauth('Admin only.');
    const { Settings } = getModels();
    const { key, value } = body;
    if (!key) return R.bad('key required.');
    await Settings.findOneAndUpdate({ key }, { value }, { upsert:true, new:true });
    return R.ok({ key, value }, 'Setting saved.');
  }

  // ══════════════════════════════════════════════════════════
  //  JUICES — MongoDB-backed, real-time synced
  // ══════════════════════════════════════════════════════════

  // Public: list all non-deleted juices (used by shop + polling)
  if (method==='GET' && path==='/api/juices') {
    const { Juice } = getModels();
    const juices = await Juice.find({ isDeleted:false }).sort({ createdAt:-1 }).lean();
    return {
      ...R.ok({ juices }),
      headers: { ...R.ok({}).headers, 'Cache-Control': 'no-store' },
    };
  }

  // Admin: create juice
  if (method==='POST' && path==='/api/juices') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Juice } = getModels();
    const { name, desc, img, img2, price, discountPercent, moo, category, status, stock, benefits } = body;
    if (!name || !price) return R.bad('Name and price required.');
    const juice = await Juice.create({ name, desc, img, img2, price:+price, discountPercent:+(discountPercent||0), moo:+(moo||500), category:category||'Fresh', status:status||'soon', stock:+(stock||0), benefits:Array.isArray(benefits)?benefits:[] });
    return R.created({ juice }, 'Juice added.');
  }

  // Admin: update juice
  if (method==='PATCH' && /^\/api\/juices\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Juice } = getModels();
    const id = path.split('/').pop();
    const up = {};
    const allowed = ['name','desc','img','img2','price','discountPercent','moo','category','status','stock','benefits'];
    for (const k of allowed) { if (body[k] !== undefined) up[k] = body[k]; }
    const juice = await Juice.findByIdAndUpdate(id, { $set: up }, { new:true, runValidators:true });
    if (!juice) return R.nf('Juice not found.');
    return R.ok({ juice }, 'Updated.');
  }

  // Admin: delete juice
  if (method==='DELETE' && /^\/api\/juices\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Juice } = getModels();
    const id = path.split('/').pop();
    const juice = await Juice.findByIdAndUpdate(id, { isDeleted:true }, { new:true });
    if (!juice) return R.nf('Juice not found.');
    return R.ok({}, 'Juice deleted.');
  }

  // ══════════════════════════════════════════════════════════
  //  BASKETS / BUNDLES — MongoDB-backed, real-time synced
  // ══════════════════════════════════════════════════════════

  // Public: list all non-deleted baskets
  if (method==='GET' && path==='/api/baskets') {
    const { Basket } = getModels();
    const baskets = await Basket.find({ isDeleted:false }).sort({ createdAt:-1 }).lean();
    return {
      ...R.ok({ baskets }),
      headers: { ...R.ok({}).headers, 'Cache-Control': 'no-store' },
    };
  }

  // Admin: create basket
  if (method==='POST' && path==='/api/baskets') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Basket } = getModels();
    const { name, desc, emoji, price, origPrice, items, badge, active } = body;
    if (!name || !price || !items) return R.bad('Name, price, and items are required.');
    const basket = await Basket.create({ name, desc, emoji:emoji||'🎁', price:+price, origPrice:origPrice?+origPrice:null, items, badge:badge||'', active: active !== false });
    return R.created({ basket }, 'Basket created.');
  }

  // Admin: update basket
  if (method==='PATCH' && /^\/api\/baskets\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Basket } = getModels();
    const id = path.split('/').pop();
    const up = {};
    const allowed = ['name','desc','emoji','price','origPrice','items','badge','active'];
    for (const k of allowed) { if (body[k] !== undefined) up[k] = body[k]; }
    const basket = await Basket.findByIdAndUpdate(id, { $set: up }, { new:true, runValidators:true });
    if (!basket) return R.nf('Basket not found.');
    return R.ok({ basket }, 'Updated.');
  }

  // Admin: delete basket
  if (method==='DELETE' && /^\/api\/baskets\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Basket } = getModels();
    const id = path.split('/').pop();
    const basket = await Basket.findByIdAndUpdate(id, { isDeleted:true }, { new:true });
    if (!basket) return R.nf('Basket not found.');
    return R.ok({}, 'Basket deleted.');
  }

  // ══════════════════════════════════════════════════════════
  //  OFFLINE SALES — MongoDB-backed
  // ══════════════════════════════════════════════════════════

  // Admin: list offline sales
  if (method==='GET' && path==='/api/offline-sales') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { OfflineSale } = getModels();
    const page  = Math.max(1, +q.page||1);
    const limit = Math.min(200, +q.limit||100);
    const filter = {};
    if (q.date) filter.date = q.date;
    const [sales, total] = await Promise.all([
      OfflineSale.find(filter).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean(),
      OfflineSale.countDocuments(filter),
    ]);
    return R.ok({ sales, total, page, pages: Math.ceil(total/limit) });
  }

  // Admin: create offline sale
  if (method==='POST' && path==='/api/offline-sales') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { OfflineSale } = getModels();
    const { name, phone, items, itemsDetail, amount, pay, notes, date } = body;
    if (!amount || +amount <= 0) return R.bad('Amount required.');
    const sale = await OfflineSale.create({
      name: name||'Walk-in', phone, items, itemsDetail:Array.isArray(itemsDetail)?itemsDetail:[],
      amount: +amount, pay: pay||'Cash', notes,
      date: date || new Date().toISOString().split('T')[0],
    });
    return R.created({ sale }, 'Sale recorded.');
  }

  // Admin: delete offline sale
  if (method==='DELETE' && /^\/api\/offline-sales\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { OfflineSale } = getModels();
    const id = path.split('/').pop();
    const sale = await OfflineSale.findOneAndDelete({ $or: [{ _id: isValidObjectId(id)?id:null }, { saleId: id }] });
    if (!sale) return R.nf('Sale not found.');
    return R.ok({}, 'Sale deleted.');
  }

  // ══════════════════════════════════════════════════════════
  //  FEATURE 1: PRODUCT DISCOUNT MANAGEMENT
  //  PATCH /api/admin/fruits/:id/discount
  //  PATCH /api/admin/juices/:id/discount
  // ══════════════════════════════════════════════════════════

  // Admin: set discount on a fruit (originalPrice + discountPercentage OR discountPrice)
  if (method==='PATCH' && /^\/api\/admin\/fruits\/[^/]+\/discount$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Fruit } = getModels();
    const id = path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid fruit ID.');
    const fruit = await Fruit.findById(id);
    if (!fruit || fruit.isDeleted) return R.nf('Fruit not found.');

    let { originalPrice, discountPercentage, discountPrice } = body;
    originalPrice = originalPrice !== undefined ? +originalPrice : null;
    discountPercentage = discountPercentage !== undefined ? +discountPercentage : null;
    discountPrice = discountPrice !== undefined ? +discountPrice : null;

    // Determine base price and discount %
    const basePrice = originalPrice !== null ? originalPrice : fruit.price;
    if (basePrice <= 0) return R.bad('Original price must be positive.');

    let finalDiscountPct = 0;
    if (discountPercentage !== null) {
      if (discountPercentage < 0 || discountPercentage > 90) return R.bad('Discount % must be 0–90.');
      finalDiscountPct = discountPercentage;
    } else if (discountPrice !== null) {
      if (discountPrice < 0) return R.bad('Discount price cannot be negative.');
      if (discountPrice >= basePrice) return R.bad('Discount price must be less than original price.');
      finalDiscountPct = parseFloat(((1 - discountPrice / basePrice) * 100).toFixed(2));
      if (finalDiscountPct > 90) return R.bad('Computed discount exceeds 90%. Check values.');
    }

    // Validate: final price must not be negative or zero
    const computedFinalPrice = parseFloat((basePrice * (1 - finalDiscountPct / 100)).toFixed(2));
    if (computedFinalPrice <= 0) return R.bad('Discount makes price zero or negative.');

    fruit.price = basePrice;
    fruit.discountPercent = finalDiscountPct;
    await fruit.save();

    const response = {
      _id: fruit._id,
      name: fruit.name,
      originalPrice: basePrice,
      discountPercent: finalDiscountPct,
      finalPrice: computedFinalPrice,
      savings: parseFloat((basePrice - computedFinalPrice).toFixed(2)),
    };
    console.log(`[PFC] DISCOUNT_SET fruitId:${id} originalPrice:${basePrice} discountPct:${finalDiscountPct} finalPrice:${computedFinalPrice} by admin:${auth.user._id}`);
    return R.ok({ fruit: response }, 'Discount applied. Final price computed on backend.');
  }

  // Admin: set discount on a juice
  if (method==='PATCH' && /^\/api\/admin\/juices\/[^/]+\/discount$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Juice } = getModels();
    const id = path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid juice ID.');
    const juice = await Juice.findById(id);
    if (!juice || juice.isDeleted) return R.nf('Juice not found.');

    let { originalPrice, discountPercentage, discountPrice } = body;
    originalPrice = originalPrice !== undefined ? +originalPrice : null;
    discountPercentage = discountPercentage !== undefined ? +discountPercentage : null;
    discountPrice = discountPrice !== undefined ? +discountPrice : null;

    const basePrice = originalPrice !== null ? originalPrice : juice.price;
    if (basePrice <= 0) return R.bad('Original price must be positive.');

    let finalDiscountPct = 0;
    if (discountPercentage !== null) {
      if (discountPercentage < 0 || discountPercentage > 90) return R.bad('Discount % must be 0–90.');
      finalDiscountPct = discountPercentage;
    } else if (discountPrice !== null) {
      if (discountPrice < 0) return R.bad('Discount price cannot be negative.');
      if (discountPrice >= basePrice) return R.bad('Discount price must be less than original price.');
      finalDiscountPct = parseFloat(((1 - discountPrice / basePrice) * 100).toFixed(2));
      if (finalDiscountPct > 90) return R.bad('Computed discount exceeds 90%.');
    }

    const computedFinalPrice = parseFloat((basePrice * (1 - finalDiscountPct / 100)).toFixed(2));
    if (computedFinalPrice <= 0) return R.bad('Discount makes price zero or negative.');

    juice.price = basePrice;
    juice.discountPercent = finalDiscountPct;
    await juice.save();

    console.log(`[PFC] JUICE_DISCOUNT_SET juiceId:${id} originalPrice:${basePrice} discountPct:${finalDiscountPct} by admin:${auth.user._id}`);
    return R.ok({
      juice: { _id:juice._id, name:juice.name, originalPrice:basePrice,
               discountPercent:finalDiscountPct, finalPrice:computedFinalPrice }
    }, 'Juice discount applied.');
  }

  // Admin: remove discount from fruit
  if (method==='DELETE' && /^\/api\/admin\/fruits\/[^/]+\/discount$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Fruit } = getModels();
    const id = path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid fruit ID.');
    await Fruit.findByIdAndUpdate(id, { discountPercent: 0 });
    return R.ok({}, 'Discount removed.');
  }

  // Admin: remove discount from juice
  if (method==='DELETE' && /^\/api\/admin\/juices\/[^/]+\/discount$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Juice } = getModels();
    const id = path.split('/')[4];
    if (!isValidObjectId(id)) return R.bad('Invalid juice ID.');
    await Juice.findByIdAndUpdate(id, { discountPercent: 0 });
    return R.ok({}, 'Discount removed.');
  }

  // ══════════════════════════════════════════════════════════
  //  FEATURE 2: ADMIN PASSWORD CONTROL
  //  POST /api/admin/users/reset-password  (search by email/ID)
  //  GET  /api/admin/password-logs
  // ══════════════════════════════════════════════════════════

  // Admin: reset password by email or ID (with full audit log)
  if (method==='POST' && path==='/api/admin/users/reset-password') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { AdminPasswordLog, User } = getModels();
    const { identifier, newPassword } = body;  // identifier = email or userId
    if (!identifier) return R.bad('Provide user email or ID.');
    if (!newPassword || newPassword.length < 8) return R.bad('New password must be at least 8 characters.');

    // Find user by email or ID
    let u;
    if (isValidObjectId(identifier)) {
      u = await User.findById(identifier);
    } else {
      u = await User.findOne({ email: String(identifier).toLowerCase().trim() });
    }
    if (!u) return R.nf('User not found with that email or ID.');
    if (u.role === 'admin') return R.bad('Cannot reset admin passwords via this endpoint.');

    // Hash password via bcrypt (pre-save hook also hashes — but we do it explicitly for clarity)
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    u.password = hashedPassword;
    u.refreshTokens = [];  // force logout from all devices
    u.markModified('password');
    await u.save({ validateBeforeSave: false });
    _invalidateUserCache(u._id);

    // Audit log
    const ip = getIP(event);
    await AdminPasswordLog.create({
      targetUserId: u._id,
      targetEmail:  u.email,
      adminId:      auth.user._id,
      adminEmail:   auth.user.email,
      action:       'password_reset',
      ip,
      timestamp:    new Date(),
    });
    console.log(`[PFC] ADMIN_PWD_RESET targetUser:${u._id}(${u.email}) by admin:${auth.user._id} ip:${ip}`);
    return R.ok({
      userId: u._id,
      email:  u.email,
      name:   u.name,
    }, 'Password reset. User logged out of all devices.');
  }

  // Admin: search user by email or ID (for password reset UI)
  if (method==='GET' && path==='/api/admin/users/search') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { User } = getModels();
    const { q: query } = q;  // ?q=email@example.com or ?q=userId
    if (!query) return R.bad('Provide search query.');
    let filter;
    if (isValidObjectId(query)) {
      filter = { _id: query };
    } else {
      filter = { $or: [
        { email: { $regex: String(query).trim(), $options: 'i' } },
        { name:  { $regex: String(query).trim(), $options: 'i' } },
        { phone: { $regex: String(query).trim(), $options: 'i' } },
      ]};
    }
    const users = await User.find(filter).select('name email phone role isActive createdAt').limit(10).lean();
    return R.ok({ users });
  }

  // Admin: view password change audit logs
  if (method==='GET' && path==='/api/admin/password-logs') {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { AdminPasswordLog } = getModels();
    const page  = Math.max(1, +q.page || 1);
    const limit = Math.min(100, +q.limit || 20);
    const [logs, total] = await Promise.all([
      AdminPasswordLog.find({}).sort({ timestamp: -1 }).skip((page-1)*limit).limit(limit).lean(),
      AdminPasswordLog.countDocuments({}),
    ]);
    return R.ok({ logs, total, page, pages: Math.ceil(total / limit) });
  }

  // ══════════════════════════════════════════════════════════
  //  FEATURE 3: ADMIN ORDER OVERRIDE SYSTEM
  //  PATCH /api/orders/admin/:orderId/override
  //  POST  /api/orders/admin/:orderId/cancel-override
  //  GET   /api/admin/order-audit/:orderId
  // ══════════════════════════════════════════════════════════

  // Admin: full order override — edit items, qty, price, status with audit log
  if (method==='PATCH' && /^\/api\/orders\/admin\/[^/]+\/override$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Order, Fruit } = getModels();
    const orderId = path.split('/')[4];
    const { items, status, reason, notes } = body;

    if (!reason || reason.trim().length < 5) return R.bad('A reason (min 5 chars) is required for order override.');

    const order = await Order.findOne({ orderId }).populate('user', 'name email phone');
    if (!order) return R.nf('Order not found.');
    if (order.status === 'delivered') return R.bad('Cannot modify a delivered order.');

    // Snapshot original state for audit
    const originalItems  = JSON.parse(JSON.stringify(order.items));
    const originalTotal  = order.totalAmount;
    const originalStatus = order.status;
    const changes = {};

    // ── Validate and apply item overrides ──────────────────
    if (Array.isArray(items) && items.length > 0) {
      const resolvedItems = [];
      for (const it of items) {
        // Basic validation
        if (!it.name) return R.bad('Each item must have a name.');
        const qty = +it.quantity || 1;
        if (qty < 1) return R.bad(`Quantity for ${it.name} must be at least 1.`);
        const pricePerKg = +it.pricePerKg;
        if (!pricePerKg || pricePerKg <= 0) return R.bad(`Invalid pricePerKg for ${it.name}.`);
        const weightGrams = +it.weightGrams || 500;
        if (weightGrams <= 0 || weightGrams > 50000) return R.bad(`Invalid weight for ${it.name}.`);

        // Stock validation (only for fruit items with a fruit ID)
        if (it.fruit && isValidObjectId(it.fruit)) {
          const fruit = await Fruit.findById(it.fruit).lean();
          const requiredKg = (weightGrams / 1000) * qty;
          if (fruit && fruit.stock < requiredKg && fruit.stock >= 0) {
            console.warn(`[PFC] OVERRIDE_LOW_STOCK fruitId:${it.fruit} required:${requiredKg}kg available:${fruit.stock}kg`);
            // Allow override but log warning — admin may know stock is incoming
          }
        }

        const subtotal = parseFloat((pricePerKg * (weightGrams / 1000) * qty).toFixed(2));
        resolvedItems.push({
          fruit: it.fruit || undefined,
          isJuice: it.isJuice || false,
          juiceId: it.juiceId || undefined,
          name: it.name.trim(),
          emoji: it.emoji || '🍎',
          variety: it.variety || '',
          pricePerKg,
          weightGrams,
          weightLabel: it.weightLabel || `${weightGrams}g`,
          quantity: qty,
          subtotal,
        });
      }

      // Backend recalculates total — frontend never does this
      const newSubtotal = parseFloat(resolvedItems.reduce((s, i) => s + i.subtotal, 0).toFixed(2));
      const newTotal    = parseFloat((newSubtotal + (order.deliveryFee || 0)).toFixed(2));
      if (newTotal <= 0) return R.bad('Override would make order total zero or negative.');

      order.items      = resolvedItems;
      order.subtotal   = newSubtotal;
      order.totalAmount = newTotal;
      changes.items    = resolvedItems;
      changes.subtotal = newSubtotal;
      changes.totalAmount = newTotal;
    }

    // ── Status override ────────────────────────────────────
    if (status && status !== originalStatus) {
      const validStatuses = ['placed','confirmed','packed','out_for_delivery','dispatched','delivered','cancelled'];
      if (!validStatuses.includes(status)) return R.bad('Invalid status.');
      order.status = status;
      changes.status = status;
      if (status === 'cancelled') {
        order.cancellationReason = reason;
        order.cancelledAt = new Date();
      }
    }

    // ── Notes ──────────────────────────────────────────────
    if (notes) {
      order.orderNotes = (order.orderNotes || '') + ` [Admin override: ${notes}]`;
      changes.notes = notes;
    }

    // ── Mark as admin-modified ─────────────────────────────
    order.isAdminModified = true;
    order.adminModifications.push({
      modifiedBy:      auth.user._id,
      modifiedByEmail: auth.user.email,
      reason:          reason.trim(),
      originalItems,
      originalTotal,
      originalStatus,
      changes,
      timestamp:       new Date(),
    });

    await order.save();

    // ── Notify user via push ────────────────────────────────
    sendPushToUser(
      order.user,
      '⚠️ Order Updated — ' + order.orderId,
      'Your order was modified by admin. Reason: ' + reason.trim(),
      { url: '/?page=profile', orderId: order.orderId }
    ).catch(() => {});

    // ── Notify user via email ──────────────────────────────
    (async () => {
      try {
        const transport = createMailTransport();
        if (!transport) return;
        const newTotal = order.totalAmount;
        const itemLines = (order.items || []).map(i =>
          `  * ${i.emoji||''} ${i.name} x${i.quantity}  ₹${i.subtotal?.toFixed(2)||''}`
        ).join('\n');
        await transport.sendMail({
          from: `"Padmavathi Fruits Company" <${EMAIL_FROM}>`,
          to:   order.customerEmail || '',
          subject: `⚠️ Your Order ${order.orderId} was Modified`,
          text: [
            `Dear ${order.customerName || 'Customer'},`,
            '',
            'Your order has been modified by our team.',
            `Reason: ${reason.trim()}`,
            '',
            '--- Updated Items ---',
            itemLines,
            '--------------------',
            `New Total: ₹${newTotal?.toFixed(2)}`,
            '',
            'If you have questions, reply to this email or call us.',
            '',
            '— Padmavathi Fruits Company',
          ].join('\n'),
        });
        console.log(`[PFC] OVERRIDE_EMAIL_SENT orderId:${orderId}`);
      } catch(e) {
        console.error('[PFC] OVERRIDE_EMAIL_FAILED:', e.message);
      }
    })();

    console.log(`[PFC] ORDER_OVERRIDE orderId:${orderId} by admin:${auth.user._id} reason:"${reason}" changes:${JSON.stringify(Object.keys(changes))}`);
    return R.ok({ order, changes, auditEntry: order.adminModifications[order.adminModifications.length - 1] },
      'Order overridden. User notified. Audit log recorded.');
  }

  // Admin: cancel order with override reason (distinct from user cancel)
  if (method==='POST' && path.match(/^\/api\/orders\/admin\/[^/]+\/cancel-override$/)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Order, Fruit } = getModels();
    const orderId = path.split('/')[4];
    const { reason } = body;
    if (!reason || reason.trim().length < 5) return R.bad('Cancellation reason required (min 5 chars).');

    const order = await Order.findOne({ orderId });
    if (!order) return R.nf('Order not found.');
    if (order.status === 'delivered') return R.bad('Cannot cancel a delivered order.');
    if (order.status === 'cancelled') return R.bad('Order is already cancelled.');

    const originalStatus = order.status;
    order.status = 'cancelled';
    order.cancellationReason = `Admin: ${reason.trim()}`;
    order.cancelledAt = new Date();
    order.isAdminModified = true;
    order.adminModifications.push({
      modifiedBy:      auth.user._id,
      modifiedByEmail: auth.user.email,
      reason:          reason.trim(),
      originalStatus,
      changes:         { status: 'cancelled' },
      timestamp:       new Date(),
    });

    await order.save();

    // Restore stock
    for (const it of order.items) {
      if (it.fruit && !it.isJuice) {
        const restoreKg = (it.weightGrams / 1000) * it.quantity;
        await Fruit.findByIdAndUpdate(it.fruit, { $inc: { stock: restoreKg, totalSold: -restoreKg } });
      }
    }

    sendPushToUser(order.user, '❌ Order Cancelled — ' + orderId, `Reason: ${reason.trim()}`, {}).catch(() => {});
    console.log(`[PFC] ADMIN_ORDER_CANCEL orderId:${orderId} by admin:${auth.user._id} reason:"${reason}"`);
    return R.ok({ order }, 'Order cancelled by admin. Stock restored.');
  }

  // Admin: view audit log for a specific order
  if (method==='GET' && /^\/api\/admin\/order-audit\/[^/]+$/.test(path)) {
    const auth = await authenticate(event.headers);
    if (auth.err) return auth.err;
    if (auth.user.role !== 'admin') return R.noauth('Admin only.');
    const { Order } = getModels();
    const orderId = path.split('/').pop();
    const order = await Order.findOne({ orderId }).select('orderId isAdminModified adminModifications statusHistory items totalAmount status').lean();
    if (!order) return R.nf('Order not found.');
    return R.ok({ orderId: order.orderId, isAdminModified: order.isAdminModified, modifications: order.adminModifications || [], statusHistory: order.statusHistory });
  }

  // ── NOT FOUND ─────────────────────────────────────────────────
  return R.nf(`Route not found: ${method} ${path}`);
}

const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer(async (req, res) => {
  try {
    await connectDB();

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // Collect body as Buffer chunks — string concatenation corrupts binary (multipart) data
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

    req.on('end', async () => {
      const rawBuffer = chunks.length ? Buffer.concat(chunks) : null;

      // For multipart requests pass the raw Buffer directly; for JSON pass string
      const contentType = (req.headers['content-type'] || '');
      const isMultipart = contentType.includes('multipart/form-data');
      const bodyPayload = rawBuffer
        ? (isMultipart ? rawBuffer : rawBuffer.toString('utf8'))
        : null;

      const event = {
        httpMethod: method,
        path: path,
        headers: req.headers,
        body: bodyPayload,
        isBase64Encoded: false,
        _rawBuffer: rawBuffer,   // available for parseMultipartUpload
        queryStringParameters: Object.fromEntries(url.searchParams)
      };

      if (method === 'OPTIONS') {
        const origin = req.headers.origin || '';
        res.writeHead(204, corsHeaders(origin));
        return res.end();
      }

      const result = await route(method, path, event);

      res.writeHead(result.statusCode || 200, result.headers);
      res.end(result.body);
    });

  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false }));
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Running on ${PORT}`);
});

// ─── NETLIFY HANDLER ─────────────────────────────────────────

exports.handler = async (event) => {
  const method=event.httpMethod.toUpperCase();
  if (method==='OPTIONS') {
    const origin = event.headers.origin || event.headers.Origin || '';
    return { statusCode:204, headers:corsHeaders(origin), body:'' };
  }
  let rawPath=event.rawUrl ? new URL(event.rawUrl).pathname : (event.path||'/');
  rawPath=rawPath
    .replace(/^\/.netlify\/functions\/api/,'')
    .replace(/^\/api/,'');
  const path=rawPath==='/health' ? '/health' : '/api'+(rawPath||'/');
  try {
    await connectDB();
    await seedIfEmpty().catch(e=>console.error('[PFC] Seed error:',e.message));
    return await route(method,path,event);
  } catch(err) {
    // ── NEVER CRASH: catch all async errors (Task 12) ──────────
    console.error('[PFC] UNHANDLED_ERROR path:'+path+' method:'+method+' err:'+err.message);
    if (err.code===11000) {
      const field=Object.keys(err.keyValue||{})[0];
      // orderToken duplicate = idempotency race — return existing order silently (Task 12)
      if (field==='orderToken' && err.keyValue?.orderToken) {
        const ip=(event.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';
        console.log(`[PFC] DUPLICATE_TOKEN_RACE orderToken:${err.keyValue.orderToken} ip:${ip}`);
        try {
          const { Order:OrderM } = getModels();
          const dup = await OrderM.findOne({ orderToken: err.keyValue.orderToken });
          if (dup) return R.ok({ order: dup }, 'Order already placed (duplicate prevented).');
        } catch(_) {}
      }
      // phone/email duplicate on user creation
      if (field==='phone') return R.bad('An account with this mobile number already exists.');
      if (field==='email') return R.bad('An account with this email already exists.');
      return R.bad((field||'Field')+' already exists.');
    }
    if (err.name==='ValidationError') {
      const errors=Object.values(err.errors).map(e=>({field:e.path,message:e.message}));
      return R.json({success:false,message:'Validation failed',errors},400);
    }
    if (err.name==='CastError') return R.bad('Invalid ID.');
    // Always return structured JSON — never let server crash (Task 12)
    return R.err(err.message||'Internal server error');
  }
  
  

};