(() => {
  let deferredInstallPrompt = null;
  const installButtons = [...document.querySelectorAll('[data-install-app]')];
  const iosHints = [...document.querySelectorAll('[data-ios-install-hint]')];
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

  const setInstallVisibility = (visible) => installButtons.forEach((button) => { button.hidden = !visible; });

  if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {
        // O sistema segue utilizável quando o navegador não oferece suporte ao PWA.
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallVisibility(true);
  });

  installButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      setInstallVisibility(false);
    });
  });

  if (isIos && !isStandalone) iosHints.forEach((hint) => { hint.hidden = false; });

  window.zelacityPwa = {
    async requestNotificationPermission() {
      if (!('Notification' in window)) return 'unsupported';
      return Notification.requestPermission();
    },
  };
})();
