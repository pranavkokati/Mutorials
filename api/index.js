// Vercel entry point: serves the Express app as a serverless function.
//
// What differs from `node index.js`:
//  - no listen(): Vercel calls this handler per request
//  - the database connection and the one-time SiteData setup run once per cold
//    start, and every request waits for them
//  - no analytics scheduler (it relies on a process that stays alive), see docs/HOSTING.md
const mongo = require('../utils/functions/mongo.js');
const { ensureSiteData } = require('../utils/functions/database');
const app = require('../app');

const ready = mongo.connected.then(() => ensureSiteData(mongo.SiteData));
ready.catch((err) => console.error('Database setup failed:', err.message));

module.exports = async (req, res) => {
  try {
    await ready;
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Retry-After', '10');
    res.end('The database is not reachable. Try again in a moment.');
    // a rejected connection never retries; let the platform start a fresh instance
    setTimeout(() => process.exit(1), 250).unref();
    return;
  }
  return app(req, res);
};
