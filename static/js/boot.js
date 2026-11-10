// Set the saved theme before the first paint (the CSP allows no inline scripts).
try {
  // one-time move of data saved under the app's first name
  if (!localStorage.getItem('capkey.moved')) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('earmark.')) localStorage.setItem('capkey.' + k.slice(8), localStorage.getItem(k));
    }
    localStorage.setItem('capkey.moved', '1');
  }
  const t = JSON.parse(localStorage.getItem('capkey.settings') || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage blocked */ }
