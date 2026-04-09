#!/usr/bin/env node
/*
  seed.js — Run manually to seed fruits + admin user into MongoDB Atlas
  Usage:  MONGODB_URI=... node scripts/seed.js
          or just:  node scripts/seed.js   (reads .env automatically)
*/
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const URI = process.env.MONGODB_URI;
if (!URI) { console.error('❌  MONGODB_URI not set.'); process.exit(1); }

// Minimal schemas for seeding
const Fruit = mongoose.model('Fruit', new mongoose.Schema({
  name:String,slug:String,variety:String,emoji:String,category:String,
  price:Number,stock:Number,badge:String,badgeLabel:String,isFeatured:Boolean,
  tags:[String],description:String,benefits:[String],unitType:String,
  isAvailable:{type:Boolean,default:true},isDeleted:{type:Boolean,default:false},
  discountPercent:{type:Number,default:0},averageRating:{type:Number,default:0},
  totalReviews:{type:Number,default:0},totalSold:{type:Number,default:0},
},{ timestamps:true }));

const User = mongoose.model('User', new mongoose.Schema({
  name:String,email:{type:String,unique:true},phone:String,
  password:String,role:{type:String,default:'user'},isActive:{type:Boolean,default:true},
},{ timestamps:true }));

const SEEDS = [
  {name:'Apple',variety:'Himachal Pradesh Red',emoji:'🍎',category:'Daily',price:180,stock:100,badge:'',badgeLabel:'',isFeatured:true,tags:['vitamin-c','daily','fresh'],description:'Crisp apples from Himachal Pradesh.',benefits:['High fiber & Vitamin C','Heart health','Weight management','Boosts immunity'],unitType:'piece'},
  {name:'Banana',variety:'Robusta',emoji:'🍌',category:'Daily',price:60,stock:200,badge:'org',badgeLabel:'Organic',isFeatured:true,tags:['energy','daily','organic'],description:'Farm-fresh Robusta bananas.',benefits:['Rich in potassium','Improves digestion','Boosts energy','Heart health'],unitType:'piece'},
  {name:'Orange',variety:'Nagpur Santra',emoji:'🍊',category:'Daily',price:120,stock:150,badge:'',badgeLabel:'',isFeatured:true,tags:['vitamin-c','daily','juicy'],description:"Premium Nagpur Santra."},
  {name:'Pomegranate',variety:'Bhagwa',emoji:'🍑',category:'Daily',price:160,stock:80,badge:'hot',badgeLabel:'Popular',isFeatured:true,tags:['antioxidant','daily','premium'],description:'Deep-red Bhagwa pomegranates.'},
  {name:'Grapes',variety:'Thompson Seedless',emoji:'🍇',category:'Daily',price:140,stock:90,badge:'',badgeLabel:'',isFeatured:false,tags:['seedless','daily','sweet'],description:'Plump Thompson grapes.'},
  {name:'Papaya',variety:'Red Lady',emoji:'🍈',category:'Daily',price:45,stock:120,badge:'org',badgeLabel:'Organic',isFeatured:false,tags:['digestive','organic'],description:'Locally grown Red Lady papayas.'},
  {name:'Alphonso Mango',variety:'Premium Ratnagiri',emoji:'🥭',category:'Seasonal',price:280,stock:50,badge:'sea',badgeLabel:'Seasonal',isFeatured:true,tags:['premium','seasonal','mango'],description:'King of Mangoes.'},
  {name:'Watermelon',variety:'Seedless',emoji:'🍉',category:'Seasonal',price:25,stock:300,badge:'sea',badgeLabel:'Seasonal',isFeatured:true,tags:['seasonal','hydrating','summer'],description:'Giant seedless watermelons.',unitType:'large'},
  {name:'Kiwi',variety:'Zespri Green',emoji:'🥝',category:'Imported',price:350,stock:60,badge:'imp',badgeLabel:'Imported',isFeatured:true,tags:['imported','vitamin-c','exotic'],description:'Premium Zespri Green Kiwis from New Zealand.'},
  {name:'Dragon Fruit',variety:'Red Pitaya',emoji:'🐉',category:'Imported',price:400,stock:30,badge:'imp',badgeLabel:'Imported',isFeatured:false,tags:['imported','exotic','antioxidant'],description:'Red Pitaya from Vietnam.'},
  {name:'Avocado',variety:'Hass variety',emoji:'🥑',category:'Imported',price:320,stock:25,badge:'imp',badgeLabel:'Imported',isFeatured:false,tags:['imported','healthy-fat','keto'],description:'Creamy Hass avocados.'},
  {name:'Washington Apple',variety:'Red Delicious USA',emoji:'🍎',category:'Imported',price:300,stock:50,badge:'imp',badgeLabel:'Imported',isFeatured:false,tags:['imported','premium','crisp'],description:'Premium Washington apples.'},
];

(async () => {
  console.log('\n🍎  Padmavathi Fruits — Seeder\n');
  await mongoose.connect(URI);
  console.log('✅  Connected to MongoDB Atlas');

  const existingCount = await Fruit.countDocuments();
  if (existingCount > 0) {
    console.log(`ℹ️   ${existingCount} fruits already exist. Skipping fruit seed.`);
  } else {
    // Add slug
    const withSlug = SEEDS.map(s => ({ ...s, slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') }));
    await Fruit.insertMany(withSlug);
    console.log(`✅  Seeded ${SEEDS.length} fruits`);
  }

  const ae = process.env.ADMIN_EMAIL    || 'admin@padmavathifruits.com';
  const ap = process.env.ADMIN_PASSWORD || 'Admin@1234';
  const existing = await User.findOne({ email: ae });
  if (existing) {
    console.log(`ℹ️   Admin ${ae} already exists. Skipping.`);
  } else {
    const hashed = await bcrypt.hash(ap, 10);
    await User.create({ name:'Admin', email:ae, phone:'9876543210', password:hashed, role:'admin' });
    console.log(`✅  Admin created: ${ae} / ${ap}`);
  }

  await mongoose.disconnect();
  console.log('\n✅  Seeding complete.\n');
})().catch(e => { console.error('❌  Seed failed:', e.message); process.exit(1); });
