/* ============================================
   VINÉRE — Order Panel (Create / Edit)
   ============================================ */

var editingId = null;
var currentInstallments = [];
var readOnly = false;

/* ============ MEMO HELPERS ============ */
function getMemoOrders(memoNo) {
  if (!memoNo) return [];
  return ORDERS.filter(function(o) {
    return o[DK.memoNo] === memoNo;
  });
}

function getMemoTrades(memoNo) {
  if (!memoNo) return [];
  return TRADING.filter(function(t) {
    return t[SHEET_KEYS.memoNo] === memoNo;
  });
}

function getAggregatedPaymentLog(memoNo) {
  var orders = getMemoOrders(memoNo);
  var trades = getMemoTrades(memoNo);
  var seen = {};
  var allPayments = [];
  orders.forEach(function(o) {
    var log = [];
    try { log = JSON.parse(o[DK.paymentLog] || '[]'); } catch(e) { log = []; }
    log.forEach(function(p) {
      var key = (p.amount || '0') + '|' + (p.date || '');
      if (!seen[key]) {
        seen[key] = true;
        allPayments.push(p);
      }
    });
  });
  trades.forEach(function(t) {
    var log = [];
    try { log = JSON.parse(t[SHEET_KEYS.paymentLog] || '[]'); } catch(e) { log = []; }
    log.forEach(function(p) {
      var key = (p.amount || '0') + '|' + (p.date || '');
      if (!seen[key]) {
        seen[key] = true;
        allPayments.push(p);
      }
    });
  });
  return allPayments.sort(function(a, b) {
    return new Date(a.date || 0) - new Date(b.date || 0);
  });
}

async function syncMemoPayments(memoNo, paymentLog, sourceId) {
  var orders = getMemoOrders(memoNo);
  var memoTotalBill = orders.reduce(function(s, o) { return s + (parseFloat(o[DK.salePrice]) || 0); }, 0);
  var memoTotalPaid = paymentLog.reduce(function(s, p) { return s + (parseFloat(p.amount) || 0); }, 0);

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o._id === sourceId) continue;

    var salePrice = parseFloat(o[DK.salePrice]) || 0;
    var balance = salePrice - memoTotalPaid;
    var status = 'Not Sold';
    if (salePrice) {
      if (memoTotalPaid >= memoTotalBill) status = 'Paid';
      else if (memoTotalPaid > 0) status = 'Partial';
      else status = 'Unpaid';
    }

    var data = {};
    for (var k in o) data[k] = o[k];
    data[DK.amountPaid] = memoTotalPaid.toString();
    data[DK.balanceDue] = balance.toString();
    data[DK.paymentStatus] = status;
    data[DK.paymentLog] = JSON.stringify(paymentLog);

    try { await window.updateOrder(o._id, data); } catch(e) { console.error('Memo sync failed for', o._id, e); }
  }
}

