// Live updates: the deploy writes version.json (commit + file list). A running game checks it
// every couple of minutes; when a new version is live it saves the city, refreshes the cached
// files and reloads, so an open game picks up changes by itself. Silent when version.json is
// missing (running locally).

const CHECK_MS = 2 * 60 * 1000;

export function startUpdater(game, { onBeforeReload }) {
  let current = null, busy = false;
  const read = async () => {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('no version file');
    return r.json();
  };
  const check = async () => {
    if (busy) return;
    try {
      const v = await read();
      if (!current) { current = v.sha; return; }
      if (v.sha === current) return;
      busy = true;
      // Wait for a quiet moment: not mid-drag and no dialog open.
      while (game.input?.drag || !document.getElementById('modal').hidden) await new Promise((r) => setTimeout(r, 1000));
      game.ui.toast('A new version of Gridline is live: saving your city and updating…', 'good', 4000);
      onBeforeReload();
      // Refresh every file in the browser cache first, so the reload can't mix old and new code.
      await Promise.all((v.files ?? []).map((f) => fetch(f, { cache: 'reload' }).catch(() => {})));
      setTimeout(() => location.reload(), 1500);
    } catch {
      /* offline or running locally: try again later */
    }
  };
  check();
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
