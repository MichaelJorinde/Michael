// Maandelijkse herinnering via ntfy om de HomeWizard-gegevens van vorige maand in te geven.
// Draait in GitHub Actions (zie .github/workflows/energie-herinnering.yml); logt geen verbruik.
import { execFileSync } from 'node:child_process';

const SITE = 'https://etf-tracker-7tv.pages.dev';
const TOPIC = process.env.NTFY_TOPIC;
const DRY_RUN = process.env.DRY_RUN === '1';

// Vorige maand in Belgische tijd, als YYYY-MM en als naam.
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
const monthName = prev.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
const day = now.getDate(); // 1e van de maand = eerste herinnering, 3e en 5e = opnieuw als het nog niet ingegeven is

// Al ingegeven? Dan is geen herinnering nodig.
function alreadyEntered() {
  const sql = `SELECT COUNT(*) AS n FROM energy_usage WHERE user_id = (SELECT MIN(id) FROM users) AND month = '${month}'`;
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'etf-tracker', process.env.D1_LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results[0].n > 0;
}

async function main() {
  if (!TOPIC && !DRY_RUN) throw new Error('NTFY_TOPIC ontbreekt (GitHub-secret)');
  // Handmatig gestart (FORCE=1): altijd versturen, om de melding te testen.
  if (process.env.FORCE !== '1' && alreadyEntered()) { console.log('Al ingegeven; geen herinnering nodig.'); return; }
  const msg = {
    topic: TOPIC,
    title: `⚡ ${day > 1 ? 'Nog niet gedaan: ' : ''}geef je energie van ${monthName} in`,
    message: `Neem de HomeWizard Energy-app erbij en geef je totaalverbruik van ${monthName} in: elektriciteit (afname en injectie), gas en water. Tik op deze melding om meteen te beginnen.`,
    priority: day > 1 ? 5 : 4,
    tags: ['zap', 'droplet'],
    click: `${SITE}/#/energy/month/${month}`,
  };
  if (DRY_RUN) { console.log(JSON.stringify({ ...msg, topic: '(verborgen)' }, null, 2)); return; }
  const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`ntfy antwoordde met ${res.status}`);
  console.log('Herinnering verstuurd.');
}

main().catch((err) => { console.error(`Mislukt: ${err.message}`); process.exit(1); });