window.openOrderPanel = function(id) {
  editingId = id || null;
  currentInstallments = [];

  var panel = $('panel');
  var overlay = $('overlay');

  // Reset fields
  ['f_customer','f_style','f_date','f_grossWt','f_netWt','f_diaQty','f_inCt',
   'f_colourStone','f_multiplier','f_diamAmount','f_lCharges','f_memoNo',
   'f_soldTo','f_salePrice','f_dateSold'].forEach(function(fid) { $(fid).value = ''; });
  $('f_multiplier').value = '0.595';
  $('f_lCharges').value = '900';

  currentInstallments = [];
  renderInstallments();
  updatePreview();

  $('saveMsg').textContent = '';
  $('saveMsg').style.color = '';

  document.querySelectorAll('.field-error').forEach(function(el) { el.textContent = ''; });

  if (id) {
    var order = ORDERS.find(function(r) { return r._id === id; });
    if (!order) return;

    $('panelTitle').textContent = 'Edit Order #' + order[DK.sr];
    $('f_customer').value = order[DK.customer] || '';
    $('f_style').value = order[DK.style] || '';
    $('f_date').value = order[DK.date] || '';
    $('f_grossWt').value = order[DK.grossWt] || '';
    $('f_netWt').value = order[DK.netWt] || '';
    $('f_diaQty').value = order[DK.diaQty] || '';
    $('f_inCt').value = order[DK.inCt] || '';
    $('f_colourStone').value = order[DK.colourStone] || '';
    $('f_multiplier').value = order[DK.multiplier] || '0.595';
    $('f_diamAmount').value = order[DK.diamAmount] || '';
    $('f_lCharges').value = order[DK.lCharges] || '900';
    $('f_memoNo').value = order[DK.memoNo] || '';
    $('f_soldTo').value = order[DK.soldTo] || '';
    $('f_salePrice').value = order[DK.salePrice] || '';
    $('f_dateSold').value = order[DK.dateSold] || '';

    // Load aggregated payment log for memo, or own log if no memo
    var memoNo = order[DK.memoNo];
    if (memoNo) {
      currentInstallments = getAggregatedPaymentLog(memoNo);
    } else {
      try { currentInstallments = JSON.parse(order[DK.paymentLog] || '[]'); } catch(e) { currentInstallments = []; }
    }
    renderInstallments();
    updateMemoSummary();

    $('deleteBtn').style.display = (ROLE === 'staff') ? 'inline-flex' : 'none';
    readOnly = ROLE === 'customer';
  } else {
    $('panelTitle').textContent = 'New Order';
    $('f_date').value = new Date().toISOString().split('T')[0];
    $('deleteBtn').style.display = 'none';
    readOnly = false;
  }

  setReadOnly(readOnly);
  updatePreview();

  overlay.style.display = 'block';
  panel.classList.add('open');
};

function setReadOnly(ro) {
  var inputs = panel.querySelectorAll('input, select');
  inputs.forEach(function(inp) { inp.disabled = ro; });
  $('saveBtn').style.display = ro ? 'none' : 'block';
  $('addInstallmentBtn').style.display = ro ? 'none' : 'block';
}

$('closePanel').addEventListener('click', closePanel);
$('overlay').addEventListener('click', closePanel);

function closePanel() {
  $('panel').classList.remove('open');
  $('overlay').style.display = 'none';
  editingId = null;
}

/* ============ LIVE PREVIEW ============ */
['f_netWt','f_multiplier','f_lCharges','f_diamAmount','f_salePrice','f_memoNo'].forEach(function(id) {
  $(id).addEventListener('input', updatePreview);
});

// Load memo payments when typing memoNo on new orders
$('f_memoNo').addEventListener('input', function() {
  var memoNo = this.value.trim().toUpperCase();
  if (memoNo && !editingId && !currentInstallments.length) {
    currentInstallments = getAggregatedPaymentLog(memoNo);
    renderInstallments();
  }
  updatePreview();
  updateMemoSummary();
});

