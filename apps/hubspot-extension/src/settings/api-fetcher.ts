import type {
  SettingsResponse,
  SettingsUpdate,
  TestConnectionBody,
  TestConnectionResponse,
} from "@hap/config";
import { hubspot } from "@hubspot/ui-extensions";

export const DEFAULT_API_BASE_URL = "https://hap-signal-workspace.vercel.app";

export class SettingsApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`settings-fetch-failed: ${status} ${statusText}`);
    this.name = "SettingsApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

export type SettingsFetcher = () => Promise<unknown>;
export type SettingsUpdater = (update: SettingsUpdate) => Promise<unknown>;
export type SettingsConnectionTester = (
  body: TestConnectionBody,
) => Promise<TestConnectionResponse>;

export function createSettingsFetcher(baseUrl = DEFAULT_API_BASE_URL): SettingsFetcher {
  return async () => {
    const response = await hubspot.fetch(`${baseUrl}/api/settings`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new SettingsApiError(response.status, response.statusText);
    }

    return await response.json();
  };
}

export function createSettingsUpdater(baseUrl = DEFAULT_API_BASE_URL): SettingsUpdater {
  return async (update) => {
    const response = await hubspot.fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      body: update as unknown as Record<string, unknown>,
    });

    if (!response.ok) {
      throw new SettingsApiError(response.status, response.statusText);
    }

    return (await response.json()) as SettingsResponse;
  };
}

export function createSettingsConnectionTester(
  baseUrl = DEFAULT_API_BASE_URL,
): SettingsConnectionTester {
  return async (body) => {
    const response = await hubspot.fetch(`${baseUrl}/api/settings/test-connection`, {
      method: "POST",
      body: body as unknown as Record<string, unknown>,
    });

    if (response.status === 429) {
      return {
        ok: false,
        code: "rate_limit",
        message: "Too many requests.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: "unknown",
        message: `Request failed: ${response.status} ${response.statusText}`,
      };
    }

    return (await response.json()) as TestConnectionResponse;
  };
}
