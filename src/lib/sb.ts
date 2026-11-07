// Лёгкий клиент Supabase на fetch: RPC, сессия с обновлением токена, загрузка фото.
// Заменяет @supabase/supabase-js (−100 КБ в сборке, меньше точек отказа на медленной связи).
export interface Session { access_token: string; refresh_token: string; expires_at: number }

const LS = 'pbgame.auth2';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* приватный режим */ } };

function jwtExp(token: string) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number; } catch { return Math.floor(Date.now() / 1000) + 3000; }
}

export class SbError extends Error { constructor(message: string, public status = 0, public code = '') { super(message); } }

export class Sb {
  session: Session | null = null;
  private refreshing: Promise<void> | null = null;
  /** Сервер не отвечает — фоновые опросы молчат до этого момента (растущая пауза со случайным разбросом). */
  private coolUntil = 0;
  private fails = 0;
  get cooling() { return Date.now() < this.coolUntil; }
  private trip() {
    this.fails++;
    const base = Math.min(120_000, 10_000 * 2 ** Math.min(this.fails - 1, 4));
    this.coolUntil = Date.now() + base * (0.6 + Math.random() * 0.8);
  }

  constructor(public url: string, public key: string) {
    const raw = lsGet(LS);
    if (raw) { try { this.session = JSON.parse(raw); } catch { this.session = null; } }
  }

  setSession(access_token: string, refresh_token: string) {
    this.session = { access_token, refresh_token, expires_at: jwtExp(access_token) };
    lsSet(LS, JSON.stringify(this.session));
  }

  signOut() { this.session = null; lsSet(LS, null); }

  private async refresh() {
    if (!this.session) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 20000);
        let r: Response;
        try {
          r = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST', headers: { apikey: this.key, 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.session!.refresh_token }), signal: ctl.signal,
          });
        } catch { this.trip(); throw new SbError('Нет связи с сервером', 0); }
        finally { clearTimeout(timer); }
        // выходим из аккаунта, только если сервер точно сказал «токен недействителен»; перегрузка — не повод разлогинить всех
        if (r.status === 400 || r.status === 401 || r.status === 403) { this.signOut(); throw new SbError('Сессия истекла — войди заново', 401); }
        if (!r.ok) { this.trip(); throw new SbError('Нет связи с сервером', r.status); }
        const j = await r.json();
        this.setSession(j.access_token, j.refresh_token);
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  private async token() {
    if (this.session && this.session.expires_at - Date.now() / 1000 < 90) await this.refresh();
    return this.session?.access_token ?? (this.keyIsJwt ? this.key : '');
  }

  /** Старый anon-ключ — JWT, его можно слать в Authorization; новый publishable (sb_publishable_…) — только в apikey. */
  private get keyIsJwt() { return this.key.split('.').length === 3; }

  private async req(path: string, init: RequestInit & { headers?: Record<string, string> }, retry = true): Promise<Response> {
    const tok = await this.token();
    const headers: Record<string, string> = { apikey: this.key, ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...((init.headers ?? {}) as Record<string, string>) };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    let r: Response;
    try { r = await fetch(`${this.url}${path}`, { ...init, headers, signal: ctl.signal }); }
    catch { this.trip(); throw new SbError('Нет связи с сервером', 0); }
    finally { clearTimeout(timer); }
    if (r.status >= 500) this.trip(); else { this.fails = 0; this.coolUntil = 0; }
    if (r.status === 401 && retry && this.session) { await this.refresh(); return this.req(path, init, false); }
    return r;
  }

  private async parse<T>(r: Response): Promise<T> {
    const txt = await r.text();
    const j = txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : null;
    if (!r.ok) {
      const msg = (j && typeof j === 'object' && (j.message || j.error_description || j.error)) || `Ошибка сервера (${r.status})`;
      throw new SbError(String(msg), r.status, (j && j.code) || '');
    }
    return j as T;
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.req(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    return this.parse<T>(r);
  }

  async upload(bucket: string, path: string, body: Blob, contentType: string) {
    const r = await this.req(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { 'content-type': contentType, 'x-upsert': 'false' }, body });
    return this.parse<unknown>(r);
  }

  async signedUrl(bucket: string, path: string, expiresIn = 3600) {
    const r = await this.req(`/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn }) });
    const j = await this.parse<{ signedURL?: string; signedUrl?: string }>(r);
    const u = j.signedURL ?? j.signedUrl ?? '';
    return u ? `${this.url}/storage/v1${u}` : '';
  }

  /** Вызов edge-функции без сессии. */
  /** Вызов edge-функции от имени вошедшего игрока (его токен в заголовке). */
  async fnUser<T = unknown>(name: string, body: unknown): Promise<T> {
    const r = await this.req(`/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return this.parse<T>(r);
  }

  async fn<T = unknown>(name: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(`${this.url}/functions/v1/${name}`, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: this.key, ...(this.keyIsJwt ? { authorization: `Bearer ${this.key}` } : {}) }, body: JSON.stringify(body), signal: ctl.signal,
      });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } as T }; }
    finally { clearTimeout(timer); }
  }
}
