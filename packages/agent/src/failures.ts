import type { ProviderFailure } from '@edi/contracts';
import type { WorkerMessage } from './protocol';

export type FailureKind = Extract<WorkerMessage, { type: 'error' }>['kind'];

/** Reduce provider errors to a safe action category; request bodies and metadata never leave here. */
export function failureKind(error: unknown): FailureKind {
  const seen = new Set<unknown>();
  let value = error;
  for (let depth = 0; value && depth < 6 && !seen.has(value); depth++) {
    seen.add(value);
    if (typeof value === 'object') {
      const record = value as {
        statusCode?: unknown;
        status?: unknown;
        cause?: unknown;
        lastError?: unknown;
        message?: unknown;
        responseBody?: unknown;
      };
      // Classified here and never forwarded: some models fail to write many actions at once
      // (Gemini reports MALFORMED_FUNCTION_CALL), which retrying the same request won't fix.
      const said = `${String(record.message ?? '')} ${String(record.responseBody ?? '')}`;
      if (
        /malformed[\s_-]*function[\s_-]*call|invalid[\s_-]*(function|tool)[\s_-]*call/i.test(said)
      )
        return 'tools';
      const status = Number(record.statusCode ?? record.status);
      // OpenRouter answers 403 "Key limit exceeded" when the key's own spending cap is used up:
      // the key is fine, its limit needs raising.
      if (status === 403 && /key limit|limit exceeded/i.test(said)) return 'key-limit';
      if (status === 401 || status === 403) return 'auth';
      if (status === 402) return 'credits';
      if (status === 404 || status === 400 || status === 422) return 'model';
      if (status === 408 || status === 409 || status === 429 || status >= 500) return 'temporary';
      // The SDK's retry error keeps the last provider error beside, not inside, its cause.
      value = record.cause ?? record.lastError;
    } else break;
  }
  return 'unknown';
}

/** Links, addresses, quoted text, long numbers and the provider's secrets removed; short. */
function cleaned(value: unknown, secrets: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value;
  for (const secret of secrets) if (secret) text = text.split(secret).join('[key]');
  text = text
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b(sk|key|token|bearer)[-_ ][\w.-]{8,}/gi, '[secret]')
    .replace(/"[^"]*"|“[^”]*”|'[^']{2,}'/g, '"…"')
    .replace(/\b\d{7,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 240) : undefined;
}

/**
 * A safe summary of why a call failed: status, provider, error code and a cleaned message from
 * the provider's JSON error body (OpenRouter's shape). Deeper errors (the provider's own) win
 * over wrappers. Request bodies, prompts and headers are never read.
 */
export function failureDetail(
  error: unknown,
  step: number,
  secrets: readonly string[] = [],
): ProviderFailure {
  const detail: ProviderFailure = { step };
  const seen = new Set<unknown>();
  let value = error;
  for (
    let depth = 0;
    value && typeof value === 'object' && depth < 6 && !seen.has(value);
    depth++
  ) {
    seen.add(value);
    const record = value as {
      statusCode?: unknown;
      responseBody?: unknown;
      name?: unknown;
      cause?: unknown;
      lastError?: unknown;
      error?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const status = Number(record.statusCode);
    if (Number.isInteger(status) && status > 0 && status < 1000) detail.status = status;
    if (typeof record.name === 'string' && !detail.code) detail.code = record.name.slice(0, 80);
    // A streamed error chunk arrives as { error: { code, message, metadata } }.
    const body = (() => {
      if (typeof record.responseBody === 'string') {
        try {
          return (JSON.parse(record.responseBody) as { error?: unknown }).error;
        } catch {
          return undefined;
        }
      }
      return record.error && typeof record.error === 'object' ? record.error : undefined;
    })() as
      | { code?: unknown; message?: unknown; metadata?: { provider_name?: unknown; raw?: unknown } }
      | undefined;
    if (body) {
      if (typeof body.code === 'string' || typeof body.code === 'number')
        detail.code = String(body.code).slice(0, 80);
      if (typeof body.metadata?.provider_name === 'string')
        detail.provider = body.metadata.provider_name.slice(0, 80);
      // The provider's own words say more than "Provider returned error".
      let raw = body.metadata?.raw;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: unknown; status?: unknown } };
          raw = parsed.error?.message ?? parsed.error?.status ?? raw;
        } catch {
          // Plain text from the provider.
        }
      }
      detail.message = cleaned(raw, secrets) ?? cleaned(body.message, secrets) ?? detail.message;
    }
    value = record.cause ?? record.lastError;
  }
  return detail;
}
