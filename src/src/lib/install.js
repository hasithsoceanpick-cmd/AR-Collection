// "Install app": Chrome and Edge fire `beforeinstallprompt` when the app can be
// installed. It can fire before any screen is shown, so it is caught here at start-up.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function startInstallWatch() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}
export const canInstall = () => Boolean(deferred) && !isInstalled();
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; notify();
  return outcome === 'accepted';
}

// Which instructions to show when the browser can't install directly.
export function browserKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  if (/Android/.test(ua)) return 'android';
  return 'chrome';
}
