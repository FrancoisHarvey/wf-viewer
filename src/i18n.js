/* i18n.js - internationalisation (fr / en), pur et testable sous node. Dictionnaires embarqués: src/i18n-fr.js et src/i18n-en.js (scripts classiques, pas de fetch).
   API: t(key, vars) ({nom} interpolé; entrée {one, other} = pluriel selon vars.n; clé absente -> renvoie la clé, jamais d'exception);
   getLang()/setLang('fr'|'en') (setLang appelle les abonnés onChange(fn) si la langue change); detectLang(navigator.languages) -> 'fr' si le premier commence par fr, sinon 'en';
   resolve(hash, stored, languages); formatDate/formatNumber/compare selon la langue; has(key, lang); register(lang, entries). */
(function (root) {
  'use strict';
  var dict = { fr: {}, en: {} }, lang = 'fr', listeners = [];
  var LOCALES = { fr: 'fr-CA', en: 'en-US' };

  function register(l, entries) { dict[l] = dict[l] || {}; Object.keys(entries).forEach(function (k) { dict[l][k] = entries[k]; }); }
  // Catégorie de pluriel: fr: 0 et 1 -> one; en: 1 -> one.
  function pluralCategory(l, n) { n = Math.abs(Number(n)); return l === 'fr' ? (n < 2 ? 'one' : 'other') : (n === 1 ? 'one' : 'other'); }
  function format(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (all, k) { return vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : all; });
  }
  function t(key, vars) {
    try {
      var e = dict[lang] && dict[lang][key];
      if (e === undefined) return key;
      if (e !== null && typeof e === 'object') e = e[pluralCategory(lang, vars && vars.n)] || e.other || e.one || key;
      return format(e, vars);
    } catch (err) { return key; }
  }
  // setLang: ignore une langue inconnue; si la langue change, appelle les abonnés (re-rendu de l'interface en phase B).
  function setLang(l) {
    if ((l === 'fr' || l === 'en') && l !== lang) { lang = l; listeners.slice().forEach(function (fn) { try { fn(lang); } catch (e) { /* un abonné défaillant ne bloque pas les autres */ } }); }
    return lang;
  }
  // onChange(fn): fn(lang) à chaque changement de langue; retourne une fonction de désabonnement.
  function onChange(fn) { if (typeof fn !== 'function') return function () {}; listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function getLang() { return lang; }
  function has(key, l) { return Object.prototype.hasOwnProperty.call(dict[l || lang] || {}, key); }

  // Langue d'après navigator.languages: fr si la première langue préférée commence par « fr », sinon en.
  function detect(languages) {
    var first = Array.isArray(languages) && languages.length ? languages[0] : (typeof languages === 'string' ? languages : '');
    return /^fr/i.test(String(first || '')) ? 'fr' : 'en';
  }
  // Priorité: hash (lang=fr|en) > valeur stockée > navigateur.
  function resolve(hash, stored, languages) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, '')), h = p.get('lang');
    if (h === 'fr' || h === 'en') return h; if (stored === 'fr' || stored === 'en') return stored; return detect(languages);
  }
  function hashHasLang(hash) { var h = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('lang'); return h === 'fr' || h === 'en'; }
  function withLangHash(hash, l) { var p = new URLSearchParams(String(hash || '').replace(/^#/, '')); p.set('lang', l); return '#' + p.toString(); }

  // Formats selon la langue (Intl). Date ISO -> texte; fr conserve le format compact AAAA-MM-JJ HH:MM.
  function formatDate(s) {
    if (!s) return '—';
    if (lang === 'fr') return String(s).slice(0, 16).replace('T', ' ');
    var d = new Date(s); if (isNaN(d.getTime())) return String(s).slice(0, 16).replace('T', ' ');
    try { return new Intl.DateTimeFormat(LOCALES.en, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d); } catch (e) { return String(s).slice(0, 16).replace('T', ' '); }
  }
  function formatNumber(n) { try { return new Intl.NumberFormat(LOCALES[lang]).format(n); } catch (e) { return String(n); } }
  function compare(a, b) { return String(a).localeCompare(String(b), LOCALES[lang], { numeric: true, sensitivity: 'base' }); }

  var api = { t: t, onChange: onChange, detectLang: detect, register: register, setLang: setLang, getLang: getLang, has: has, detect: detect, resolve: resolve, hashHasLang: hashHasLang, withLangHash: withLangHash, pluralCategory: pluralCategory,
    formatDate: formatDate, formatNumber: formatNumber, compare: compare, dict: dict, LOCALES: LOCALES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; require('./i18n-fr.js'); require('./i18n-en.js'); }
  else { root.WFV = root.WFV || {}; root.WFV.i18n = api; }
})(typeof self !== 'undefined' ? self : globalThis);
