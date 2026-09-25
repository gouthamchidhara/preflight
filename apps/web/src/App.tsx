/**
 * App shell (PLAN.md §3, T7). Hash routes: #/ (fleet) and #/devices/:id.
 * TODO(T6): MSAL sign-in; data source switches from mock to API.
 */
import { useEffect, useState } from 'react';
import { PlaneTakeoff } from 'lucide-react';
import { Fleet } from './pages/Fleet.js';
import { DeviceDetail } from './pages/Device.js';

type Route = { page: 'fleet' } | { page: 'device'; id: string };

export function parseRoute(hash: string): Route {
  const m = /^#\/devices\/([\w-]+)$/.exec(hash);
  return m ? { page: 'device', id: m[1]! } : { page: 'fleet' };
}

const currentHash = () => (typeof window === 'undefined' ? '' : window.location.hash);

export function App({ initialHash }: { initialHash?: string } = {}) {
  const [route, setRoute] = useState<Route>(() => parseRoute(initialHash ?? currentHash()));

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
    <div className="min-h-screen">
      <nav className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="#/" className="inline-flex items-center gap-2 font-semibold">
            <PlaneTakeoff size={20} className="text-accent" aria-hidden />
            Preflight
            <span className="font-normal text-ink-3">· UMD readiness</span>
          </a>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-3">Mock data</span>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {route.page === 'fleet' ? (
          <Fleet onOpen={(id) => go(`#/devices/${id}`)} />
        ) : (
          <DeviceDetail key={route.id} id={route.id} onBack={() => go('#/')} />
        )}
      </main>
    </div>
  );
}
