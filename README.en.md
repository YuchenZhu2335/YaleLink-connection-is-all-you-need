<p align="center"><img src="web/assets/logo.svg" width="72" alt="YaleLink"></p>
<h1 align="center">YaleLink</h1>
<p align="center">An open-source community platform for Yale students and alumni, built on the trust of a <code>yale.edu</code> inbox.</p>
<p align="center"><a href="README.md">中文</a> · <a href="docs/vision.md">Vision</a> · <a href="docs/modules.md">Modules</a> · <a href="docs/architecture.md">Architecture</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="docs/deploy-china.md">Deploying in China</a></p>

---

## What it is

WeChat groups are our default community, and they have three built-in flaws: **closed circles, no memory, and painful event logistics**. Every year the same advice about housing, banking and recruiting gets retold in chat; job leads and referrals scatter across dozens of groups; running an ACSSY event depends on whoever remembers last year's process.

YaleLink is **an app of our own**:

- **A first layer of trust** — only `@yale.edu` (students) and `@aya.yale.edu` (alumni) addresses can sign in.
- **Institutional memory** — forum-style posts and guides that keep career, life and startup experience.
- **Organized wherever you are** — circles by region, interest and industry; host or join alumni events anywhere.
- **Career development first** — job leads, referrals, recruiting timelines, a resume workshop, industry study groups and mock interviews.
- **A steady ACSSY** — a members-only console with event playbooks (SOPs), a contacts base, outreach templates, volunteer recruiting, and a project board with task assignment so the next team can pick things up fast.

It is a **foundation**: modular, dependency-free, data-as-files. Anyone can propose features, add modules or contribute content.

## What lives here, and what doesn't

This repository holds **the idea and the framework only**: product vision, the modular foundation, the UI prototype, the data model, deployment guides, and fictional sample data.

| Here (public) | Private cloud (never here) |
|---|---|
| Platform code, module framework, design tokens | Real alumni profiles, directory, posts, RSVPs |
| Data model and API contract (`docs/data-model.md`) | Real ACSSY playbook details: quotes, sponsor terms, contacts |
| Fictional sample data | Secrets, mail credentials, cloud configuration |
| Vision, roadmap, deployment and compliance docs | User uploads and photos |

"Only yale.edu can enter" is a **product** boundary enforced by the backend and database on private cloud; the code itself is open for anyone to read, fork and reuse. See [docs/architecture.md](docs/architecture.md) and [docs/deploy-china.md](docs/deploy-china.md).

**Proposals welcome**: feature modules (marketplace, carpooling, mentor matching, book clubs…) and extensions (reuse by other student associations, a mini-program shell, an alumni company directory). Open a [feature proposal](../../issues/new?template=feature_proposal.yml); the idea pool is in [docs/roadmap.md](docs/roadmap.md).

## Governance

- `main` is protected: every change goes through a Pull Request and needs approval from the maintainer ([@YuchenZhu2335](https://github.com/YuchenZhu2335)), see [CODEOWNERS](.github/CODEOWNERS).
- External contributors fork and open PRs; CI runs data validation and a browser smoke test automatically.
- Direction disagreements are discussed in issues; the maintainer makes the final call.

## Live demo

> Once GitHub Pages is enabled (Settings → Pages → Source **GitHub Actions**) the demo lives at `https://yuchenzhu2335.github.io/YaleLink-connection-is-all-you-need/`. For mainland China, deploy to Tencent COS / Alibaba OSS per [docs/deploy-china.md](docs/deploy-china.md).

**Demo sign-in**: any `@yale.edu` / `@aya.yale.edu` address, code `000000`. Pick an ACSSY role on the profile step to see the console. All data is fictional.

## Two faces

| | Public: alumni community | Internal: ACSSY console |
|---|---|---|
| Who | Everyone verified by email | Members who declared an ACSSY role (admin-approved in production) |
| What | Careers, events, circles, startup, life guides, directory | Project board, playbooks, contacts, templates, volunteers |
| Where | Home modules | "ACSSY console" in the sidebar (members only) |

The **"Host an event"** wizard connects them: community events publish through a lightweight flow; official ACSSY events pick a playbook, and the system generates the full task list with due dates. Leads assign, members claim and report progress, and the public event page recruits volunteers.

## Modules

| Module | Route | Notes |
|---|---|---|
| Login | `#/login` | Domain allowlist → code → first-time profile (incl. ACSSY role) |
| Coffee chats · beta | `#/coffee` | Sign up, offer free slots (15-min boxes, Eastern Time), find people by identity / goal, book and confirm, swap contacts once accepted, feedback box, admin stats — reference implementation of the domain / api / UI split ([RFC 0001](docs/rfcs/0001-coffee-chat-beta.md)) |
| Home | `#/home` | ACSSY push (notices / volunteer calls / my tasks), shortcuts, latest posts, upcoming events, featured alumni |
| Careers | `#/careers` | Jobs & referrals · Timelines · Resume workshop · Study groups & mocks · Industry research |
| Events | `#/events` | Filter by region / type, RSVP, detail, "Host an event" wizard |
| Circles | `#/circles` | Interest / region / industry circles; join, see their events, host inside a circle |
| Startup | `#/startup` | Campus resources (Tsai CITY etc.) · Projects & co-founders · "I offer / I need" matching |
| Life | `#/life` | Housing, food, health… × region; experience posts; contribute entries |
| Directory | `#/directory` | Filter by industry / region / help offered; profiles; say hi |
| ACSSY console | `#/acssy` | Board · Playbooks · Contacts · Templates · Volunteers (members only) |
| Profile | `#/profile` | Profile, my posts / events / groups, points and badges |
| About | `#/about` | Vision, auto-generated module list, roadmap, how to contribute |

See [docs/modules.md](docs/modules.md) for details and extension points.

## Quick start

```bash
git clone https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need.git
cd YaleLink-connection-is-all-you-need/web
python3 -m http.server 8000      # or: npx serve .
```

No build, no dependencies. Run `npm run check` (data and dictionaries, architecture rules, unit tests; Node ≥ 22).

## Contributing

1. **Propose** — open an issue with the feature proposal template.
2. **Add a module** — write a one-page [RFC](docs/rfcs/README.md), create `web/js/modules/xxx.js`, call `registerModule()`, add dictionary keys and data. Five steps in [CONTRIBUTING.md](CONTRIBUTING.md); modules that write data follow the [engineering rules](docs/engineering.md) (domain / api / UI).
3. **Add content** — jobs, events, guides, playbooks and templates are plain JSON under `web/data/`.
4. **Improve docs** — vision, roadmap and deployment are open for discussion.

CI validates data and runs a browser smoke test on every PR.

## Roadmap

v0.1 static prototype (now) → v0.2 real backend & email login → v0.3 China-ready (WeChat binding, mini-program shell, domestic CDN, ICP) → v0.4 governance (points, moderators, playbook marketplace). See [docs/roadmap.md](docs/roadmap.md).

## License

[MIT](LICENSE). People, companies and contacts in the sample data are fictional.
