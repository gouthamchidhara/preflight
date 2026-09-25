/**
 * Server client. Every response is validated with the shared contracts.
 */

import { CheckinResponse, EnrollResponse, Rule, type Checkin, type Run } from '@umd/contracts';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PolicyResponse = z.object({ policyVersion: z.number(), rules: z.array(Rule) });

export class ApiClient {
  constructor(
    private baseUrl: string,
    private key: () => string | null,
    private timeoutMs = 20_000,
  ) {}

  private async call<T extends z.ZodTypeAny>(method: string, path: string, schema: T, body?: unknown, auth = true): Promise<z.infer<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      const k = this.key();
      if (!k) throw new HttpError(401, 'not enrolled');
      headers['x-device-key'] = k;
    }
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    const parsed = schema.safeParse(text ? JSON.parse(text) : {});
    if (!parsed.success) throw new Error(`${method} ${path}: unexpected response (${parsed.error.issues[0]?.message})`);
    return parsed.data;
  }

  enroll(body: { bootstrapToken: string; hostname: string; serial: string; assetTag: string; model: string }) {
    return this.call('POST', '/api/agent/v1/enroll', EnrollResponse, body, false);
  }
  checkin(body: Checkin) {
    return this.call('POST', '/api/agent/v1/checkin', CheckinResponse, body);
  }
  policy() {
    return this.call('GET', '/api/agent/v1/policy', PolicyResponse);
  }
  postRun(run: Run) {
    return this.call('POST', '/api/agent/v1/runs', z.object({ ok: z.boolean() }).passthrough(), run);
  }
  postJobResult(id: string, body: { status: 'succeeded' | 'failed' | 'timed_out'; exitCode: number | null; stdout: string; stderr: string }) {
    return this.call('POST', `/api/agent/v1/jobs/${id}/result`, z.object({ ok: z.boolean() }).passthrough(), body);
  }
}




