// Behaviour for the signed-in app shell: menus, mobile nav and theme toggle.
// No dependencies, so the shell works even if third-party CDNs are blocked.
(function () {
  var doc = document;

  function closeMenus(except) {
    doc.querySelectorAll('[data-menu]').forEach(function (menu) {
      if (menu === except) return;
      menu.classList.add('hidden');
      var toggle = doc.querySelector('[data-menu-toggle="' + menu.id + '"]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  doc.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-menu-toggle]');
    if (toggle) {
      var menu = doc.getElementById(toggle.getAttribute('data-menu-toggle'));
      if (!menu) return;
      var opening = menu.classList.contains('hidden');
      closeMenus(opening ? menu : null);
      menu.classList.toggle('hidden', !opening);
      toggle.setAttribute('aria-expanded', String(opening));
      return;
    }
    var nav = event.target.closest('[data-nav-toggle]');
    if (nav) {
      var panel = doc.getElementById(nav.getAttribute('data-nav-toggle'));
      if (panel) {
        var show = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !show);
        nav.setAttribute('aria-expanded', String(show));
      }
      return;
    }
    var theme = event.target.closest('[data-theme-toggle]');
    if (theme) {
      var dark = doc.documentElement.classList.toggle('dark');
      try {
        localStorage.setItem('mu-theme', dark ? 'dark' : 'light');
      } catch (e) {
        /* storage unavailable: the choice just lasts for this page */
      }
      return;
    }
    if (!event.target.closest('[data-menu]')) closeMenus(null);
  });

  doc.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenus(null);
  });
})();
