/**
 * Hash router: #club | #story
 * #lab redirects to #club (no private mix).
 */

const ROUTES = new Set(['club', 'story']);

export function currentRoute() {
  const h = (location.hash || '#club').replace(/^#/, '').split('?')[0].toLowerCase();
  if (!h || h === '/' || h === 'lab') return 'club';
  return ROUTES.has(h) ? h : 'club';
}

/**
 * @param {(route: string) => void} onChange
 */
export function mountRouter(onChange) {
  const apply = () => {
    const raw = (location.hash || '').replace(/^#/, '').split('?')[0].toLowerCase();
    if (!location.hash || location.hash === '#' || raw === 'lab') {
      history.replaceState(null, '', '#club');
    }
    const route = currentRoute();
    document.body.dataset.route = route;
    document.querySelectorAll('[data-route-view]').forEach((el) => {
      const name = el.getAttribute('data-route-view');
      const match = name === route;
      el.hidden = !match;
      el.classList.toggle('route-active', match);
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-nav') === route);
    });
    onChange(route);
  };
  window.addEventListener('hashchange', apply);
  apply();
  return { apply, currentRoute };
}

export function navigate(route) {
  const r = route === 'story' ? 'story' : 'club';
  location.hash = r;
}
