// Изменения списка выезда без ФИО в открытом репозитории.
// Ключ X25519 выводится из секрета SUPABASE_DB_PASSWORD (он есть только в GitHub Actions).
//   node scripts/roster-secure.mjs pubkey              — открытый ключ (его можно показывать)
//   node scripts/roster-secure.mjs seal <pub> <json>   — зашифровать изменения (локально, без секрета)
//   node scripts/roster-secure.mjs sql <file.enc>      — расшифровать и выдать SQL (только в Actions; в лог не печатать)
// Формат изменений: { "add": [{ "fio", "group", "faction" }], "remove": ["ФИО", …] }
import crypto from 'node:crypto';
import fs from 'node:fs';

const PK8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const rawPub = (k) => (k.type === 'public' ? k : crypto.createPublicKey(k)).export({ format: 'der', type: 'spki' }).subarray(-32);
const pubFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
function myKey() {
  const s = process.env.SUPABASE_DB_PASSWORD;
  if (!s) { console.error('нет секрета SUPABASE_DB_PASSWORD'); process.exit(1); }
  const seed = crypto.createHmac('sha256', s).update('shpa-roster-x25519-v1').digest();
  return crypto.createPrivateKey({ key: Buffer.concat([PK8, seed]), format: 'der', type: 'pkcs8' });
}
const kdf = (shared, epk, pk) => crypto.createHash('sha256').update(Buffer.concat([shared, epk, pk])).digest();

const [mode, a, b] = process.argv.slice(2);
if (mode === 'pubkey') {
  console.log('PUBKEY ' + rawPub(myKey()).toString('base64'));
} else if (mode === 'seal') {
  const pk = Buffer.from(a, 'base64');
  const eph = crypto.generateKeyPairSync('x25519');
  const epk = rawPub(eph.publicKey);
  const key = kdf(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromRaw(pk) }), epk, pk);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(fs.readFileSync(b)), c.final()]);
  process.stdout.write(JSON.stringify({ v: 1, epk: epk.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }) + '\n');
} else if (mode === 'sql') {
  const box = JSON.parse(fs.readFileSync(a, 'utf8'));
  const priv = myKey(), pk = rawPub(priv), epk = Buffer.from(box.epk, 'base64');
  const key = kdf(crypto.diffieHellman({ privateKey: priv, publicKey: pubFromRaw(epk) }), epk, pk);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const ch = JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
  const q = (s) => { const t = String(s ?? ''); if (t.includes('$x$')) throw new Error('bad'); return `$x$${t}$x$`; };
  const out = ['begin;'];
  const FACTIONS = ['inei', 'ire', 'gpi', 'igvie', 'ievt', 'iete', 'enmi', 'itae', 'ivti', 'iee'];
  if (ch.add?.length) {
    for (const r of ch.add) if (!FACTIONS.includes(r.faction)) throw new Error('bad faction');
    out.push(`with a as (insert into public.roster (fio, fio_norm, grp, grp_norm, faction, role) values ${ch.add.map((r) => `(${q(r.fio)}, public.norm_fio(${q(r.fio)}), ${q(r.group)}, public.norm_group(${q(r.group)}), ${q(r.faction)}, 'participant')`).join(', ')}
      on conflict (fio_norm) do update set fio = excluded.fio, grp = excluded.grp, grp_norm = excluded.grp_norm, faction = excluded.faction, role = excluded.role returning 1)
      select 'добавлено или обновлено: ' || count(*) from a;`);
  }
  if (ch.remove?.length) {
    const list = ch.remove.map((f) => `public.norm_fio(${q(f)})`).join(', ');
    out.push(`with d as (delete from public.roster r where r.fio_norm in (${list})
      and not exists (select 1 from public.players p where p.id = r.player_id and p.rating > 0) returning 1)
      select 'убрано: ' || count(*) from d;`);
    out.push(`select 'не убрано (уже есть баллы): ' || count(*) from public.roster where fio_norm in (${list});`);
  }
  out.push(`select 'участников по ПБ: ' || string_agg(faction || ' ' || n, ', ' order by faction) from (select faction, count(*) n from public.roster where role = 'participant' group by faction) z;`);
  out.push(`select 'в ПБ больше ' || public.setting_int('pb_limit', 7) || ': ' || count(*) from (select faction from public.roster where role = 'participant' group by faction having count(*) > public.setting_int('pb_limit', 7)) z;`);
  out.push('commit;');
  process.stdout.write(out.join('\n') + '\n');
} else {
  console.error('режим: pubkey | seal | sql'); process.exit(1);
}
