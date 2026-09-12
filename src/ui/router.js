/**
 * Hash router: #club | #story | #lab
 * Hash routing avoids host redirects for static deploys.
 * When lab is disabled (production shared live), #lab redirects to #club.
 */

const ROUTES = new Set(['club', 'story', 'lab']);

/** @type {boolean} */
let labEnabled = true;

export function setLabEnabled(on) {
  labEnabled = !!on;
  document.body.classList.toggle('lab-disabled', !labEnabled);
  document.querySelectorAll('[data-nav="lab"], [data-lab-only]').forEach((el) => {
    el.hidden = !labEnabled;
    if (!labEnabled) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  });
  // Hide lab view section
  const labView = document.querySelector('[data-route-view="lab"]');
  if (labView && !labEnabled) {
    labView.hidden = true;
  }
  if (!labEnabled && currentRoute() === 'lab') {
    navigate('club');
  }
}

export function isLabEnabled() {
  return labEnabled;
}

export function currentRoute() {
  const h = (location.hash || '#club').replace(/^#/, '').split('?')[0].toLowerCase();
  if (!h || h === '/') return 'club';
  if (h === 'lab' && !labEnabled) return 'club';
  return ROUTES.has(h) ? h : 'club';
}

/**
 * @param {(route: string) => void} onChange
 */
export function mountRouter(onChange) {
  const apply = () => {
    if (!labEnabled && (location.hash || '').replace(/^#/, '').split('?')[0].toLowerCase() === 'lab') {
      history.replaceState(null, '', '#club');
    }
    const route = currentRoute();
    document.body.dataset.route = route;
    document.querySelectorAll('[data-route-view]').forEach((el) => {
      const name = el.getAttribute('data-route-view');
      const match = name === route && (name !== 'lab' || labEnabled);
      el.hidden = !match;
      el.classList.toggle('route-active', match);
    });
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const nav = el.getAttribute('data-nav');
      if (nav === 'lab' && !labEnabled) {
        el.hidden = true;
        el.classList.remove('active');
        return;
      }
      el.classList.toggle('active', nav === route);
    });
    onChange(route);
  };
  window.addEventListener('hashchange', apply);
  if (!location.hash || location.hash === '#' || (!labEnabled && location.hash === '#lab')) {
    history.replaceState(null, '', '#club');
  }
  apply();
  return { apply, currentRoute };
}

export function navigate(route) {
  let r = ROUTES.has(route) ? route : 'club';
  if (r === 'lab' && !labEnabled) r = 'club';
  location.hash = r;
}
