(() => {
  function fixDrawer() {
    const btn = document.getElementById('nxStaticMenu') || document.querySelector('.nx-mobile-menu');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.nx-overlay');
    if (!btn || !sidebar) return;

    // phase1.js uses the onclick property; index.html already has the intended
    // addEventListener handler. Remove only the duplicate property handler.
    btn.onclick = null;
    btn.dataset.nxDrawerFixed = '1';

    // Keep navigation reliable on mobile and always close the drawer after selection.
    document.querySelectorAll('.sidebar .nav-btn[data-page]').forEach((nav) => {
      if (nav.dataset.nxDrawerNavFixed === '1') return;
      nav.dataset.nxDrawerNavFixed = '1';
      nav.addEventListener('click', () => {
        if (window.innerWidth <= 760) {
          sidebar.classList.remove('nx-open');
          overlay?.classList.remove('nx-open');
          document.body.classList.remove('nx-menu-open');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      fixDrawer();
      setTimeout(fixDrawer, 50);
      setTimeout(fixDrawer, 500);
    }, { once: true });
  } else {
    fixDrawer();
    setTimeout(fixDrawer, 50);
    setTimeout(fixDrawer, 500);
  }
})();
