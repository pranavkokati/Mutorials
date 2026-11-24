# How changes reach a live site

## What is true today

- `mutorials.org` is owned and deployed by **The Mu Foundation**. Its
  `.github/workflows/deploy.yml` (in the upstream repository
  `The-Mu-Foundation/Mutorials`) connects to the Foundation's server with a
  secret SSH key and deploys the upstream repository.
- This fork (`pranavkokati/Mutorials`) has no access to that server or key, so
  merging into the fork changes the fork only. That is why changes made here are
  not visible on mutorials.org. This is expected, not a bug.

## Ways to make changes visible

| Goal                      | How                                                                                      | Needs                 |
| ------------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| See the work yourself     | `npm run demo` (see the README)                                                          | Node 22               |
| Run the real app yourself | Set `DB_URL` (MongoDB) and `SESSION_SECRET`, then `npm start`                            | A MongoDB instance    |
| Host your own public copy | Deploy the fork to any Node host with the same two variables                             | A host and a database |
| Update mutorials.org      | Open a pull request to `The-Mu-Foundation/Mutorials`; the Foundation reviews and deploys | Maintainer approval   |

Upstream pull requests are large here (rating engine, coach, new UI). Splitting
them into small, separately reviewable requests and discussing the rating-engine
change with the maintainers first is more likely to succeed than one big merge.

## Before hosting anything publicly

- The repository history contains credentials committed earlier (a MongoDB URI
  and a Discord webhook). Rotate them; deleting the files does not remove them
  from history.
- The legacy deploy workflows (`deploy.yml` and the Azure workflows) still exist
  in the fork. They cannot deploy to the Foundation's server without its key, but
  disable them in the fork's Actions settings so they do not run or fail noisily.
- Production requires `DB_URL` (the app refuses to start without it). Also set
  `SESSION_SECRET`: without it the app generates a random one per process and
  logs a warning, so every restart signs everyone out.
