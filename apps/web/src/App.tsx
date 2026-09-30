/**
 * App shell (PLAN.md §3, T7). Sidebar navigation + hash routes:
 * #/ (fleet), #/fixes, #/checks, #/activity, #/devices/:id.
 * Data: live API by default; `?mock` in the URL (or VITE_MOCK=1) uses the built-in demo fleet.
 */
import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { DEFAULT_RULES } from '@umd/contracts';
import { Fleet } from './pages/Fleet.js';
import { DeviceDetailPage } from './pages/Device.js';
import { FixCenter } from './pages/FixCenter.js';
import { Checks } from './pages/Checks.js';
import { Activity } from './pages/Activity.js';
import { SourceContext } from './lib/context.js';
import { httpSource, type Me, type Source } from './lib/source.js';
import { mockSource } from './lib/mock.js';
import { usePoll } from './lib/usePoll.js';
import { Sidebar } from './components/Sidebar.js';
import { Banner } from './components/Banner.js';

type Route = { page: 'fleet' } | { page: 'fixes' } | { page: 'checks' } | { page: 'activity' } | { page: 'device'; id: string };

export function parseRoute(hash: string): Route {
  const device = /^#\/devices\/([\w-]+)$/.exec(hash);
  if (device) return { page: 'device', id: device[1]! };
  const section = /^#\/(fixes|checks|activity)$/.exec(hash);
  if (section) return { page: section[1] as 'fixes' | 'checks' | 'activity' };
  return { page: 'fleet' };
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
  const [navOpen, setNavOpen] = useState(false);

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
      setNavOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Sidebar badges; polled separately so each page keeps owning its own data.
  const { data: fleet } = usePoll(() => (ready ? source.listDevices() : Promise.resolve([])), 30_000, [source, ready]);
  const counts = {
    devices: fleet?.length ?? 0,
    issues: fleet?.reduce((n, d) => n + d.failing.length, 0) ?? 0,
  };

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <SourceContext.Provider value={source}>
      <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
        <Sidebar page={route.page} me={me} sourceKind={source.kind} counts={counts} open={navOpen} onClose={() => setNavOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className="rounded p-1 text-ink-2 hover:text-ink">
              <Menu size={20} />
            </button>
            <span className="font-semibold">Preflight</span>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6">
            {initError && <Banner>Can't start: {initError}</Banner>}
            {ready && route.page === 'fleet' && <Fleet rules={DEFAULT_RULES} onOpen={(id) => go(`#/devices/${id}`)} />}
            {ready && route.page === 'fixes' && <FixCenter onOpen={(id) => go(`#/devices/${id}`)} />}
            {ready && route.page === 'checks' && <Checks rules={DEFAULT_RULES} />}
            {ready && route.page === 'activity' && <Activity onOpen={(id) => go(`#/devices/${id}`)} />}
            {ready && route.page === 'device' && <DeviceDetailPage key={route.id} id={route.id} onBack={() => go('#/')} />}
          </main>
        </div>
      </div>
    </SourceContext.Provider>
  );
}
