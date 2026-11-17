/** Accès à l'API HOMEOS (même origine, cookie de session, en-tête anti-CSRF). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { ...(method === 'GET' ? {} : { 'x-homeos': '1' }), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Pas de connexion au serveur. Vos actions sont conservées et seront envoyées dès le retour du réseau.');
  }
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      /* réponse non JSON */
    }
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status >= 500 && !err) throw new ApiError(res.status, 'server', 'Le serveur rencontre un problème. Réessayez dans un instant.');
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Erreur ${res.status}`);
  }
  return json as T;
}

export const get = <T = unknown>(url: string) => api<T>('GET', url);
export const post = <T = unknown>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T = unknown>(url: string, body: unknown = {}) => api<T>('PATCH', url, body);
export const del = <T = unknown>(url: string, body?: unknown) => api<T>('DELETE', url, body);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur inattendue est survenue.';
}
