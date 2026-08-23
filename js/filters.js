/* ============================================
   VINÉRE — Filters
   ============================================ */

$('filterCustomer').addEventListener('change', function() { window.currentPage = 1; renderAll(); });
$('filterDateFrom').addEventListener('change', function() { window.currentPage = 1; renderAll(); });
$('filterDateTo').addEventListener('change', function() { window.currentPage = 1; renderAll(); });
$('filterSaleStatus').addEventListener('change', function() { window.currentPage = 1; renderAll(); });
$('filterSoldTo').addEventListener('input', function() { window.currentPage = 1; renderAll(); });
$('filterMemoNo').addEventListener('input', function() { window.currentPage = 1; renderAll(); });
