// FUNCTION IMPORTS
const { calculateLevel } = require('../utils/functions/siteAlgorithms');
const { isAdmin } = require('../utils/constants/sitesettings');
const {
  getDailyQuestion,
  getSiteData,
  getAnnouncements,
  querySite,
} = require('../utils/functions/database');
const { tags } = require('../utils/constants/tags.js');
const { toObjectId } = require('../utils/functions/ids');
const { wrap } = require('../utils/functions/http');
const { ai } = require('../utils/config');
const { getIndex } = require('../utils/ai/runtime');
const { semanticQuestions } = require('../utils/ai/search');
const { appLayout } = require('../utils/middleware/appLayout');
const { ratingCards, levelProgress } = require('../utils/functions/dashboard');
const { countDueReviews } = require('../utils/functions/coachData');

const VIEWS = __dirname + '/../views/';

module.exports = (app, mongo) => {
  app.all(
    /^(\/announcements|\/homepage|\/question|\/search).*$/,
    (req, res, next) => {
      if (req.isAuthenticated()) {
        next();
      } else {
        req.flash(
          'errorFlash',
          'Error 401: Unauthorized. You need to login to see this page.',
        );
        res.redirect('/');
      }
    },
  );

  app.get('/announcements', async (req, res) => {
    const announcements = await getAnnouncements(mongo.SiteData, 20);
    res.render(VIEWS + 'private/announcements.ejs', {
      announcements,
      pageName: 'Announcements',
    });
  });

  app.get('/homepage', appLayout, async (req, res) => {
    const siteData = await getSiteData(mongo.User, mongo.Ques, mongo.SiteData);
    const experienceStats = await calculateLevel(req.user.stats.experience);
    const question = await getDailyQuestion(mongo.Daily, mongo.Ques);
    const announcements = await getAnnouncements(mongo.SiteData, 3);
    let reviewDue = 0;
    try {
      reviewDue = await countDueReviews(mongo, req.user);
    } catch (err) {
      // the dashboard is still useful without the review badge
      console.error('[homepage] review count failed:', err.message || err);
    }
    res.render(VIEWS + 'private/homepage.ejs', {
      user: req.user,
      siteStats: siteData,
      admin: isAdmin(req.user),
      experienceStats,
      levelPct: levelProgress(experienceStats),
      ratingCards: ratingCards(req.user),
      reviewDue,
      question,
      announcements,
      subjectTags: tags,
      pageName: 'Home',
    });
  });

  app.get(
    '/question/:id',
    wrap(async (req, res) => {
      const question =
        toObjectId(req.params.id) &&
        (await mongo.Ques.findById(req.params.id).exec());
      if (question) {
        res.render(VIEWS + 'private/question.ejs', {
          question,
          pageName: 'Question ' + question._id,
        });
      } else {
        req.flash(
          'errorFlash',
          "Error 404: File Not Found. That question doesn't exist.",
        );
        res.redirect('/');
      }
    }),
  );

  app.get('/search', appLayout, async (req, res) => {
    const query = req.query;
    let results = [];
    let semantic = [];

    if (query) {
      results = await querySite(query, mongo.User, mongo.Ques);
      if (ai.enabled) {
        try {
          semantic = await semanticQuestions({
            mongo,
            index: getIndex(mongo),
            userKey: String(req.user._id),
            query,
            exclude: new Set(
              results
                .filter((r) => r.type === 'QUESTION')
                .map((r) => String(r.id)),
            ),
          });
        } catch (err) {
          // optional extra: keyword results are still shown
          console.error('[ai] semantic search failed:', err.message || err);
        }
      }
    }
    res.render(VIEWS + 'private/search.ejs', {
      results,
      semantic,
      query,
      // Express 5 query objects have no prototype, so templates cannot compare them to ""
      hasQuery: typeof query.text === 'string' && query.text.trim() !== '',
      pageName: 'Search',
      subjectTags: tags,
    });
  });

  app.get('/logout', (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.redirect('/');
    }
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });
};
