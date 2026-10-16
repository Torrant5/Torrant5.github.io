/* 比較画面：狭い画面では修正前/修正後を切り替えて表示する。外部通信なし。 */
(function () {
  'use strict';
  var stage = document.querySelector('.stage');
  var buttons = document.querySelectorAll('.switch-btn');
  if (!stage || !buttons.length) return;

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-show');
      stage.setAttribute('data-view', view);
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });
})();
