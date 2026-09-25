/**
 * App shell (PLAN.md §3, T7). Hash routes: #/ (fleet) and #/devices/:id.
 * Data: live API by default; `?mock` in the URL (or VITE_MOCK=1) uses the built-in demo fleet.
 */
import { useEffect, useState } from 'react';
import { LogOut, PlaneTakeoff } from 'lucide-react';
import { DEFAULT_RULES } from '@umd/contracts';
import { Fleet } from './pages/Fleet.js';
import { DeviceDetailPage } from './pages/Device.js';
import { SourceContext } from './lib/context.js';
import { httpSource, type Me, type Source } from './lib/source.js';
import { mockSource } from './lib/mock.js';
import { signOut } from './lib/auth.js';
import { Banner } from './components/Banner.js';

type Route = { page: 'fleet' } | { page: 'device'; id: string };

export function parseRoute(hash: string): Route {
  const m = /^#\/devices\/([\w-]+)$/.exec(hash);
  return m ? { page: 'device', id: m[1]! } : { page: 'fleet' };
}

export function pickSource(): Source {
  if (typeof window === 'undefined') return mockSource;
  const mock = new URLSearchParams(window.location.search).has('mock') || import.meta.env.VITE_MOCK === '1';
  return mock ? mockSource : httpSource;
}

const currentHash = () => (typeof window === 'undefined' ? '' : window.location.hash);

export function App({ initialHash, source = pickSource() }: { initialHash?: string; source?: Source } = {}) {
  const [route, setRoute] = useState<Route>(() => parseRoute(initialHash ?? currentHash()));
  const [ready, setReady] = useState(source.kind === 'mock');
  const [me, setMe] = useState<Me | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .init()
      .then(() => source.me())
      .then((u) => {
        if (!live) return;
        setMe(u);
        setReady(true);
      })
      .catch((e: Error) => live && setInitError(e.message));
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <SourceContext.Provider value={source}>
      <div className="min-h-screen">
        <nav className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <a href="#/" className="inline-flex items-center gap-2 font-semibold">
              <PlaneTakeoff size={20} className="text-accent" aria-hidden />
              Preflight
              <span className="hidden font-normal text-ink-3 sm:inline">· UMD readiness</span>
            </a>
            <div className="flex items-center gap-3 text-sm text-ink-2">
              {source.kind === 'mock' && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-3">Mock data</span>}
              {me && <span className="hidden sm:inline">{me.name}</span>}
              {source.kind === 'api' && me && (
                <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded p-1 text-ink-3 hover:text-ink">
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
          {initError && <Banner>Can't start: {initError}</Banner>}
          {ready &&
            (route.page === 'fleet' ? (
              <Fleet rules={DEFAULT_RULES} onOpen={(id) => go(`#/devices/${id}`)} />
            ) : (
              <DeviceDetailPage key={route.id} id={route.id} onBack={() => go('#/')} />
            ))}
        </main>
      </div>
    </SourceContext.Provider>
  );
}
