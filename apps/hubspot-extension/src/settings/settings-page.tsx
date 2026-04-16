import type { LlmProviderType, SettingsResponse, SettingsUpdate } from "@hap/config";
import {
  Divider,
  Flex,
  Heading,
  Input,
  LoadingButton,
  NumberInput,
  Select,
  Text,
  Toggle,
} from "@hubspot/ui-extensions";
import { useEffect, useState } from "react";
import type { SettingsFetcher, SettingsUpdater } from "./api-fetcher";
import { useSettings } from "./use-settings";

type DraftState = {
  signalProviders: {
    exaEnabled: boolean;
    newsEnabled: boolean;
    hubspotEnrichmentEnabled: boolean;
    exaApiKey: string;
    newsApiKey: string;
    hubspotEnrichmentApiKey: string;
  };
  llm: {
    provider: LlmProviderType | "none";
    model: string;
    endpointUrl: string;
    apiKey: string;
  };
  eligibilityPropertyName: string;
  freshnessMaxDays: number;
  minConfidence: number;
};

export type HubSpotSettingsPageProps = {
  fetchSettings?: SettingsFetcher;
  updateSettings?: SettingsUpdater;
};

const LLM_PROVIDER_OPTIONS = [
  { label: "None", value: "none" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Gemini", value: "gemini" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "Custom", value: "custom" },
] as const;

function buildDraft(settings: SettingsResponse): DraftState {
  return {
    signalProviders: {
      exaEnabled: settings.signalProviders.exa.enabled,
      newsEnabled: settings.signalProviders.news.enabled,
      hubspotEnrichmentEnabled: settings.signalProviders.hubspotEnrichment.enabled,
      exaApiKey: "",
      newsApiKey: "",
      hubspotEnrichmentApiKey: "",
    },
    llm: {
      provider: settings.llm.provider ?? "none",
      model: settings.llm.model,
      endpointUrl: settings.llm.endpointUrl ?? "",
      apiKey: "",
    },
    eligibilityPropertyName: settings.eligibility.propertyName,
    freshnessMaxDays: settings.thresholds.freshnessMaxDays,
    minConfidence: settings.thresholds.minConfidence,
  };
}

export function HubSpotSettingsPage({ fetchSettings, updateSettings }: HubSpotSettingsPageProps) {
  const state = useSettings({ fetchSettings, updateSettings });
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (state.settings) {
      setDraft(buildDraft(state.settings));
    }
  }, [state.settings]);

  if (state.loading || !draft || !state.settings) {
    return <Text>Loading…</Text>;
  }

  const saveSettings = async () => {
    setValidationError(null);
    if (draft.llm.provider === "custom" && draft.llm.endpointUrl.trim().length === 0) {
      setValidationError("Custom provider requires an endpoint URL.");
      return;
    }

    const update: SettingsUpdate = {
      signalProviders: {
        exa: {
          enabled: draft.signalProviders.exaEnabled,
          ...(draft.signalProviders.exaApiKey.trim().length > 0
            ? { apiKey: draft.signalProviders.exaApiKey.trim() }
            : {}),
        },
        news: {
          enabled: draft.signalProviders.newsEnabled,
          ...(draft.signalProviders.newsApiKey.trim().length > 0
            ? { apiKey: draft.signalProviders.newsApiKey.trim() }
            : {}),
        },
        hubspotEnrichment: {
          enabled: draft.signalProviders.hubspotEnrichmentEnabled,
          ...(draft.signalProviders.hubspotEnrichmentApiKey.trim().length > 0
            ? { apiKey: draft.signalProviders.hubspotEnrichmentApiKey.trim() }
            : {}),
        },
      },
      llm:
        draft.llm.provider === "none"
          ? { provider: null }
          : {
              provider: draft.llm.provider,
              model: draft.llm.model,
              ...(draft.llm.endpointUrl.trim().length > 0
                ? { endpointUrl: draft.llm.endpointUrl.trim() }
                : {}),
              ...(draft.llm.apiKey.trim().length > 0 ? { apiKey: draft.llm.apiKey.trim() } : {}),
            },
      eligibility: {
        propertyName: draft.eligibilityPropertyName,
      },
      thresholds: {
        freshnessMaxDays: draft.freshnessMaxDays,
        minConfidence: draft.minConfidence,
      },
    };

    await state.save(update);
  };

  return (
    <Flex direction="column" gap="md">
      <Heading>Signal Providers</Heading>
      <Toggle
        name="exaEnabled"
        label="Enable Exa"
        checked={draft.signalProviders.exaEnabled}
        onChange={(checked) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: { ...current.signalProviders, exaEnabled: checked },
                }
              : current,
          )
        }
      />
      {state.settings.signalProviders.exa.hasApiKey ? <Text>Stored key on file</Text> : null}
      <Input
        name="exaApiKey"
        label="Exa API key"
        type="password"
        value={draft.signalProviders.exaApiKey}
        onChange={(value) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: { ...current.signalProviders, exaApiKey: value },
                }
              : current,
          )
        }
      />
      <Toggle
        name="newsEnabled"
        label="Enable News"
        checked={draft.signalProviders.newsEnabled}
        onChange={(checked) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: { ...current.signalProviders, newsEnabled: checked },
                }
              : current,
          )
        }
      />
      <Input
        name="newsApiKey"
        label="News API key"
        type="password"
        value={draft.signalProviders.newsApiKey}
        onChange={(value) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: { ...current.signalProviders, newsApiKey: value },
                }
              : current,
          )
        }
      />
      <Toggle
        name="hubspotEnrichmentEnabled"
        label="Enable HubSpot enrichment"
        checked={draft.signalProviders.hubspotEnrichmentEnabled}
        onChange={(checked) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: {
                    ...current.signalProviders,
                    hubspotEnrichmentEnabled: checked,
                  },
                }
              : current,
          )
        }
      />

      <Divider />
      <Heading>LLM Settings</Heading>
      {state.settings.llm.hasApiKey ? <Text>Stored key on file</Text> : null}
      <Select
        name="llmProvider"
        label="Provider"
        value={draft.llm.provider}
        options={LLM_PROVIDER_OPTIONS as unknown as { label: string; value: string }[]}
        onChange={(value) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  llm: { ...current.llm, provider: value as DraftState["llm"]["provider"] },
                }
              : current,
          )
        }
      />
      <Input
        name="llmModel"
        label="Model"
        value={draft.llm.model}
        onChange={(value) =>
          setDraft((current) =>
            current ? { ...current, llm: { ...current.llm, model: value } } : current,
          )
        }
      />
      <Input
        name="llmEndpointUrl"
        label="Endpoint URL"
        value={draft.llm.endpointUrl}
        onChange={(value) =>
          setDraft((current) =>
            current ? { ...current, llm: { ...current.llm, endpointUrl: value } } : current,
          )
        }
      />
      <Input
        name="llmApiKey"
        label="LLM API key"
        type="password"
        value={draft.llm.apiKey}
        onChange={(value) =>
          setDraft((current) =>
            current ? { ...current, llm: { ...current.llm, apiKey: value } } : current,
          )
        }
      />

      <Divider />
      <Heading>Eligibility</Heading>
      <Input
        name="eligibilityPropertyName"
        label="Eligibility property"
        value={draft.eligibilityPropertyName}
        onChange={(value) =>
          setDraft((current) =>
            current ? { ...current, eligibilityPropertyName: value } : current,
          )
        }
      />

      <Divider />
      <Heading>Thresholds</Heading>
      <NumberInput
        name="freshnessMaxDays"
        label="Freshness max days"
        value={draft.freshnessMaxDays}
        onChange={(value) =>
          setDraft((current) => (current ? { ...current, freshnessMaxDays: value } : current))
        }
      />
      <NumberInput
        name="minConfidence"
        label="Minimum confidence"
        value={draft.minConfidence}
        onChange={(value) =>
          setDraft((current) => (current ? { ...current, minConfidence: value } : current))
        }
      />

      {validationError ? <Text>{validationError}</Text> : null}
      {state.error ? <Text>{state.error.message}</Text> : null}
      {state.saveSucceeded ? <Text>Settings saved.</Text> : null}

      <LoadingButton loading={state.saving} onClick={() => void saveSettings()}>
        Save settings
      </LoadingButton>
    </Flex>
  );
}
