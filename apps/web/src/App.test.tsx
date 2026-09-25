import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App, parseRoute } from './App.js';
import { DEVICES } from './mock/devices.js';
import { MANUAL_ITEMS, RULES } from './mock/catalog.js';
import { viewDevice } from './data.js';

describe('routing', () => {
  it('parses fleet and device routes', () => {
    expect(parseRoute('')).toEqual({ page: 'fleet' });
    expect(parseRoute('#/devices/dev-1378')).toEqual({ page: 'device', id: 'dev-1378' });
    expect(parseRoute('#/devices/../../x')).toEqual({ page: 'fleet' });
  });
});

describe('App shell', () => {
  it('renders the fleet with every device', () => {
    const html = renderToString(<App initialHash="" />);
    expect(html).toContain('Preflight');
    for (const d of DEVICES) expect(html).toContain(d.assetTag);
  });

  it('renders a device checklist with every stage', () => {
    const html = renderToString(<App initialHash="#/devices/dev-1402" />);
    expect(html).toContain('QJ06811402');
    expect(html).toContain('4 TB drive detected');
    expect(html).toContain('0 disks found');
  });

  it('shows not-found for unknown device', () => {
    expect(renderToString(<App initialHash="#/devices/nope" />)).toContain('Device not found');
  });
});

describe('mock data integrity', () => {
  const ruleIds = new Set(RULES.map((r) => r.id));
  const itemIds = new Set(MANUAL_ITEMS.map((i) => i.id));

  it('rule and manual item ids are unique', () => {
    expect(ruleIds.size).toBe(RULES.length);
    expect(itemIds.size).toBe(MANUAL_ITEMS.length);
  });

  it('every result and attestation points at a real rule/item', () => {
    for (const d of DEVICES) {
      for (const r of d.results) expect(ruleIds.has(r.ruleId)).toBe(true);
      for (const a of d.attestations) expect(a.itemId ? itemIds.has(a.itemId) : ruleIds.has(a.ruleId!)).toBe(true);
    }
  });

  it('fleet covers every readiness state', () => {
    const states = new Set(DEVICES.map((d) => viewDevice(d).display));
    expect([...states].sort()).toEqual(['degraded', 'in-progress', 'not-ready', 'ready', 'stale']);
  });
});