function updatePreview() {
  var netWt = parseFloat($('f_netWt').value) || 0;
  var multiplier = parseFloat($('f_multiplier').value) || 0.595;
  var lCharges = parseFloat($('f_lCharges').value) || 900;
  var diamAmount = parseFloat($('f_diamAmount').value) || 0;
  var salePrice = parseFloat($('f_salePrice').value) || 0;

  var pgWt = netWt * multiplier;
  var goldRate = window.GOLD_RATE || 16000;
  var goldAmt = pgWt * goldRate;
  var isFlatLabor = $('f_flatLabor') && $('f_flatLabor').checked;
  var laborAmt = isFlatLabor ? lCharges : netWt * lCharges;
  var subTotal = goldAmt + diamAmount + laborAmt;
  var usd = subTotal / 94;

  $('prev_pgWt').textContent = pgWt ? pgWt.toFixed(3) + ' g' : '—';
  $('prev_goldAmt').textContent = goldAmt ? '₹' + Math.round(goldAmt).toLocaleString('en-IN') : '—';
  $('prev_laborAmt').textContent = laborAmt ? '₹' + Math.round(laborAmt).toLocaleString('en-IN') : '—';
  $('prev_subTotal').textContent = subTotal ? '₹' + Math.round(subTotal).toLocaleString('en-IN') : '—';
  $('prev_usd').textContent = usd ? '$' + usd.toFixed(2) : '—';

  var totalPaid = currentInstallments.reduce(function(s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
  var balance = salePrice ? salePrice - totalPaid : 0;
  var status = 'Not Sold';
  if (salePrice) {
    if (totalPaid >= salePrice) status = 'Paid';
    else if (totalPaid > 0) status = 'Partial';
    else status = 'Unpaid';
  }

  $('prev_amountPaid').textContent = totalPaid ? '$' + fmtMoney(totalPaid) : '$0';
  $('prev_balanceDue').textContent = salePrice ? '$' + fmtMoney(balance) : '—';
  $('prev_paymentStatus').textContent = status;
  updateMemoSummary();
}

/* ============ MEMO SUMMARY ============ */
function updateMemoSummary() {
  var memoNo = $('f_memoNo').value.trim().toUpperCase();
  var el = $('memoSummary');
  if (!memoNo) { el.style.display = 'none'; el.textContent = ''; return; }

  var memoOrders = ORDERS.filter(function(o) { return o[DK.memoNo] === memoNo && o._id !== editingId; });
  var memoTrades = TRADING.filter(function(t) { return t[SHEET_KEYS.memoNo] === memoNo; });

  var currentSalePrice = parseFloat($('f_salePrice').value) || 0;

  // totalPaid comes from currentInstallments (already aggregated across all orders in memo)
  var totalPaid = currentInstallments.reduce(function(s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

  var totalBill = currentSalePrice;
  var itemCount = 1;

  memoOrders.forEach(function(o) {
    totalBill += parseFloat(o[DK.salePrice]) || 0;
    itemCount++;
  });
  memoTrades.forEach(function(t) {
    totalBill += parseFloat(t[SHEET_KEYS.salePrice]) || 0;
    itemCount++;
  });

  var balance = totalBill - totalPaid;
  var status = totalBill === 0 ? 'Not Sold' : (totalPaid >= totalBill ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Unpaid'));

  el.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Memo Summary: ' + escapeHtml(memoNo) + ' (' + itemCount + ' items)</div>' +
    '<div class="computed-row"><span class="label">Total Bill</span><span class="value">$' + fmtMoney(totalBill) + '</span></div>' +
    '<div class="computed-row"><span class="label">Total Paid</span><span class="value">$' + fmtMoney(totalPaid) + '</span></div>' +
    '<div class="computed-row"><span class="label">Balance Due</span><span class="value" style="color:' + (balance > 0 ? 'var(--error)' : 'var(--success)') + '">$' + fmtMoney(balance) + '</span></div>' +
    '<div class="computed-row"><span class="label">Memo Status</span><span class="value">' + status + '</span></div>';
  el.style.display = 'block';
}

/* ============ INSTALLMENTS ============ */
$('addInstallmentBtn').addEventListener('click', async function() {
  var amt = parseFloat($('f_instAmount').value);
  var date = $('f_instDate').value;
  if (!amt || amt <= 0 || !date) {
    $('err_f_installment').textContent = 'Enter valid amount and date';
    return;
  }
  currentInstallments.push({ amount: amt, date: date });
  $('f_instAmount').value = '';
  $('f_instDate').value = '';
  $('err_f_installment').textContent = '';
  renderInstallments();
  updatePreview();

  var memoNo = $('f_memoNo').value.trim().toUpperCase();
  if (memoNo && editingId) {
    try {
      await syncMemoPayments(memoNo, currentInstallments, editingId);
      await doFetchOrders();
    } catch(e) { console.error('Memo sync error', e); }
  }
});

function renderInstallments() {
  var list = $('installmentsList');
  if (!currentInstallments.length) { list.innerHTML = ''; return; }
  list.innerHTML = currentInstallments.map(function(inst, i) {
    return '<div class="installment-item">' +
      '<span>$' + fmtMoney(inst.amount) + ' · ' + inst.date + '</span>' +
      '<button onclick="window.removeInst(' + i + ')">&times;</button>' +
      '</div>';
  }).join('');
}

window.removeInst = async function(idx) {
  currentInstallments.splice(idx, 1);
  renderInstallments();
  updatePreview();

  var memoNo = $('f_memoNo').value.trim().toUpperCase();
  if (memoNo && editingId) {
    try {
      await syncMemoPayments(memoNo, currentInstallments, editingId);
      await doFetchOrders();
    } catch(e) { console.error('Memo sync error', e); }
  }
};

/* ============ SAVE ============ */
$('saveBtn').addEventListener('click', async function() {
  if (readOnly) return;

  var valid = true;
  document.querySelectorAll('.field-error').forEach(function(el) { el.textContent = ''; });

  if (!$('f_customer').value.trim()) { $('err_f_customer').textContent = 'Required'; valid = false; }
  if (!$('f_style').value.trim()) { $('err_f_style').textContent = 'Required'; valid = false; }
  if (!$('f_netWt').value.trim()) { $('err_f_netWt').textContent = 'Required'; valid = false; }

  var netWt = parseFloat($('f_netWt').value) || 0;
  var grossWt = parseFloat($('f_grossWt').value) || 0;
  if (grossWt && netWt > grossWt) { $('err_f_netWt').textContent = 'Net Wt cannot exceed Gross Wt'; valid = false; }

  var salePrice = parseFloat($('f_salePrice').value) || 0;
  var totalPaid = currentInstallments.reduce(function(s, i) { return s + (parseFloat(i.amount) || 0); }, 0);

  // For memo orders, allow payments up to memo total bill
  var memoNo = $('f_memoNo').value.trim().toUpperCase();
  var maxAllowed = salePrice;
  if (memoNo) {
    var memoOrders = ORDERS.filter(function(o) { return o[DK.memoNo] === memoNo && o._id !== editingId; });
    var memoTrades = TRADING.filter(function(t) { return t[SHEET_KEYS.memoNo] === memoNo; });
    maxAllowed = salePrice +
      memoOrders.reduce(function(s, o) { return s + (parseFloat(o[DK.salePrice]) || 0); }, 0) +
      memoTrades.reduce(function(s, t) { return s + (parseFloat(t[SHEET_KEYS.salePrice]) || 0); }, 0);
  }

  if (salePrice && totalPaid > maxAllowed) { $('err_f_installment').textContent = 'Payments exceed total bill'; valid = false; }

  if (!valid) {
    $('saveMsg').textContent = 'Please fix the highlighted fields.';
    $('saveMsg').style.color = '#f87171';
    showToast('Please fix the highlighted fields before saving.', 'warning');
    return;
  }

  $('saveMsg').textContent = '';

  var net = parseFloat($('f_netWt').value) || 0;
  var mult = parseFloat($('f_multiplier').value) || 0.595;
  var lCharge = parseFloat($('f_lCharges').value) || 900;
  var diam = parseFloat($('f_diamAmount').value) || 0;
  var pgWt = net * mult;
  var goldRate = window.GOLD_RATE || 16000;
  var goldAmt = pgWt * goldRate;
  var isFlatLaborSave = $('f_flatLabor') && $('f_flatLabor').checked;
  var laborAmt = isFlatLaborSave ? lCharge : net * lCharge;
  var subTotal = goldAmt + diam + laborAmt;
  var usd = subTotal / 94;

  var status = 'Not Sold';
  if (salePrice) {
    if (totalPaid >= salePrice) status = 'Paid';
    else if (totalPaid > 0) status = 'Partial';
    else status = 'Unpaid';
  }

  var data = {};
  data[DK.customer] = $('f_customer').value.trim().toUpperCase();
  data[DK.style] = $('f_style').value.trim().toUpperCase();
  data[DK.date] = $('f_date').value;
  data[DK.grossWt] = $('f_grossWt').value || '';
  data[DK.netWt] = $('f_netWt').value;
  data[DK.diaQty] = $('f_diaQty').value || '';
  data[DK.inCt] = $('f_inCt').value || '';
  data[DK.colourStone] = $('f_colourStone').value || '';
  data[DK.multiplier] = mult.toString();
  data[DK.pgWt] = pgWt.toFixed(3);
  data[DK.goldAmt] = Math.round(goldAmt).toString();
  data[DK.diamAmount] = diam ? diam.toString() : '';
  data[DK.lCharges] = lCharge.toString();
  data[DK.laborAmt] = Math.round(laborAmt).toString();
  data[DK.subTotal] = Math.round(subTotal).toString();
  data[DK.usd] = usd.toFixed(2);
  data['Gold Rate'] = (window.GOLD_RATE || 16000).toString();
  data[DK.memoNo] = $('f_memoNo').value.trim().toUpperCase();
  data[DK.soldTo] = $('f_soldTo').value.trim();
  data[DK.salePrice] = salePrice ? salePrice.toString() : '';
  data[DK.dateSold] = $('f_dateSold').value || '';
  data[DK.amountPaid] = totalPaid.toString();
  data[DK.balanceDue] = (salePrice - totalPaid).toString();
  data[DK.paymentStatus] = status;
  data[DK.paymentLog] = JSON.stringify(currentInstallments);

  try {
    if (editingId) {
      var existing = ORDERS.find(function(r) { return r._id === editingId; });
      data[DK.sr] = existing[DK.sr];
      await window.updateOrder(editingId, data);

      // Sync memo payments to sibling orders
      var memoNo = data[DK.memoNo];
      if (memoNo) {
        await syncMemoPayments(memoNo, currentInstallments, editingId);
      }

      showToast('Order #' + data[DK.sr] + ' updated successfully', 'success');
    } else {
      var nextSr = ORDERS.length > 0 ? Math.max.apply(null, ORDERS.map(function(r) { return parseInt(r[DK.sr]) || 0; })) + 1 : 1;
      data[DK.sr] = nextSr.toString();
      await window.addOrder(data);
      showToast('Order #' + nextSr + ' created successfully', 'success');
    }
    closePanel();
    await doFetchOrders();
    renderAll();
  } catch (err) {
    console.error(err);
    $('saveMsg').textContent = 'Error saving. Try again.';
    showToast('Failed to save order. Please try again.', 'error');
  }
});

/* ============ DELETE + RENUMBER ============ */
var deleteTimer = null;
var deleteProgress = 0;

function startDeleteTimer() {
  if (!editingId || ROLE !== 'staff') return;
  var btn = $('deleteBtn');
  btn.classList.add('deleting');
  deleteProgress = 0;

  deleteTimer = setInterval(function() {
    deleteProgress += 50;
    var pct = (deleteProgress / 3000) * 100;
    btn.style.setProperty('--delete-progress', pct + '%');

    if (deleteProgress >= 3000) {
      clearInterval(deleteTimer);
      deleteTimer = null;
      btn.classList.remove('deleting');
      doDeleteOrder();
    }
  }, 50);
}

function cancelDeleteTimer() {
  if (deleteTimer) {
    clearInterval(deleteTimer);
    deleteTimer = null;
  }
  var btn = $('deleteBtn');
  btn.classList.remove('deleting');
  btn.style.setProperty('--delete-progress', '0%');
}

async function renumberOrdersAfterDelete(deletedSr) {
  var toUpdate = ORDERS.filter(function(r) {
    return parseInt(r[DK.sr]) > parseInt(deletedSr);
  }).sort(function(a, b) {
    return parseInt(a[DK.sr]) - parseInt(b[DK.sr]);
  });
  for (var i = 0; i < toUpdate.length; i++) {
    var r = toUpdate[i];
    var newSr = (parseInt(r[DK.sr]) - 1).toString();
    var data = {};
    for (var k in r) data[k] = r[k];
    data[DK.sr] = newSr;
    try { await window.updateOrder(r._id, data); } catch(e) { console.error('Renumber failed for', r._id, e); }
  }
}

async function doDeleteOrder() {
  if (!editingId) return;
  var order = ORDERS.find(function(r) { return r._id === editingId; });
  var srNo = order ? order[DK.sr] : '';

  try {
    await window.deleteOrder(editingId, srNo);
    if (srNo) await renumberOrdersAfterDelete(srNo);
    showToast('Order deleted', 'success');
    closePanel();
    await doFetchOrders();
    renderAll();
  } catch (err) {
    console.error(err);
    showToast('Failed to delete order', 'error');
  }
}

$('deleteBtn').addEventListener('mousedown', startDeleteTimer);
$('deleteBtn').addEventListener('touchstart', startDeleteTimer);
$('deleteBtn').addEventListener('mouseup', cancelDeleteTimer);
$('deleteBtn').addEventListener('mouseleave', cancelDeleteTimer);
$('deleteBtn').addEventListener('touchend', cancelDeleteTimer);
