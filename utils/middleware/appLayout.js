const expressLayouts = require('express-ejs-layouts');
const { isAdmin } = require('../constants/sitesettings');

const APP_LAYOUT = 'layouts/app.ejs';

/**
 * Route middleware: render this route's view inside the signed-in app shell
 * (views/layouts/app.ejs). Usage: app.get('/path', appLayout, handler).
 *
 * Exposes `user`, `isAdmin` and `currentPath` to the layout and the view even
 * when the handler does not pass them, so nav highlighting and the admin link
 * work everywhere without each route repeating itself.
 */
function appLayout(req, res, next) {
  res.locals.layout = APP_LAYOUT;
  res.locals.currentPath = req.path;
  if (req.user) {
    if (res.locals.user === undefined) res.locals.user = req.user;
    res.locals.isAdmin = isAdmin(req.user);
  }
  return expressLayouts(req, res, next);
}

module.exports = { appLayout, APP_LAYOUT };
