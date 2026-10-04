<p align="center"><img src="web/assets/logo.svg" width="72" alt="Yalelux"></p>
<h1 align="center">Yalelux</h1>
<p align="center"><strong>Where Yale's light connects resources and ideas</strong><br>An open-source community for Yale students and alumni, built by ACSSY volunteers.</p>
<p align="center"><a href="README.md">中文</a> · <a href="docs/prd/yalelux-mvp.md">PRD (zh)</a> · <a href="docs/api.md">API</a> · <a href="docs/engineering.md">Engineering rules</a> · <a href="docs/rfcs/README.md">RFCs</a> · <a href="docs/deploy-china.md">Deploying</a></p>

---

The name echoes Yale's motto *Lux et Veritas*. Formerly "YaleLink".

## Launch feature: Coffee Chat

Deliberately light and unlike LinkedIn — no feed, no likes or followers, no in-site chat.

1. **Sign in** with a Yale address (`@yale.edu` / `@aya.yale.edu`) and a one-time code; add a contact email you actually read (many members are in mainland China), answer a short questionnaire and pick a few tags.
2. **Weekly rounds**: tick the times you're free this week (New York 10:00–21:00, 15-minute chats, Beijing time shown alongside). Sign-up for the next week opens on Saturday.
3. **Recommendations + browsing**: once the pool reaches 20 people you get 3 suggestions (rule-based scoring; optional DeepSeek re-ranking on anonymized tags only, opt-out anytime). You can always browse by identity / goal / interest / field.
4. **Double opt-in**: tap "want to meet"; it's a match only when they tap it too. Skipping is silent. Up to 5 open invites per person.
5. **After a match** both see each other's contact (e.g. WeChat) and shared free times; one tap schedules it and emails the other person. Afterwards: "did you meet?".
6. **Event rounds** ("Coffee Chat week / month") get a public page with an article and WeChat promo copy.
7. **Email**: matches immediately; "someone wants to meet you" at most once a day; a reminder the day before; Monday weekly note; event announcements. All but match emails can be unsubscribed.

## Run it locally

You need **Node.js 22+**. No database server, no accounts.

```bash
git clone https://github.com/YuchenZhu2335/YaleLink-connection-is-all-you-need.git yalelux
cd yalelux
npm run seed     # optional: 24 fictional demo members in this week's round
npm start        # open the printed address (default http://localhost:8787)
```

- Sign in with any `@yale.edu` address — locally no email is sent; the **code is printed in the `npm start` terminal** and listed at `http://localhost:8787/api/dev/outbox`.
- Demo accounts: `demo01@demo.yale.edu` … `demo24@demo.yale.edu`.
- Admin: copy `server/.env.example` to `server/.env`, put your Yale email in `ADMIN_EMAILS=`, restart.
- Data lives in one file, `server/data/yalelux.sqlite` (git-ignored, like `server/.env`).

## Checks

```bash
npm run check      # questionnaire + dictionaries, architecture guard (front A1–A11, server S1–S4), unit tests, API tests — zero dependencies
npm run test:e2e   # browser end-to-end (after npm ci)
```

## Layout

`server/` (Node built-in http + SQLite, zero runtime dependencies) · `web/` (vanilla HTML/CSS/JS served by the same process: `js/core`, `js/domain` shared rules, `js/modules`) · `docs/` · `scripts/` · `tests/`. The v0 static prototype modules (careers, circles, ACSSY console…) live on `main`; here they are parked (`scripts/parked.mjs`) and will come back one RFC at a time.

## License

[MIT](LICENSE)
