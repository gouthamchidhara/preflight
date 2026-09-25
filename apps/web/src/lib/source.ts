/**
 * The dashboard's only data access. `httpSource` talks to the API; `mockSource` (lib/mock.ts)
 * implements the same interface for tests, screenshots and `?mock` demos.
 */
import type { DeviceDetail, DeviceSummary, JobView } from '@umd/contracts';
import { bearer, initAuth, type ServerConfig } from './auth.js';

export type Stage = 'image' | 'config' | 'hardware' | 'bios';
export interface Me {
  name: string;
  roles: string[];
}

export interface Source {
  kind: 'api' | 'mock';
  init(): Promise<void>;
  me(): Promise<Me>;
  listDevices(): Promise<DeviceSummary[]>;
  getDevice(id: string): Promise<DeviceDetail | null>;
  attest(deviceId: string, body: { itemId?: string; ruleId?: string; note?: string }): Promise<void>;
  revokeAttestation(deviceId: string, attId: string): Promise<void>;
  runNow(deviceId: string, stage?: Stage): Promise<void>;
  createJob(deviceId: string, scriptId: string, params: Record<string, unknown>, ruleId?: string): Promise<JobView>;
  getJob(jobId: string): Promise<JobView>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = await bearer();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data && (data.error as string)) || `${res.status} ${res.statusText}`);
  return data as T;
}

export const httpSource: Source = {
  kind: 'api',
  async init() {
    const cfg = await call<ServerConfig>('GET', '/api/v1/config');
    await initAuth(cfg);
  },
  me: () => call('GET', '/api/v1/me'),
  listDevices: () => call('GET', '/api/v1/devices'),
  getDevice: async (id) => {
    try {
      return await call<DeviceDetail>('GET', `/api/v1/devices/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  attest: async (id, body) => void (await call('POST', `/api/v1/devices/${id}/attestations`, body)),
  revokeAttestation: async (id, attId) => void (await call('DELETE', `/api/v1/devices/${id}/attestations/${attId}`)),
  runNow: async (id, stage) => void (await call('POST', `/api/v1/devices/${id}/run`, stage ? { stage } : {})),
  createJob: (id, scriptId, params, ruleId) => call('POST', `/api/v1/devices/${id}/jobs`, { scriptId, params, ...(ruleId ? { ruleId } : {}) }),
  getJob: (jobId) => call('GET', `/api/v1/jobs/${jobId}`),
};
