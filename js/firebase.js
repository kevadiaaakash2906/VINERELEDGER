/* ============================================
   VINÉRE — Firebase + Sheet Sync
   ============================================ */

var firebaseConfig = {
  apiKey: "AIzaSyC3GlUHfz6Zfd1o5eymGcY_jkyz4MuVfls",
  authDomain: "vinereledger-b29be.firebaseapp.com",
  databaseURL: "https://vinereledger-b29be-default-rtdb.firebaseio.com",
  projectId: "vinereledger-b29be",
  storageBucket: "vinereledger-b29be.firebasestorage.app",
  messagingSenderId: "701394930039",
  appId: "1:701394930039:web:456e7ae9c61fc92402b972",
  measurementId: "G-HQN3J4LGXE"
};

try {
  window.firebase.initializeApp(firebaseConfig);
} catch (e) {
  if (e.message && e.message.indexOf('already exists') > -1) {
    console.log('Firebase already initialized');
  } else {
    console.error('Firebase init error:', e);
  }
}

var db = window.firebase.firestore();
var SHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxOAsr95tNPqUzVCa2p4NFLQ-XfGCLvw4C-zCgZhWuFE5OYFE6L4bq-6T-5Nifx8Z_eeg/exec';

var authReadyPromise = new Promise(function(resolve) {
  var unsub = window.firebase.auth().onAuthStateChanged(function(user) {
    unsub();
    resolve(user);
  });
});

async function ensureAuth() {
  var user = window.firebase.auth().currentUser;
  if (user) return user;
  return await authReadyPromise;
}

/* ============ ORDERS ============ */
async function fetchOrders() {
  await ensureAuth();
  var snap = await db.collection('orders').get();
  var rows = snap.docs.map(function(d) { return { _id: d.id, ...d.data() }; });
  rows.sort(function(a, b) { return (parseInt(a['Sr. No.']) || 0) - (parseInt(b['Sr. No.']) || 0); });
  return { rows: rows };
}

