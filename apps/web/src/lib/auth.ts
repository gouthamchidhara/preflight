/**
 * Sign-in (§3): Entra ID via MSAL when the API says authMode=entra; nothing in dev mode.
 */
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

export interface ServerConfig {
  authMode: 'dev' | 'entra';
  tenantId: string | null;
  clientId: string | null;
  apiScope: string | null;
}

let pca: PublicClientApplication | null = null;
let account: AccountInfo | null = null;
let scopes: string[] = [];

export async function initAuth(cfg: ServerConfig): Promise<void> {
  if (cfg.authMode !== 'entra') return;
  if (!cfg.clientId || !cfg.tenantId || !cfg.apiScope) throw new Error('Server is in Entra mode but ENTRA_CLIENT_ID / ENTRA_API_SCOPE are not set.');
  scopes = [cfg.apiScope];
  pca = new PublicClientApplication({
    auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenantId}`, redirectUri: window.location.origin },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await pca.initialize();
  const r = await pca.handleRedirectPromise();
  account = r?.account ?? pca.getAllAccounts()[0] ?? null;
  if (!account) await pca.loginRedirect({ scopes });
}

export async function bearer(): Promise<string | null> {
  if (!pca || !account) return null;
  try {
    return (await pca.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes, account });
    throw e;
  }
}

export async function signOut() {
  if (pca && account) await pca.logoutRedirect({ account });
}
