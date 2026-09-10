(() => {
  const configuredBaseUrl = String(window.ZELACITY_RUNTIME_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());

  if (isNativeApp) document.documentElement.classList.add('native-app');

  function apiUrl(path) {
    if (!configuredBaseUrl || typeof path !== 'string' || !path.startsWith('/api/')) return path;
    return `${configuredBaseUrl}${path}`;
  }

  window.zelacityApiUrl = apiUrl;
  window.zelacityLoadProtectedImage = async (image, path) => {
    if (!configuredBaseUrl) { image.src = path; return; }
    const response = await window.fetch(path, { credentials: 'include' });
    if (!response.ok) throw new Error('Não foi possível carregar a imagem.');
    image.src = URL.createObjectURL(await response.blob());
  };
  window.zelacityNative = Object.freeze({
    isNative: isNativeApp,
    getCurrentPosition: (success, failure, options) => navigator.geolocation.getCurrentPosition(success, failure, options),
  });

  if (configuredBaseUrl) {
    const browserFetch = window.fetch.bind(window);
    window.fetch = (resource, init) => {
      if (typeof resource === 'string') {
        const resolved = apiUrl(resource);
        if (resolved !== resource) return browserFetch(resolved, { ...init, credentials: init?.credentials || 'include' });
      }
      return browserFetch(resource, init);
    };
  }

  document.addEventListener('click', (event) => {
    if (!window.zelacityNative.isNative) return;
    const mapLink = event.target.closest('a[href*="google.com/maps"]');
    if (!mapLink) return;
    const query = new URL(mapLink.href).searchParams.get('query');
    if (!query) return;
    event.preventDefault();
    window.location.assign(`geo:0,0?q=${encodeURIComponent(query)}`);
  });
})();
