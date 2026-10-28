// A small Vite app: static and imported assets, CSS, a history-API router,
// a same-origin API call and an HMR-accepted module.
import './style.css';
import logoUrl from './logo.svg';
import { message } from './message.js';

const routes = { '/': 'Home', '/about': 'About' };
const app = document.querySelector('#app');
app.innerHTML =
  '<img id="logo" alt="" width="48" height="48"><h1 id="route"></h1><p id="message"></p><pre id="api"></pre>';
document.querySelector('#logo').src = logoUrl;
document.querySelector('#message').textContent = message;

window.fixture = {
  loadedAt: performance.timeOrigin,
  route: '',
  ready: false,
  hmrUpdates: 0,
};

function render() {
  document.querySelector('#route').textContent =
    routes[location.pathname] ?? 'Not found';
  window.fixture.route = location.pathname;
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link) return;
  event.preventDefault();
  history.pushState({}, '', link.getAttribute('href'));
  render();
});
window.addEventListener('popstate', render);
render();

const response = await fetch('/api/hello');
document.querySelector('#api').textContent = JSON.stringify(
  await response.json()
);
window.fixture.readyAt = Date.now();
window.fixture.ready = true;

if (import.meta.hot)
  import.meta.hot.accept('./message.js', (module) => {
    document.querySelector('#message').textContent = module.message;
    window.fixture.hmrUpdates += 1;
  });
