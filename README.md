# ETF Tracker

Mobiele webapp om je ETF-investeringen op te volgen: aankopen registreren, en zien
hoeveel je geïnvesteerd hebt en wat het nu waard is. Meerdere accounts mogelijk;
elke gebruiker ziet enkel zijn eigen portefeuille.

**Stack:** Cloudflare Pages (statische frontend in `public/`) + Pages Functions
(API in `functions/`) + Cloudflare D1 (SQLite). Geen build-stap.
Koersen komen van Yahoo Finance (gratis, geen API-sleutel) en worden 15 min gecachet.

## Functies
- Eigen login (e-mail + wachtwoord, PBKDF2-hashing, HttpOnly-sessiecookie, brute-force-bescherming)
- Registratie van extra accounts (optioneel met uitnodigingscode, of volledig uit te schakelen)
- Aankopen toevoegen, bewerken en verwijderen, met ticker-zoekfunctie en de knop "huidige koers gebruiken"
- Overzicht met huidige waarde, geïnvesteerd bedrag, winst/verlies (€ en %) en verdeling per ETF
- Detail per positie: aantal stuks, gemiddelde aankoopprijs, kosten, en een manuele koers als terugvaloptie
- Mobile-first ontwerp, donkere modus, toe te voegen aan het beginscherm (PWA)

## Eenmalige installatie (kan volledig vanaf je gsm)

1. **D1-database aanmaken:** Cloudflare dashboard → *Storage & Databases → D1* →
   *Create* → naam `etf-tracker`. Kopieer de **Database ID** en zet die in
   `wrangler.toml` bij `database_id` (of vraag Claude om dat te doen).
2. **API-token maken:** dashboard → *My Profile → API Tokens → Create Token* →
   *Custom token* met de rechten **Account → Cloudflare Pages → Edit** en
   **Account → D1 → Edit**.
3. **GitHub-secrets toevoegen:** repo → *Settings → Secrets and variables → Actions*:
   - `CLOUDFLARE_API_TOKEN`: het token uit stap 2
   - `CLOUDFLARE_ACCOUNT_ID`: staat in de URL van het dashboard (`dash.cloudflare.com/<account-id>`)
4. **Deployen:** merge naar `main` (of start de workflow *Deploy naar Cloudflare*
   handmatig via de tab *Actions*). De site komt op `https://etf-tracker.pages.dev`.
5. **Registraties afschermen (aangeraden):** voeg in het Pages-project bij *Settings →
   Variables and Secrets* een geheim `REGISTRATION_CODE` toe. Enkel wie die code kent,
   kan dan een account maken. Of zet `REGISTRATION_OPEN = "false"` in `wrangler.toml`
   zodra alle accounts bestaan.

## Werkwijze vanaf je gsm (Claude)

Vraag Claude in de Claude-app om een wijziging. Claude werkt op een `claude/...`-branch
en pusht die naar GitHub. Is de wijziging goed, maak dan een pull request naar `main`
en merge die (via de GitHub-app, of vraag het aan Claude). Elke push naar `main`
deployt automatisch naar Cloudflare via GitHub Actions, inclusief nieuwe
databasemigraties in `migrations/`.

## Lokaal ontwikkelen

```bash
npm install
npm run dev        # http://localhost:8788 met een lokale D1-database
```

## API-overzicht
| Methode | Pad | Doel |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Accountbeheer |
| GET / POST | `/api/me`, `/api/me/password` | Profiel / wachtwoord wijzigen |
| GET | `/api/portfolio[?refresh=1]` | Posities en totalen |
| GET / POST / PUT / DELETE | `/api/purchases[/:id]` | Aankopen |
| GET | `/api/search?q=`, `/api/quote/:ticker` | Ticker zoeken / koers opvragen |
| PUT / DELETE | `/api/prices/:ticker` | Manuele koers instellen of wissen |
