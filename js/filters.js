/* ============================================
   VINÉRE — Filters
   ============================================ */

$('filterSoldTo').addEventListener('input', function() { window.currentPage = 1; renderAll(); });
$('filterMemoNo').addEventListener('input', function() { window.currentPage = 1; renderAll(); });
$('filterPaymentStatus').addEventListener('change', function() { window.currentPage = 1; renderAll(); });
