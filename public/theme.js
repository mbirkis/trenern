/* Apply before styles load so a saved light theme never flashes dark. */
(() => {
  'use strict';
  const key = 'trenern.theme';
  const themes = {
    graphite: { name: 'Grafitt', description: 'Rent og minimalistisk', bg: '#000000', panel: '#242424', accent: '#0072f5', chrome: '#0a0a0a' },
    midnight: { name: 'Midnatt', description: 'Dyp blå med fiolette toner', bg: '#0d1020', panel: '#252b45', accent: '#b5a1ff', chrome: '#14182b' },
    porcelain: { name: 'Porselen', description: 'Lyst, luftig og presist', bg: '#edf2f8', panel: '#ffffff', accent: '#5145cd', chrome: '#ffffff' },
    sand: { name: 'Sand', description: 'Varme flater og skoggrønt', bg: '#eeeae2', panel: '#fcfaf5', accent: '#27664f', chrome: '#fcfaf5' },
  };
  const valid = id => Object.hasOwn(themes, id) ? id : 'graphite';
  let current = 'graphite';
  try { current = valid(localStorage.getItem(key)); } catch (_) { /* Private browsing. */ }
  function apply(id, save = false) {
    current = valid(id);
    document.documentElement.dataset.theme = current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themes[current].chrome);
    document.querySelectorAll('[data-theme-picker] input').forEach(input => { input.checked = input.value === current; });
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = current; });
    if (save) {
      let saved = true;
      try { localStorage.setItem(key, current); } catch (_) { saved = false; }
      document.querySelectorAll('[data-theme-status]').forEach(el => {
        el.textContent = `${themes[current].name} er valgt.${saved ? '' : ' Nettleseren kunne ikke lagre valget.'}`;
      });
    }
  }
  apply(current);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-picker]').forEach(picker => {
      picker.innerHTML = Object.entries(themes).map(([id, theme]) => `
        <label class="theme-choice">
          <input type="radio" name="theme" value="${id}" />
          <span class="theme-card">
            <span class="theme-preview" aria-hidden="true" style="--preview-bg:${theme.bg};--preview-panel:${theme.panel};--preview-accent:${theme.accent}"></span>
            <strong>${theme.name}</strong><small>${theme.description}</small>
          </span>
        </label>`).join('');
      picker.addEventListener('change', event => { if (event.target.matches('input[name="theme"]')) apply(event.target.value, true); });
    });
    document.querySelectorAll('[data-theme-select]').forEach(select => {
      select.innerHTML = Object.entries(themes).map(([id, theme]) => `<option value="${id}">${theme.name}</option>`).join('');
      select.addEventListener('change', () => apply(select.value, true));
    });
    apply(current);
  });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(event.newValue); });
})();
