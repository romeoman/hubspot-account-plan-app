import type {
  SettingsResponse,
  SettingsUpdate,
  TestConnectionBody,
  TestConnectionResponse,
} from "@hap/config";
import { settingsResponseSchema } from "@hap/validators";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSettingsConnectionTester,
  createSettingsFetcher,
  createSettingsUpdater,
  type SettingsConnectionTester,
  type SettingsFetcher,
  type SettingsUpdater,
} from "./api-fetcher";

export type UseSettingsArgs = {
  fetchSettings?: SettingsFetcher;
  updateSettings?: SettingsUpdater;
  testConnection?: SettingsConnectionTester;
};

export type UseSettingsState = {
  settings: SettingsResponse | null;
  loading: boolean;
  saving: boolean;
  saveSucceeded: boolean;
  error?: Error;
  save: (update: SettingsUpdate) => Promise<void>;
  testConnection: (body: TestConnectionBody) => Promise<TestConnectionResponse>;
};

export function useSettings({
  fetchSettings,
  updateSettings,
  testConnection: testConnectionInjected,
}: UseSettingsArgs = {}): UseSettingsState {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const defaultFetcher = useMemo(() => createSettingsFetcher(), []);
  const defaultUpdater = useMemo(() => createSettingsUpdater(), []);
  const defaultTester = useMemo(() => createSettingsConnectionTester(), []);
  const activeFetcherRef = useRef<SettingsFetcher>(fetchSettings ?? defaultFetcher);
  const activeUpdaterRef = useRef<SettingsUpdater>(updateSettings ?? defaultUpdater);
  const activeTesterRef = useRef<SettingsConnectionTester>(testConnectionInjected ?? defaultTester);

  activeFetcherRef.current = fetchSettings ?? defaultFetcher;
  activeUpdaterRef.current = updateSettings ?? defaultUpdater;
  activeTesterRef.current = testConnectionInjected ?? defaultTester;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setSaveSucceeded(false);
    setSettings(null);

    activeFetcherRef
      .current()
      .then((raw) => {
        if (cancelled) return;
        const parsed = settingsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setError(new Error(`settings-validation-failed: ${parsed.error.message}`));
          setLoading(false);
          return;
        }
        setSettings(parsed.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (update: SettingsUpdate) => {
    setSaving(true);
    setError(undefined);
    setSaveSucceeded(false);
    try {
      const raw = await activeUpdaterRef.current(update);
      const parsed = settingsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`settings-validation-failed: ${parsed.error.message}`);
      }
      setSettings(parsed.data);
      setSaveSucceeded(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setSaveSucceeded(false);
    } finally {
      setSaving(false);
    }
  }, []);

  const testConnection = useCallback(
    async (body: TestConnectionBody): Promise<TestConnectionResponse> => {
      try {
        return await activeTesterRef.current(body);
      } catch (err: unknown) {
        return {
          ok: false,
          code: "network",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [],
  );

  return {
    settings,
    loading,
    saving,
    saveSucceeded,
    error,
    save,
    testConnection,
  };
}
