import type { SettingsResponse, SettingsUpdate } from "@hap/config";
import { settingsResponseSchema } from "@hap/validators";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSettingsFetcher,
  createSettingsUpdater,
  type SettingsFetcher,
  type SettingsUpdater,
} from "./api-fetcher";

export type UseSettingsArgs = {
  fetchSettings?: SettingsFetcher;
  updateSettings?: SettingsUpdater;
};

export type UseSettingsState = {
  settings: SettingsResponse | null;
  loading: boolean;
  saving: boolean;
  saveSucceeded: boolean;
  error?: Error;
  save: (update: SettingsUpdate) => Promise<void>;
};

export function useSettings({
  fetchSettings,
  updateSettings,
}: UseSettingsArgs = {}): UseSettingsState {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const defaultFetcher = useMemo(() => createSettingsFetcher(), []);
  const defaultUpdater = useMemo(() => createSettingsUpdater(), []);
  const activeFetcherRef = useRef<SettingsFetcher>(fetchSettings ?? defaultFetcher);
  const activeUpdaterRef = useRef<SettingsUpdater>(updateSettings ?? defaultUpdater);

  activeFetcherRef.current = fetchSettings ?? defaultFetcher;
  activeUpdaterRef.current = updateSettings ?? defaultUpdater;

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

  return {
    settings,
    loading,
    saving,
    saveSucceeded,
    error,
    save,
  };
}
