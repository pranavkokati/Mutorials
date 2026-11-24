# Hosting your own copy on Vercel

This repository deploys to Vercel as one serverless function (`api/index.js`) plus static files from `public/`. It needs a MongoDB database. The free MongoDB Atlas M0 tier is enough for a personal or small-class deployment.

## What you get, and what you do not

| Feature                                    | On Vercel                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Practice, ratings, coach, review, accounts | Works                                                                                                                                                                     |
| Self-hosted AI (tutor, related questions)  | **Off.** Serverless functions cannot hold the model (hundreds of MB, minutes to warm up). The AI panel simply does not appear. Use a VPS or container host to keep it on. |
| Daily and weekly growth charts             | Frozen. They rely on a scheduler in a long-running process (`analytics.js`). Add a Vercel Cron job if you need them.                                                      |
| Rate limiting                              | Per function instance, so it is weaker than on a single server.                                                                                                           |
| Questions                                  | **None.** A fresh database is empty. Import questions or write your own as an admin.                                                                                      |

## Setup

1. Create a free MongoDB Atlas cluster. Create a database user, and under Network Access allow `0.0.0.0/0` (Vercel's addresses are not fixed). Copy the connection string, with the database name `mutorials` in the path.
2. In Vercel, import `pranavkokati/Mutorials` (branch `master`). Leave the framework as "Other". `vercel.json` already sets the install command (which skips the AI library), the CSS build and the rewrite to the function.
3. Add these environment variables for Production:
   - `DB_URL`: the Atlas connection string. **Add it yourself in the dashboard, never commit it.**
   - `SESSION_SECRET`: a long random string. Without it, every cold start invalidates all sessions.
   - `AI_ENABLED`: `0`
   - `NODE_ENV`: `production`
   - `ADMIN_EMAILS`: your email (see below)
4. Deploy. Visit `/signin` and register. The first request after idle takes a second or two longer while the database connection opens.

## Making yourself an admin

Admins are identified by email address, so you need both of these:

1. Set `ADMIN_EMAILS` to your sign-in email (several addresses are separated by semicolons). Setting it **replaces** the built-in list of the original project's admin addresses, which you do not want on your own site.
2. Register that account, then in the Atlas data browser set `emailVerified` to `true` on your document in the `users` collection. Accounts start unverified so that nobody can claim an admin address by registering first, and verification normally happens through the password-reset email flow, which needs mail configured.

## How it works

`api/index.js` waits for the Mongo connection (once per cold start), creates the site-data documents if they are missing, then hands each request to the same Express app that `npm start` uses. If the database is unreachable it answers 503 and exits so the platform starts a fresh instance.
