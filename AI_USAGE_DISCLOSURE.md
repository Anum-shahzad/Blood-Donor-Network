# AI Usage Disclosure

**Project:** Blood Donor & Emergency Request Network

**Team:** Anum Shahzad , Saba Parveen , Hamza Noor

**AI tool used:** Claude (Anthropic), Chatgpt

## What AI was used for

- **Architecture and planning**: proposing the tech stack (React/Vite,
  Node/Express, MySQL, JWT+bcrypt), the database schema, the simplified
  request lifecycle, and the role scope (donor/requester/admin, no
  separate hospital role),  
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
- **Debugging**: diagnosed and fixed a multi-statement SQL execution failure when loading
  the schema, and a Vercel SPA routing 404 on direct/refreshed URLs.
- **Documentation**: this README and this disclosure.

## What the team did itself

Although we used AI for coding, we were involved in planning the project, making decisions, and deciding which features we wanted to include and how the application should look and work.

**Deployment**: We decided to use Railway for backend deployment initially. When the free trial ended and the backend became inactive, I decided to move to Vercel for backend deployment and TiDB Cloud for the database.

**Anonymous Chat**: We proposed adding anonymous in-website chat to help protect users' privacy while allowing them to communicate through the platform.

**Request Evidence**: We proposed allowing users to provide evidence with blood requests to support request credibility.

**Donor Trust Levels**: We proposed a donor trust-level system inspired by the reputation system used on Fiverr, with the aim of helping users assess donor reliability.

**UI/UX Design**: Our team made the visual design decisions, including the color palette, layout, interface structure, and overall user experience.

We used AI to help translate these decisions and ideas into working software. we acknowledge that we did not manually write the source code independently and relied on AI for code generation and assistance.
## Final Note

We acknowledge that AI played a major role in writing the code for our project. Our contribution was mainly in planning, decision-making, feature ideas, design choices, and guiding the development process. We understand that we are responsible for our final project and should be able to explain its main features and the decisions behind them.


