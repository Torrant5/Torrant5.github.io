/* CSV点検ツール 画面処理 v0.1（Torrant5 自主制作）
   ファイルはこのページの中だけで処理し、どこにも送信しない。 */
(function () {
  'use strict';
  var C = window.CsvCheck;
  var PAGE = 100;

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('file');
  var encSel = $('encoding');
  var sampleBtn = $('load-sample');
  var runBtn = $('run');
  var status = $('status');
  var errBox = $('error');
  var setup = $('setup');
  var colsBox = $('required-cols');
  var idSel = $('id-col');
  var result = $('result');
  var summary = $('summary');
  var findTable = $('findings-body');
  var findPager = $('findings-pager');
  var prevTable = $('preview');
  var prevPager = $('preview-pager');
  var dlFind = $('dl-findings');
  var dedupBtn = $('dedup');
  var dedupNote = $('dedup-note');
  var fileMeta = $('file-meta');

  var saveNote = $('save-note');
  var state = { name: null, bytes: null, data: null, report: null, findPage: 0, prevPage: 0, gen: 0, reader: null };

  var SAMPLE = [
    '注文番号,顧客名,メール,商品コード,数量,金額',
    '1001,佐藤 架空,sato@example.invalid,A-001,2,3000',
    '1002,鈴木 架空,,B-010,1,1500',
    '1003,"高橋, 架空",takahashi@example.invalid,A-001,1,=SUM(1;2)',
    '1001,佐藤 架空,sato@example.invalid,A-001,2,3000',
    '1004,田中 架空,tanaka@example.invalid,"C-100',
    '改行入り",3,00450',
    '1002,鈴木 架空,suzuki@example.invalid,B-010,1,1500',
    '1005,   ,ito@example.invalid,D-7,1,-200',
    '1004,田中 架空,tanaka@example.invalid,"C-100',
    '改行入り",3,00450'
  ].join('\r\n') + '\r\n';

  function setStatus(msg) { status.textContent = msg; }
  function showError(msg, lineNo) {
    errBox.textContent = msg + (lineNo ? '（' + lineNo + '行目）' : '');
    errBox.hidden = false;
    errBox.focus();
  }
  function clearError() { errBox.hidden = true; errBox.textContent = ''; }
  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // 点検結果だけを無効化（条件変更時・再読込時）
  function invalidateResult() {
    state.report = null; state.findPage = 0; state.prevPage = 0;
    result.hidden = true;
    clearChildren(findTable); clearChildren(prevTable); clearChildren(findPager); clearChildren(prevPager); clearChildren(summary);
    dedupNote.textContent = ''; saveNote.textContent = '';
    dlFind.disabled = true; dedupBtn.disabled = true;
  }
  // 解析結果と列設定も無効化（文字コード変更・再読込時）
  function resetAll() {
    invalidateResult();
    state.data = null;
    setup.hidden = true;
    clearChildren(colsBox); clearChildren(idSel);
    runBtn.disabled = true;
  }
  // 新しい読み込みの開始：前のファイルの痕跡（bytes・名前・表示）を残さず、進行中の読み込みを打ち切る
  function beginLoad() {
    state.gen++;
    if (state.reader) { try { state.reader.abort(); } catch (e) { /* 打ち切り済み */ } state.reader = null; }
    state.bytes = null; state.name = null;
    fileMeta.textContent = '';
    resetAll(); clearError();
    return state.gen;
  }

  /* ---- 読み込み ---- */
  fileInput.addEventListener('change', function () {
    var gen = beginLoad();
    var f = fileInput.files && fileInput.files[0];
    if (!f) { setStatus('ファイルが選ばれていません。'); return; }
    if (f.size > C.LIMITS.maxBytes) {
      showError('ファイルが ' + (C.LIMITS.maxBytes / 1024 / 1024) + 'MB を超えています。本ツールはブラウザ内処理のため、この上限を設けています。');
      setStatus('読み取り失敗');
      return;
    }
    setStatus('読み込み中…');
    var reader = new FileReader();
    state.reader = reader;
    reader.onload = function () {
      if (gen !== state.gen) return; // 後から別の読み込みが始まっていれば古い結果は捨てる
      state.reader = null;
      state.name = f.name; state.bytes = new Uint8Array(reader.result);
      fileMeta.textContent = f.name + '（' + f.size.toLocaleString() + ' バイト）';
      decodeAndParse();
    };
    reader.onerror = function () {
      if (gen !== state.gen) return;
      state.reader = null;
      showError('ファイルを読み込めませんでした。'); setStatus('読み取り失敗');
    };
    reader.onabort = function () { /* 新しい読み込みで打ち切り */ };
    reader.readAsArrayBuffer(f);
  });

  encSel.addEventListener('change', function () {
    if (state.bytes) { resetAll(); clearError(); decodeAndParse(); }
    else { resetAll(); } // 読み込み前・失敗後は何も復活させない
  });

  sampleBtn.addEventListener('click', function () {
    beginLoad();
    fileInput.value = '';
    state.name = 'sample-orders.csv';
    state.bytes = new TextEncoder().encode(SAMPLE);
    encSel.value = 'utf-8';
    fileMeta.textContent = '架空サンプル sample-orders.csv（' + state.bytes.length + ' バイト・架空の注文データ）';
    decodeAndParse();
  });

  function decodeAndParse() {
    var dec = C.decodeBytes(state.bytes, encSel.value);
    if (dec.error) { showError(dec.error); setStatus('読み取り失敗'); return; }
    var parsed = C.parse(dec.text);
    if (parsed.error) { showError(parsed.error, parsed.line); setStatus('形式エラーのため点検できません'); return; }
    state.data = parsed;
    setStatus('読み込み完了：' + parsed.header.length + '列・' + parsed.rows.length.toLocaleString() + '行（文字コード ' + (dec.encodingUsed === 'shift_jis' ? 'Shift_JIS' : 'UTF-8') + (dec.hadBom ? '・BOMあり' : '') + '）');
    buildSetup(parsed.header);
    setup.hidden = false;
    runBtn.disabled = false;
    runBtn.focus();
  }

  // 条件（必須列・ID列）を変えたら、前の結果と保存ボタンを無効にして再点検を促す
  function onConditionChange() {
    if (!state.report) return;
    invalidateResult();
    setStatus('点検する列が変わりました。「点検する」を押して、現在の条件で点検し直してください。');
    runBtn.focus();
  }
  colsBox.addEventListener('change', onConditionChange);
  idSel.addEventListener('change', onConditionChange);

  function buildSetup(header) {
    clearChildren(colsBox); clearChildren(idSel);
    header.forEach(function (h, i) {
      var lab = document.createElement('label');
      lab.className = 'chk';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = String(i); cb.name = 'req';
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + h));
      colsBox.appendChild(lab);
    });
    var none = document.createElement('option');
    none.value = ''; none.textContent = '指定しない';
    idSel.appendChild(none);
    header.forEach(function (h, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = h;
      idSel.appendChild(o);
    });
  }

  /* ---- 点検 ---- */
  runBtn.addEventListener('click', function () {
    if (!state.data) return;
    clearError();
    var req = [];
    colsBox.querySelectorAll('input[name=req]:checked').forEach(function (cb) { req.push(Number(cb.value)); });
    var idCol = idSel.value === '' ? null : Number(idSel.value);
    state.report = C.inspect(state.data, { requiredCols: req, idCol: idCol });
    state.findPage = 0; state.prevPage = 0;
    renderSummary(req, idCol);
    renderFindings();
    renderPreview();
    saveNote.textContent = '';
    dlFind.disabled = false;
    result.hidden = false;
    $('result-title').focus();
  });

  function renderSummary(req, idCol) {
    clearChildren(summary);
    var rp = state.report;
    var items = [
      ['データ行', rp.counts.rows.toLocaleString() + ' 行'],
      ['完全一致の重複', rp.dupGroups + ' 組（除去できる行 ' + rp.dupRemovable + '）'],
      ['必須列の点検', req.length ? req.map(function (i) { return state.data.header[i]; }).join('、') : '指定なし'],
      ['ID重複（内容が異なる）', idCol === null ? '指定なし' : rp.idGroups + ' 組' + (rp.emptyIds ? '（ID列が空欄の行 ' + rp.emptyIds + ' は対象外）' : '')],
      ['数式として解釈され得るセル', rp.formulaCells + ' 個'],
      ['指摘の合計', rp.counts.findings.toLocaleString() + ' 件' + (rp.omitted ? '（一覧には先頭 ' + rp.findings.length.toLocaleString() + ' 件だけ表示）' : '')]
    ];
    items.forEach(function (it) {
      var dt = document.createElement('dt'); dt.textContent = it[0];
      var dd = document.createElement('dd'); dd.textContent = it[1];
      summary.appendChild(dt); summary.appendChild(dd);
    });
    var ok = document.createElement('p');
    ok.className = rp.counts.findings === 0 ? 'ok' : 'ng';
    var condText = '必須列：' + (req.length ? req.map(function (i) { return state.data.header[i]; }).join('、') : '指定なし') + '／ID列：' + (idCol === null ? '指定なし' : state.data.header[idCol]);
    ok.textContent = rp.counts.findings === 0
      ? '選択した条件（' + condText + '）と、全列完全一致の重複・数式セルの点検では指摘はありません。点検していない列の空欄は対象外です。'
      : '確認が必要な行があります。下の一覧を確認してください。';
    summary.appendChild(ok);
    dedupBtn.disabled = rp.dupRemovable === 0;
    dedupNote.textContent = rp.dupRemovable === 0
      ? '全列が完全に一致する重複はないため、重複除去CSVは作りません。'
      : '全列が完全に一致する ' + rp.dupRemovable + ' 行だけを除いたCSVを作ります（先に出てくる行を残します）。IDだけ同じで内容が異なる行は削除しません。元ファイルは変更されません。';
  }

  function pager(container, total, page, onChange) {
    clearChildren(container);
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (pages <= 1) return;
    var info = document.createElement('span');
    info.textContent = (page + 1) + ' / ' + pages + ' ページ（' + PAGE + '行ずつ）';
    var prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '前へ'; prev.disabled = page === 0;
    var next = document.createElement('button'); next.type = 'button'; next.textContent = '次へ'; next.disabled = page >= pages - 1;
    prev.addEventListener('click', function () { onChange(page - 1); });
    next.addEventListener('click', function () { onChange(page + 1); });
    container.appendChild(prev); container.appendChild(info); container.appendChild(next);
  }

  function renderFindings() {
    clearChildren(findTable);
    var f = state.report.findings;
    var start = state.findPage * PAGE;
    f.slice(start, start + PAGE).forEach(function (x) {
      var tr = document.createElement('tr');
      [String(x.line), x.kind, x.col, x.detail].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      findTable.appendChild(tr);
    });
    if (f.length === 0) {
      var tr0 = document.createElement('tr'); var td0 = document.createElement('td');
      td0.colSpan = 4; td0.textContent = '選択した条件では指摘はありません。'; tr0.appendChild(td0); findTable.appendChild(tr0);
    }
    pager(findPager, f.length, state.findPage, function (p) { state.findPage = p; renderFindings(); });
  }

  function renderPreview() {
    clearChildren(prevTable);
    var d = state.data;
    var flagged = Object.create(null);
    state.report.findings.forEach(function (x) { flagged[x.row] = true; });
    var thead = document.createElement('thead'); var hr = document.createElement('tr');
    var th0 = document.createElement('th'); th0.scope = 'col'; th0.textContent = '行'; hr.appendChild(th0);
    d.header.forEach(function (h) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; hr.appendChild(th); });
    thead.appendChild(hr); prevTable.appendChild(thead);
    var tbody = document.createElement('tbody');
    var start = state.prevPage * PAGE;
    for (var r = start; r < Math.min(d.rows.length, start + PAGE); r++) {
      var tr = document.createElement('tr');
      if (flagged[r]) tr.className = 'flag';
      var tdn = document.createElement('td'); tdn.textContent = String(d.lineOf[r]); tr.appendChild(tdn);
      d.rows[r].forEach(function (c) { var td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
      tbody.appendChild(tr);
    }
    prevTable.appendChild(tbody);
    pager(prevPager, d.rows.length, state.prevPage, function (p) { state.prevPage = p; renderPreview(); });
  }

  /* ---- 保存 ---- */
  function download(text, name) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
  function protectedMsg(n) {
    return n === 0 ? '数式として解釈され得るセル（先頭が = + - @ や改行・タブ、全角の ＝ ＋ － ＠）はありませんでした。'
      : '数式として解釈され得るセル ' + n.toLocaleString() + ' 個の先頭に「\'」を付けて保存しました（値が変わるのはこの ' + n.toLocaleString() + ' 個だけ。元ファイルは変更していません。表計算ソフト側の設定や再保存後まで含めた完全な防止は保証できません）。';
  }

  dlFind.addEventListener('click', function () {
    if (!state.report) return;
    var out = C.toCsv(['行番号', '種別', '列', '内容'], C.findingsToRows(state.report.findings));
    download(out.text, C.safeName(state.name) + '_点検一覧.csv');
    saveNote.textContent = '点検一覧CSVを保存しました（UTF-8 BOM付き・CRLF）。' + protectedMsg(out.protectedCount);
  });

  dedupBtn.addEventListener('click', function () {
    if (!state.report || state.report.dupRemovable === 0) return;
    var rows = C.dedupRows(state.data.rows, state.report.removableRows);
    var out = C.toCsv(state.data.header, rows);
    download(out.text, C.safeName(state.name) + '_重複除去.csv');
    saveNote.textContent = '重複除去CSVを保存しました：' + state.data.rows.length.toLocaleString() + ' 行 → ' + rows.length.toLocaleString() + ' 行（UTF-8 BOM付き・CRLF）。' + protectedMsg(out.protectedCount);
  });

  resetAll();
  setStatus('CSVファイルを選ぶか、架空サンプルを読み込んでください。');
})();