async function addOrder(data, customId) {
  await ensureAuth();
  var sr = data['Sr. No.'] || '0';
  var id = customId || ('order_' + sr);
  await db.collection('orders').doc(id).set({
    ...data,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  syncToSheet({ ...data, _collection: 'orders', _id: id });
  return id;
}

/* Insert a new order at a chosen Sr. No. and move every order from that
   number onwards down by one (5 -> 6, 6 -> 7 ...). Done in one safe
   Firestore batch so nothing is half-changed if something goes wrong. */
var ORDER_SHEET_COLUMNS = ['Sr. No.','CUSTOMER','Style No.','Jewelry Type','Diamond Shape','Date',
  'Gross Wt','Dia Qty','IN CT','COLOUR STONE','Net Wt','Multiplier','Pg Wt','Gold Amount',
  'Diam Amount','L CHARGES','Labor Amount','SUB TOTAL','$','Sold To','Sale Price','Date Sold',
  'Amount Paid','Balance Due','Payment Status','Payment Log','Memo No.'];

/* The Google Sheet keeps the old row's value when a field is missing.
   So every column is sent (empty if needed) to stop one order's data
   leaking into another order's row. */
function forSheet(rec, id) {
  var out = {};
  for (var k in rec) {
    if (k === 'createdAt' || k === 'updatedAt') continue;
    out[k] = rec[k];
  }
  ORDER_SHEET_COLUMNS.forEach(function(c) {
    if (out[c] === undefined || out[c] === null) out[c] = '';
  });
  out._collection = 'orders';
  out._id = id;
  return out;
}

async function insertOrderAt(data, insertSr, allOrders) {
  await ensureAuth();
  var target = parseInt(insertSr);

  var toShift = allOrders.filter(function(r) {
    return (parseInt(r['Sr. No.']) || 0) >= target;
  }).sort(function(a, b) {
    return (parseInt(b['Sr. No.']) || 0) - (parseInt(a['Sr. No.']) || 0); // highest first
  });

  var ts = window.firebase.firestore.FieldValue.serverTimestamp();
  var ops = []; // { type: 'set'|'delete', id, data }
  var newIds = {};
  var sheetPayloads = [];

  toShift.forEach(function(r) {
    var newSr = (parseInt(r['Sr. No.']) + 1).toString();
    var newId = 'order_' + newSr;
    newIds[newId] = true;
    var copy = {};
    for (var k in r) {
      if (k === '_id' || k === '_type' || k === '_sortSr' || k === '_sortMemo') continue;
      copy[k] = r[k];
    }
    copy['Sr. No.'] = newSr;
    copy.updatedAt = ts;
    ops.push({ type: 'set', id: newId, data: copy });
    sheetPayloads.push(forSheet(copy, newId));
  });

  var freshId = 'order_' + target;
  newIds[freshId] = true;

  // old documents whose id is not reused must be removed
  toShift.forEach(function(r) {
    if (!newIds[r._id]) ops.push({ type: 'delete', id: r._id });
  });

  var freshData = { ...data, 'Sr. No.': target.toString(), createdAt: ts, updatedAt: ts };
  ops.push({ type: 'set', id: freshId, data: freshData });

  // commit in chunks of 400 (Firestore limit is 500 per batch)
  for (var i = 0; i < ops.length; i += 400) {
    var batch = db.batch();
    ops.slice(i, i + 400).forEach(function(op) {
      var ref = db.collection('orders').doc(op.id);
      if (op.type === 'set') batch.set(ref, op.data);
      else batch.delete(ref);
    });
    await batch.commit();
  }

  // update the Google Sheet one row at a time, in order, in the background
  sheetPayloads.push(forSheet(freshData, freshId));
  sheetPayloads[sheetPayloads.length - 1]['Sr. No.'] = target.toString();
  (async function() {
    if (window.showToast && sheetPayloads.length > 1) {
      showToast('Updating Google Sheet (' + sheetPayloads.length + ' rows). Please keep this page open...', 'info', 6000);
    }
    for (var j = 0; j < sheetPayloads.length; j++) {
      await syncToSheet(sheetPayloads[j], true);
    }
    if (window.showToast) showToast('Google Sheet is up to date', 'success', 3000);
  })();
  return freshId;
}

async function updateOrder(id, data) {
  await ensureAuth();
  await db.collection('orders').doc(id).set({
    ...data,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  syncToSheet({ ...data, _collection: 'orders' });
}

async function deleteOrder(id, srNo) {
  await ensureAuth();
  await db.collection('orders').doc(id).delete();
  syncToSheet({ 'Sr. No.': srNo, _action: 'delete', _collection: 'orders' });
}

/* ============ TRADING ============ */
async function fetchTrading() {
  await ensureAuth();
  var snap = await db.collection('trading').get();
  var rows = snap.docs.map(function(d) { return { _id: d.id, ...d.data() }; });
  rows.sort(function(a, b) { return (parseInt(a['Sr. No.']) || 0) - (parseInt(b['Sr. No.']) || 0); });
  return { rows: rows };
}

async function addTrading(data, customId) {
  await ensureAuth();
  var sr = data['Sr. No.'] || '0';
  var id = customId || ('trade_' + sr);
  await db.collection('trading').doc(id).set({
    ...data,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  syncToSheet({ ...data, _collection: 'trading', _id: id });
  return id;
}

async function updateTrading(id, data) {
  await ensureAuth();
  await db.collection('trading').doc(id).set({
    ...data,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  syncToSheet({ ...data, _collection: 'trading' });
}

async function deleteTrading(id, srNo) {
  await ensureAuth();
  await db.collection('trading').doc(id).delete();
  syncToSheet({ 'Sr. No.': srNo, _action: 'delete', _collection: 'trading' });
}

/* ============ EXPENSES ============ */
async function fetchExpenses() {
  await ensureAuth();
  var snap = await db.collection('expenses').get();
  var rows = snap.docs.map(function(d) { return { _id: d.id, ...d.data() }; });
  rows.sort(function(a, b) { return (parseInt(a['Sr. No.']) || 0) - (parseInt(b['Sr. No.']) || 0); });
  return { rows: rows };
}

async function addExpense(data, customId) {
  await ensureAuth();
  var sr = data['Sr. No.'] || '0';
  var id = customId || ('expense_' + sr);
  await db.collection('expenses').doc(id).set({
    ...data,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  syncToSheet({ ...data, _collection: 'expenses', _id: id });
  return id;
}

async function updateExpense(id, data) {
  await ensureAuth();
  await db.collection('expenses').doc(id).set({
    ...data,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  syncToSheet({ ...data, _collection: 'expenses' });
}

async function deleteExpense(id, srNo) {
  await ensureAuth();
  await db.collection('expenses').doc(id).delete();
  syncToSheet({ 'Sr. No.': srNo, _action: 'delete', _collection: 'expenses' });
}

/* ============ SHEET SYNC ============ */
function syncToSheet(payload, quiet) {
  var url = SHEET_WEBHOOK_URL + '?secret=vinere-sync-2026';
  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  })
  .then(function() {
    if (!quiet && window.showToast) showToast('Synced to Google Sheet', 'success', 2500);
  })
  .catch(function(err) {
    if (window.showToast) showToast('Sheet sync failed', 'error', 4000);
    console.error('Sync failed', err);
  });
}

/* ============ SETTINGS ============ */
async function fetchSettings() {
  await ensureAuth();
  var doc = await db.collection('settings').doc('goldRate').get();
  if (doc.exists) return doc.data();
  return { rate: 16000, updatedAt: null };
}

async function saveSettings(rate) {
  await ensureAuth();
  await db.collection('settings').doc('goldRate').set({
    rate: rate,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  syncToSheet({ _collection: 'settings', rate: rate });
}

/* ============ BUYERS ============ */
async function fetchBuyers() {
  await ensureAuth();
  var snap = await db.collection('buyers').get();
  var rows = snap.docs.map(function(d) { return { _id: d.id, ...d.data() }; });
  return { rows: rows };
}

async function addBuyer(data, customId) {
  await ensureAuth();
  var id = customId || db.collection('buyers').doc().id;
  await db.collection('buyers').doc(id).set({
    ...data,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  syncToSheet({ ...data, _collection: 'buyers', _id: id });
  return id;
}

async function updateBuyer(id, data) {
  await ensureAuth();
  await db.collection('buyers').doc(id).set({
    ...data,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  syncToSheet({ ...data, _collection: 'buyers', _id: id });
}

async function deleteBuyer(id) {
  await ensureAuth();
  await db.collection('buyers').doc(id).delete();
  syncToSheet({ _id: id, _action: 'delete', _collection: 'buyers' });
}

/* ============ EXPOSE GLOBALLY ============ */
window.db = db;
window.fetchOrders = fetchOrders;
window.fetchTrading = fetchTrading;
window.fetchExpenses = fetchExpenses;
window.addOrder = addOrder;
window.insertOrderAt = insertOrderAt;
window.updateOrder = updateOrder;
window.deleteOrder = deleteOrder;
window.addTrading = addTrading;
window.updateTrading = updateTrading;
window.deleteTrading = deleteTrading;
window.addExpense = addExpense;
window.updateExpense = updateExpense;
window.deleteExpense = deleteExpense;
window.fetchSettings = fetchSettings;
window.saveSettings = saveSettings;
window.fetchBuyers = fetchBuyers;
window.addBuyer = addBuyer;
window.updateBuyer = updateBuyer;
window.deleteBuyer = deleteBuyer;
