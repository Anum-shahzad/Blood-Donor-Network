# AI Usage Disclosure

**Project:** Blood Donor & Emergency Request Network
**Team:** [fill in team member names]
**AI tool used:** Claude (Anthropic)

## What AI was used for

- **Architecture and planning**: proposing the tech stack (React/Vite,
  Node/Express, MySQL, JWT+bcrypt), the database schema, the simplified
  request lifecycle, and the role scope (donor/requester/admin, no
  separate hospital role), given the one-week timeline.
- **Boilerplate and setup**: project scaffolding, Express server setup,
  Vite/React setup, `.env` structure, `vercel.json` SPA rewrite rule.
- **Coding**: authentication (bcrypt hashing, JWT issuance/verification),
  donor profile routes, request creation/listing/status routes, the blood
  compatibility engine, the donor ranking/matching engine, admin
  verification routes, and the corresponding React pages (signup, login,
  donor dashboard, requester dashboard, admin dashboard).
- **Testing**: wrote and ran plain-Node self-check scripts for password
  hashing/JWT round-tripping, blood-type compatibility across all 8 groups,
  and the donor ranking algorithm (cooldown exclusion, score ordering).
- **Debugging**: diagnosed and fixed a Railway cross-project variable
  reference issue, a multi-statement SQL execution failure when loading
  the schema, and a Vercel SPA routing 404 on direct/refreshed URLs.
- **Documentation**: this README and this disclosure.

## What the team did itself

[Fill in honestly — this section needs your own words, not Claude's. Some
prompts to answer:]

- Which parts of the code did you read and understand well enough to
  explain in front of the class? Which parts are you still fuzzy on?
- What decisions did you make yourself (scope cuts, what to prioritize
  each day, what to skip) versus accept from Claude's recommendation?
- Did you modify, reject, or push back on anything Claude suggested? What
  and why?
- Who on the team did what — did everyone review the AI-generated code,
  or did one person drive it while others focused on other deliverables
  (demo video, disclosure, testing the live site)?
- What did you personally verify by hand (running the self-check scripts
  yourself, testing the live deployment, checking the database tables)
  rather than just trusting that it worked?

## Known limitations we're aware of

(Copy relevant lines from the README's "Known limitations" section, and
add anything else the team noticed while testing that isn't there yet.)
