/**
 * In-memory Source over the deterministic mock fleet. Mutations behave like the API
 * (attest/revoke/jobs), so the whole UI can be exercised without a server.
 */
import { randomId } from './random.js';
import {
  DEFAULT_RULES,
  MANUAL_ITEMS,
  summarizeDevice,
  withSyntheticResults,
  type AttestationView,
  type DeviceDetail,
  type DeviceIdentity,
  type JobView,
} from '@umd/contracts';
import { DEVICES, type Device } from '../mock/devices.js';
import type { Source } from './source.js';

const atts = new Map<string, AttestationView[]>(
  DEVICES.map((d) => [d.id, d.attestations.map((a, i) => ({ ...a, id: `${d.id}-att-${i}` }))]),
);
const jobs = new Map<string, JobView & { deviceId: string }>();

const identity = (d: Device): DeviceIdentity => ({
  id: d.id,
  assetTag: d.assetTag,
  serial: d.serial,
  hostname: d.hostname,
  model: d.model,
  agentVersion: d.agentVersion,
  osBuild: d.osBuild,
  lastSeenAt: d.lastSeenAt,
  telemetry: d.telemetry,
});

export function mockSummary(d: Device) {
  return summarizeDevice(identity(d), DEFAULT_RULES, d.results, MANUAL_ITEMS, atts.get(d.id) ?? []);
}

export function mockDetail(d: Device): DeviceDetail {
  return {
    ...mockSummary(d),
    rules: DEFAULT_RULES,
    results: withSyntheticResults(DEFAULT_RULES, d.results),
    manualItems: MANUAL_ITEMS,
    attestations: atts.get(d.id) ?? [],
    jobs: [...jobs.values()].filter((j) => j.deviceId === d.id).reverse(),
    lastRunAt: d.results.reduce((m, r) => (r.checkedAt > m ? r.checkedAt : m), ''),
  };
}

export const mockSource: Source = {
  kind: 'mock',
  async init() {},
  async me() {
    return { name: 'demo.tech', roles: ['Admin'] };
  },
  async listDevices() {
    return DEVICES.map(mockSummary);
  },
  async getDevice(id) {
    const d = DEVICES.find((x) => x.id === id);
    return d ? mockDetail(d) : null;
  },
  async attest(deviceId, body) {
    const list = (atts.get(deviceId) ?? []).filter((a) => !(body.itemId && a.itemId === body.itemId) && !(body.ruleId && a.ruleId === body.ruleId));
    atts.set(deviceId, [...list, { id: randomId(), ...body, by: 'demo.tech', at: new Date().toISOString() }]);
  },
  async revokeAttestation(deviceId, attId) {
    atts.set(deviceId, (atts.get(deviceId) ?? []).filter((a) => a.id !== attId));
  },
  async runNow() {},
  async createJob(deviceId, scriptId, _params, ruleId) {
    const job = { id: randomId(), deviceId, scriptId, ...(ruleId ? { ruleId } : {}), status: 'queued' as const, createdBy: 'demo.tech', createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    return job;
  },
  async getJob(jobId) {
    const j = jobs.get(jobId);
    if (!j) throw new Error('no such job');
    return j;
  },
};
