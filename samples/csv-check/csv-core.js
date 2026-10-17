/* CSV点検ツール コア処理 v0.1（Torrant5 自主制作）
   ブラウザ内だけで動く。通信・保存はしない。
   方針：不正な形式や文字コード不一致は黙って直さず、理由と位置を返す。 */
(function (root) {
  'use strict';

  var LIMITS = {
    maxBytes: 20 * 1024 * 1024,   // 20MB
    maxRows: 200000,              // ヘッダーを除く行数（解析途中で判定）
    maxCols: 500,                 // 列数
    maxCells: 2000000,            // 行数×列数（解析途中で判定）
    maxFindings: 100000           // 指摘件数（超えた分は数だけ数える）
  };

  /* ---------- 文字コード ---------- */
  // 返り値: { text, encodingUsed, hadBom } または { error }
  function decodeBytes(bytes, encodingChoice) {
    var hadBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    var enc = encodingChoice;
    if (enc === 'auto') enc = hadBom ? 'utf-8' : 'utf-8';
    if (hadBom && enc !== 'utf-8') {
      return { error: 'UTF-8のBOMが付いていますが、文字コードに ' + labelOf(enc) + ' が選ばれています。UTF-8を選び直してください。' };
    }
    var dec;
    try {
      dec = new TextDecoder(enc, { fatal: true, ignoreBOM: false });
    } catch (e) {
      return { error: 'このブラウザは ' + labelOf(enc) + ' の読み取りに対応していません。' };
    }
    try {
      var text = dec.decode(bytes);
      return { text: text, encodingUsed: enc, hadBom: hadBom };
    } catch (e) {
      return { error: '文字コードが ' + labelOf(enc) + ' として読めませんでした（不正なバイト列）。別の文字コードを選ぶか、保存元で文字コードを確認してください。自動で修復はしません。' };
    }
  }

  function labelOf(enc) {
    return enc === 'shift_jis' ? 'Shift_JIS' : 'UTF-8';
  }

  /* ---------- 解析（RFC 4180 準拠・厳格） ----------
     返り値: { header:[], rows:[[]], lineOf:[行番号] } または { error, line }
     行番号はファイル先頭を1行目とした「そのレコードが始まる物理行」。 */
  function parse(text, opts) {
    opts = opts || {};
    var maxRows = opts.maxRows || LIMITS.maxRows;
    var maxCols = opts.maxCols || LIMITS.maxCols;
    var maxCells = opts.maxCells || LIMITS.maxCells;
    var records = [];
    var quotedRec = [];   // そのレコードに引用符付きセルがあったか（空行との区別用）
    var recordQuoted = false;
    var limitError = null;
    var lineStarts = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var i = 0, n = text.length;
    var line = 1;
    var recordStartLine = 1;
    var fieldStartedQuoted = false;
    var afterClosingQuote = false;

    function endField() {
      record.push(field);
      if (fieldStartedQuoted) recordQuoted = true;
      field = '';
      fieldStartedQuoted = false;
      afterClosingQuote = false;
      if (record.length > maxCols) {
        limitError = { error: recordStartLine + '行目の列数が上限の ' + maxCols.toLocaleString() + ' 列を超えました。', line: recordStartLine };
      }
    }
    function endRecord() {
      endField();
      records.push(record);
      quotedRec.push(recordQuoted);
      lineStarts.push(recordStartLine);
      // 解析途中で行数・セル数の上限を判定（全件を貯めてから数えない）
      if (!limitError && records.length - 1 > maxRows) {
        limitError = { error: 'データ行が上限の ' + maxRows.toLocaleString() + ' 行を超えました。上限は本ツールの安全のための制限です。', line: recordStartLine };
      }
      if (!limitError && records.length > 1 && (records.length - 1) * records[0].length > maxCells) {
        limitError = { error: 'セル数（行数×列数）が上限の ' + maxCells.toLocaleString() + ' を超えました。上限は本ツールの安全のための制限です。', line: recordStartLine };
      }
      record = [];
      recordQuoted = false;
      recordStartLine = line;
    }

    while (i < n && !limitError) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < n && text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; afterClosingQuote = true; i++; continue;
        }
        if (ch === '\n') line++;
        else if (ch === '\r') { line++; if (i + 1 < n && text[i + 1] === '\n') { field += '\r'; i++; ch = '\n'; } }
        field += ch; i++; continue;
      }
      // 引用符の外
      if (ch === '"') {
        if (field.length === 0 && !afterClosingQuote) { inQuotes = true; fieldStartedQuoted = true; i++; continue; }
        return { error: '引用符（"）の使い方が不正です。セル全体を引用符で囲むか、セル内の引用符は "" と二重にしてください。', line: line };
      }
      if (afterClosingQuote && ch !== ',' && ch !== '\n' && ch !== '\r') {
        return { error: '閉じ引用符の後に余分な文字があります。', line: line };
      }
      if (ch === ',') { endField(); i++; continue; }
      if (ch === '\r') {
        if (i + 1 < n && text[i + 1] === '\n') i++;
        i++; line++; endRecord(); continue;
      }
      if (ch === '\n') { i++; line++; endRecord(); continue; }
      field += ch; i++;
    }
    if (limitError) return limitError;
    if (inQuotes) {
      return { error: '引用符（"）が閉じられていません。', line: recordStartLine };
    }
    // 末尾に改行がない最後のレコード（末尾の通常の改行1つは追加レコードにしない）
    if (field.length > 0 || record.length > 0 || afterClosingQuote) {
      endRecord();
      if (limitError) return limitError;
    }

    // 空ファイル
    if (records.length === 0) return { error: 'ファイルが空です。', line: null };

    var header = records[0];
    if (header.length === 1 && header[0] === '' && !quotedRec[0]) return { error: 'ヘッダー行が空です。', line: 1 };
    // ヘッダー検査：空欄・重複（__proto__ 等の名前も通常名と同じく扱うため Map を使う）
    var seen = new Map();
    for (var h = 0; h < header.length; h++) {
      var name = header[h];
      if (name === '') return { error: (h + 1) + '列目の列名が空欄です。列名は全列に必要です。', line: lineStarts[0] };
      if (seen.has(name)) {
        return { error: '列名「' + name + '」が重複しています（' + (seen.get(name) + 1) + '列目と' + (h + 1) + '列目）。', line: lineStarts[0] };
      }
      seen.set(name, h);
    }

    var rows = [];
    var lineOf = [];
    for (var r = 1; r < records.length; r++) {
      var rec = records[r];
      // 空行（引用符なしの1セル空文字）は黙って捨てない。
      // 1列のCSVでは正当な空欄データとして残し、複数列のCSVでは形式エラーにする。
      if (rec.length === 1 && rec[0] === '' && !quotedRec[r] && header.length > 1) {
        return { error: lineStarts[r] + '行目が空行です。空行は自動で削除しません。保存元で空行を取り除いてください。', line: lineStarts[r] };
      }
      if (rec.length !== header.length) {
        return { error: lineStarts[r] + '行目の列数が' + rec.length + 'で、ヘッダーの' + header.length + '列と一致しません。自動で補完・切り捨てはしません。', line: lineStarts[r] };
      }
      rows.push(rec);
      lineOf.push(lineStarts[r]);
    }
    return { header: header, rows: rows, lineOf: lineOf };
  }

  /* ---------- 点検 ----------
     opts: { requiredCols:[index...], idCol: index|null }
     返り値: { findings:[{line,row,kind,col,detail}], dupGroups, dupRemovable, idGroups, counts } */
  function inspect(data, opts) {
    opts = opts || {};
    var header = data.header, rows = data.rows, lineOf = data.lineOf;
    var required = opts.requiredCols || [];
    var idCol = (typeof opts.idCol === 'number') ? opts.idCol : null;
    var maxFindings = opts.maxFindings || LIMITS.maxFindings;
    var findings = [];
    var omitted = 0; // 上限を超えて一覧に載せなかった指摘の数
    function add(f) { if (findings.length < maxFindings) findings.push(f); else omitted++; }

    // 1) 全列完全一致の重複（trim・大文字小文字の同一視はしない）
    var map = Object.create(null);
    var dupGroups = 0, dupRemovable = 0;
    var removable = []; // 2件目以降のrow index
    for (var r = 0; r < rows.length; r++) {
      var key = JSON.stringify(rows[r]);
      if (map[key] === undefined) { map[key] = [r]; }
      else { map[key].push(r); }
    }
    Object.keys(map).forEach(function (k) {
      var idx = map[k];
      if (idx.length > 1) {
        dupGroups++;
        for (var j = 1; j < idx.length; j++) {
          dupRemovable++;
          removable.push(idx[j]);
          add({ row: idx[j], line: lineOf[idx[j]], kind: '完全一致の重複', col: '（全列）', detail: lineOf[idx[0]] + '行目と全列が同じ' });
        }
      }
    });

    // 2) 必須列の空欄（空文字だけ。空白のみのセルは「空白のみ」として別表示し、自動で同一視しない）
    required.forEach(function (c) {
      for (var r2 = 0; r2 < rows.length; r2++) {
        var v = rows[r2][c];
        if (v === '') add({ row: r2, line: lineOf[r2], kind: '必須列が空欄', col: header[c], detail: '' });
        else if (/^\s+$/.test(v)) add({ row: r2, line: lineOf[r2], kind: '必須列が空白のみ', col: header[c], detail: '空白文字 ' + v.length + ' 文字（空欄とは区別）' });
      }
    });

    // 3) ID重複（内容が異なる行）。完全一致の重複は上で数えたので除く。
    //    空文字のIDは「欠落」であって重複ではないので、ID重複から除外し「ID列が空欄」として別種別で出す
    //    （空白だけのIDは空欄と区別し、同じ文字列同士なら重複として扱う。trimや書き換えはしない）。
    var idGroups = 0, emptyIds = 0;
    if (idCol !== null) {
      var idMap = Object.create(null);
      for (var r3 = 0; r3 < rows.length; r3++) {
        var id = rows[r3][idCol];
        if (id === '') {
          emptyIds++;
          add({ row: r3, line: lineOf[r3], kind: 'ID列が空欄', col: header[idCol], detail: '重複判定の対象外。IDを入力してから再点検' });
          continue;
        }
        if (idMap[id] === undefined) idMap[id] = [r3]; else idMap[id].push(r3);
      }
      Object.keys(idMap).forEach(function (id) {
        var idx = idMap[id];
        if (idx.length < 2) return;
        // 内容が異なる組だけ
        var distinct = {};
        idx.forEach(function (ri) { distinct[JSON.stringify(rows[ri])] = true; });
        if (Object.keys(distinct).length < 2) return;
        idGroups++;
        // 相手行（物理行番号）は先頭5行だけ列挙し、残りは件数で示す。
        // グループ全件の配列を行ごとに作らず、先頭6候補から自分を除いた最大5件を取る（同一ID多数行でも行あたり定数時間）。
        var head = idx.slice(0, 6);
        idx.forEach(function (ri) {
          var others = [];
          for (var h = 0; h < head.length && others.length < 5; h++) {
            if (head[h] !== ri) others.push(lineOf[head[h]] + '行目');
          }
          var rest = idx.length - 1 - others.length;
          var shown = others.join('・') + (rest > 0 ? '・他' + rest + '行' : '');
          add({ row: ri, line: lineOf[ri], kind: 'ID重複（内容が異なる）', col: header[idCol], detail: 'ID「' + id + '」が' + idx.length + '行（相手：' + shown + '）。削除せず確認が必要' });
        });
      });
    }

    // 4) 表計算で数式として解釈され得るセル（保存時に保護する対象を事前に知らせる）
    var formulaCells = 0;
    for (var r4 = 0; r4 < rows.length; r4++) {
      for (var c4 = 0; c4 < header.length; c4++) {
        if (protectCell(rows[r4][c4]).changed) {
          formulaCells++;
          add({ row: r4, line: lineOf[r4], kind: '数式として解釈され得るセル', col: header[c4], detail: '先頭が' + charLabel(rows[r4][c4][0]) + '。保存時は先頭に \' を付けて保護（表計算側の設定によっては完全には防げません）' });
        }
      }
    }

    findings.sort(function (a, b) { return a.line - b.line; });
    return {
      findings: findings,
      dupGroups: dupGroups,
      dupRemovable: dupRemovable,
      removableRows: removable,
      idGroups: idGroups,
      emptyIds: emptyIds,
      formulaCells: formulaCells,
      omitted: omitted,
      counts: { rows: rows.length, findings: findings.length + omitted }
    };
  }

  /* ---------- 書き出し ---------- */
  // 数式注入対策（OWASP CSV Injection の対象文字に準拠）：
  //   先頭が = @ タブ CR LF、全角の ＝ ＋ － ＠、または半角 + - で数値表記でないセルは先頭に ' を付ける。
  //   表計算ソフトや再保存後の挙動まで含めた完全な防止は保証できない。
  var DANGER = { '=': 1, '@': 1, '\t': 1, '\r': 1, '\n': 1, '\uFF1D': 1, '\uFF0B': 1, '\uFF0D': 1, '\uFF20': 1 };
  function protectCell(v) {
    if (v.length === 0) return { v: v, changed: false };
    var c = v[0];
    if (DANGER[c] === 1) return { v: "'" + v, changed: true };
    if ((c === '+' || c === '-') && !/^[+-]?\d+([.,]\d+)?$/.test(v)) return { v: "'" + v, changed: true };
    return { v: v, changed: false };
  }
  function charLabel(c) {
    if (c === '\t') return 'タブ';
    if (c === '\r') return '改行（CR）';
    if (c === '\n') return '改行（LF）';
    return '「' + c + '」';
  }
  function quote(v) {
    if (/[",\r\n]/.test(v) || /^\s|\s$/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  // 返り値 { text, protectedCount }
  function toCsv(header, rows) {
    var protectedCount = 0;
    var lines = [];
    lines.push(header.map(function (h) { var p = protectCell(h); if (p.changed) protectedCount++; return quote(p.v); }).join(','));
    for (var r = 0; r < rows.length; r++) {
      lines.push(rows[r].map(function (c) { var p = protectCell(c); if (p.changed) protectedCount++; return quote(p.v); }).join(','));
    }
    return { text: '﻿' + lines.join('\r\n') + '\r\n', protectedCount: protectedCount };
  }

  function findingsToRows(findings) {
    return findings.map(function (f) { return [String(f.line), f.kind, f.col, f.detail]; });
  }

  function dedupRows(rows, removableRows) {
    var skip = Object.create(null);
    removableRows.forEach(function (i) { skip[i] = true; });
    var out = [];
    for (var r = 0; r < rows.length; r++) if (!skip[r]) out.push(rows[r]);
    return out;
  }

  // ダウンロード名：元ファイル名から拡張子を除き、危険な文字を置換
  function safeName(name) {
    var base = String(name || 'data').replace(/\.[^.]*$/, '');
    base = base.replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80);
    return base || 'data';
  }

  root.CsvCheck = {
    LIMITS: LIMITS,
    decodeBytes: decodeBytes,
    parse: parse,
    inspect: inspect,
    toCsv: toCsv,
    findingsToRows: findingsToRows,
    dedupRows: dedupRows,
    protectCell: protectCell,
    charLabel: charLabel,
    safeName: safeName
  };
})(typeof window !== 'undefined' ? window : this);
