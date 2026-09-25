import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DEFAULT_RULES, MANUAL_ITEMS } from '@umd/contracts';
import { parseRoute, App } from './App.js';
import { FleetView } from './pages/Fleet.js';
import { DeviceView, type DeviceActions } from './pages/Device.js';
import { DEVICES } from './mock/devices.js';
import { mockDetail, mockSource, mockSummary } from './lib/mock.js';

const noop: DeviceActions = { busy: false, attestRule() {}, toggleItem() {}, revoke() {}, fix() {}, runAll() {} };

describe('routing', () => {
  it('parses fleet and device routes; rejects junk', () => {
    expect(parseRoute('')).toEqual({ page: 'fleet' });
    expect(parseRoute('#/devices/dev-1378')).toEqual({ page: 'device', id: 'dev-1378' });
    expect(parseRoute('#/devices/../../x')).toEqual({ page: 'fleet' });
  });
});

describe('views', () => {
  it('shell renders with the brand', () => {
    expect(renderToString(<App initialHash="" source={mockSource} />)).toContain('Preflight');
  });

  it('fleet lists every device', () => {
    const html = renderToString(<FleetView devices={DEVICES.map(mockSummary)} rules={DEFAULT_RULES} onOpen={() => {}} />);
    for (const d of DEVICES) expect(html).toContain(d.assetTag);
    expect(html).toContain('Waiting on');
  });

  it('empty fleet explains how to enroll', () => {
    expect(renderToString(<FleetView devices={[]} rules={DEFAULT_RULES} onOpen={() => {}} />)).toContain('PreflightAgent.exe enroll');
  });

  it('device view shows the 4 TB failure with its hint', () => {
    const html = renderToString(<DeviceView d={mockDetail(DEVICES.find((d) => d.id === 'dev-1402')!)} actions={noop} onBack={() => {}} />);
    expect(html).toContain('QJ06811402');
    expect(html).toContain('4 TB drive detected');
    expect(html).toContain('0 disks found');
    expect(html).toContain('reseat the caddy');
  });

  it('server-side checks (buildstats) show as needs human, not stuck', () => {
    const html = renderToString(<DeviceView d={mockDetail(DEVICES[0]!)} actions={noop} onBack={() => {}} />);
    expect(html).toContain('Imaging finished (buildstats green)');
  });
});

describe('mock source behaves like the API', () => {
  it('attesting the last open items flips a device to ready; undo flips it back', async () => {
    const id = 'dev-1462'; // in-progress: bios.settings needs_human + bios/register manual items open
    const before = (await mockSource.getDevice(id))!;
    expect(before.readiness).toBe('in-progress');
    await mockSource.attest(id, { ruleId: 'bios.settings' });
    await mockSource.attest(id, { ruleId: 'tbx.launch' });
    await mockSource.attest(id, { ruleId: 'img.buildstats' });
    await mockSource.attest(id, { ruleId: 'umd.conformance' });
    for (const item of MANUAL_ITEMS.filter((i) => i.stage === 'bios' || i.stage === 'register')) await mockSource.attest(id, { itemId: item.id });
    const after = (await mockSource.getDevice(id))!;
    expect(after.readiness).toBe('ready');
    const att = after.attestations.find((a) => a.ruleId === 'bios.settings')!;
    await mockSource.revokeAttestation(id, att.id);
    expect((await mockSource.getDevice(id))!.readiness).toBe('in-progress');
  });

  it('mock data only references real rules and manual items', () => {
    const ruleIds = new Set(DEFAULT_RULES.map((r) => r.id));
    const itemIds = new Set(MANUAL_ITEMS.map((i) => i.id));
    for (const d of DEVICES) {
      for (const r of d.results) expect(ruleIds.has(r.ruleId)).toBe(true);
      for (const a of d.attestations) expect(a.itemId ? itemIds.has(a.itemId) : ruleIds.has(a.ruleId!)).toBe(true);
    }
  });

  it('mock fleet covers every readiness state', () => {
    const states = new Set(DEVICES.map((d) => mockSummary(d).display));
    expect([...states].sort()).toEqual(['degraded', 'in-progress', 'not-ready', 'ready', 'stale']);
  });
});
