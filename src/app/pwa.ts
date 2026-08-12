/**
 * Service-worker registration.
 *
 * The service worker is what makes Paperbox usable with no network at all: it
 * precaches the app shell plus pdf.js's fonts, CMaps and wasm decoders.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
