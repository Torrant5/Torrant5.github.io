/* こもれび整体院（架空） 改善見本 v0.2
   外部通信なし。予約ボタンは見本案内を開くだけで、送信・発信はしない。 */
(function () {
  'use strict';

  var hint = document.getElementById('cta-hint');
  if (hint) {
    hint.textContent = '日曜・祝日は休み';
  }

  /* ---- スクロールに合わせた段階表示 ---- */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---- 予約（見本案内シート） ---- */
  var openBtn = document.getElementById('open-booking');
  var sheet = document.getElementById('booking');
  var closeBtn = document.getElementById('close-booking');
  if (!openBtn || !sheet || !closeBtn) return;

  var lastFocus = null;
  var supportsDialog = typeof sheet.showModal === 'function';

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    var f = sheet.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    lastFocus = document.activeElement;
    if (supportsDialog) {
      sheet.showModal();
    } else {
      sheet.setAttribute('open', '');
    }
    closeBtn.focus();
  }

  function close() {
    if (supportsDialog && sheet.open) {
      sheet.close();
    } else {
      sheet.removeAttribute('open');
      restoreFocus();
    }
  }

  function restoreFocus() {
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  sheet.addEventListener('close', restoreFocus);
  sheet.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !supportsDialog) { close(); }
    trapFocus(e);
  });
  // 背景（シートの外側）を押したら閉じる
  sheet.addEventListener('click', function (e) {
    if (e.target === sheet) close();
  });

  // キーボードで押したときも押下の手応えを出す
  openBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') openBtn.classList.add('is-pressed');
  });
  openBtn.addEventListener('keyup', function () { openBtn.classList.remove('is-pressed'); });
  openBtn.addEventListener('blur', function () { openBtn.classList.remove('is-pressed'); });
})();
