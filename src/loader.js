/* loader.js - lecture de fichiers (navigateur uniquement): showDirectoryPicker, <input webkitdirectory>, drag&drop.
   Retourne toujours [{name, text}] pour les fichiers .json. */
(function (root) {
  'use strict';
  const isJson = (n) => { const s = root.WFV && root.WFV.scripts; return s ? !!s.classifyFile(n) : /\.json$/i.test(n); }; // .json, .ps1, customaction*.raw.txt, .csv

  async function readAll(files, onProgress) { // files: [{name, file}]
    const out = []; let done = 0;
    for (let i = 0; i < files.length; i += 25) {
      const batch = files.slice(i, i + 25);
      const dec = new TextDecoder('utf-8', { ignoreBOM: true }); // ignoreBOM: conserve le BOM (export fidèle)
      const texts = await Promise.all(batch.map((f) => f.file.arrayBuffer().then((b) => dec.decode(b)).catch((e) => { return { __err: String(e) }; })));
      batch.forEach((f, k) => { out.push(typeof texts[k] === 'string' ? { name: f.name, text: texts[k] } : { name: f.name, text: '', readError: texts[k].__err }); });
      done += batch.length; if (onProgress) onProgress(done, files.length);
    }
    return out;
  }

  async function walkHandle(dir, prefix, acc) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file') { if (isJson(name)) acc.push({ name: prefix + name, file: await h.getFile() }); }
      else if (h.kind === 'directory') await walkHandle(h, prefix + name + '/', acc);
    }
    return acc;
  }

  async function pickDirectory(onProgress) {
    const dir = await root.showDirectoryPicker({ mode: 'read' });
    return readAll(await walkHandle(dir, '', []), onProgress);
  }

  function fromFileList(list, onProgress) {
    const files = Array.from(list).filter((f) => isJson(f.name)).map((f) => ({ name: f.webkitRelativePath || f.name, file: f }));
    return readAll(files, onProgress);
  }

  function entryFile(entry) { return new Promise((res, rej) => entry.file(res, rej)); }
  function readDirEntries(reader) {
    return new Promise((res, rej) => { const all = []; (function next() { reader.readEntries((r) => { if (!r.length) res(all); else { all.push(...r); next(); } }, rej); })(); });
  }
  async function walkEntry(entry, prefix, acc) {
    if (entry.isFile) { if (isJson(entry.name)) acc.push({ name: prefix + entry.name, file: await entryFile(entry) }); }
    else if (entry.isDirectory) { for (const c of await readDirEntries(entry.createReader())) await walkEntry(c, prefix + entry.name + '/', acc); }
  }

  async function fromDataTransfer(dt, onProgress) {
    const entries = [];
    if (dt.items) for (const it of Array.from(dt.items)) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) entries.push(e); } // synchrone obligatoire
    if (!entries.length) return fromFileList(dt.files, onProgress);
    const acc = []; for (const e of entries) await walkEntry(e, '', acc);
    return readAll(acc, onProgress);
  }

  root.WFV = root.WFV || {};
  root.WFV.loader = { pickDirectory: pickDirectory, fromFileList: fromFileList, fromDataTransfer: fromDataTransfer, hasDirectoryPicker: typeof root.showDirectoryPicker === 'function' };
})(typeof self !== 'undefined' ? self : globalThis);
