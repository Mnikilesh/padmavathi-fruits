#!/usr/bin/env node
/*
  generate-vapid.js
  Run once: node scripts/generate-vapid.js
  Copy the output into your .env and Netlify dashboard.
*/
const webpush = require('web-push');
const keys    = webpush.generateVAPIDKeys();

const pub  = keys.publicKey.replace(/=+$/, '');
const priv = keys.privateKey.replace(/=+$/, '');

console.log('\n✅  VAPID Keys Generated\n');
console.log('Add these to your .env AND Netlify environment variables:\n');
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${priv}`);
console.log('\n⚠️  Keep the private key secret. Never commit it to Git.\n');
