import {
  LLM_CATALOG,
  type LlmCatalogEntry,
  type LlmProviderType,
  type SettingsResponse,
  type SettingsUpdate,
} from "@hap/config";
import {
  Button,
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
import { useEffect, useMemo, useRef, useState } from "react";
import type { SettingsFetcher, SettingsUpdater } from "./api-fetcher";
import { decimalToPercent, percentToDecimal } from "./percent-format";
import { useSettings } from "./use-settings";

const FRESHNESS_TOOLTIP =
  "Evidence older than this is treated as stale and won't feed the reason-to-contact.";
const MIN_CONFIDENCE_TOOLTIP =
  "Evidence below this confidence (0–100%) is dropped before it reaches the UI.";
const HUBSPOT_ENRICHMENT_EXPLAINER =
  "HubSpot enrichment uses your OAuth connection. No API key required.";
const OTHER_MODEL_VALUE = "__other__";

type ProviderSelection = LlmProviderType | "none";

type DraftState = {
  signalProviders: {
    exaEnabled: boolean;
    hubspotEnrichmentEnabled: boolean;
    exaApiKey: string;
    exaClearKey: boolean;
  };
  llm: {
    provider: ProviderSelection;
    /** Catalog value, or OTHER_MODEL_VALUE, or "" when unset. */
    modelSelection: string;
    /** Free-text model when modelSelection === OTHER_MODEL_VALUE. */
    modelOther: string;
    endpointUrl: string;
    apiKey: string;
    clearKey: boolean;
  };
  eligibilityPropertyName: string;
  freshnessMaxDays: number;
  minConfidence: number;
};

export type HubSpotSettingsPageProps = {
  fetchSettings?: SettingsFetcher;
  updateSettings?: SettingsUpdater;
};

const LLM_PROVIDER_OPTIONS: { label: string; value: ProviderSelection }[] = [
  { label: "None", value: "none" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Gemini", value: "gemini" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "Custom", value: "custom" },
];

const OTHER_MODEL_OPTION: { label: string; value: string } = {
  label: "Other (type manually)",
  value: OTHER_MODEL_VALUE,
};

function buildModelOptions(provider: ProviderSelection): { label: string; value: string }[] {
  if (provider === "none") {
    return [OTHER_MODEL_OPTION];
  }
  const catalog: LlmCatalogEntry[] = LLM_CATALOG[provider] ?? [];
  return [
    ...catalog.map((entry) => ({ label: entry.label, value: entry.value })),
    OTHER_MODEL_OPTION,
  ];
}

/**
 * Given the loaded provider + model, determine whether the model matches a
 * catalog entry (use it as-is) or should fall back to the "Other" escape
 * hatch (pre-populate the free-text input).
 */
function resolveInitialModelSelection(
  provider: ProviderSelection,
  storedModel: string,
): { modelSelection: string; modelOther: string } {
  if (!storedModel) {
    return { modelSelection: "", modelOther: "" };
  }
  if (provider === "none") {
    return { modelSelection: OTHER_MODEL_VALUE, modelOther: storedModel };
  }
  const catalog = LLM_CATALOG[provider] ?? [];
  const matched = catalog.some((entry) => entry.value === storedModel);
  if (matched) {
    return { modelSelection: storedModel, modelOther: "" };
  }
  return { modelSelection: OTHER_MODEL_VALUE, modelOther: storedModel };
}

function buildDraft(settings: SettingsResponse): DraftState {
  const provider: ProviderSelection = settings.llm.provider ?? "none";
  const { modelSelection, modelOther } = resolveInitialModelSelection(provider, settings.llm.model);

  return {
    signalProviders: {
      exaEnabled: settings.signalProviders.exa.enabled,
      hubspotEnrichmentEnabled: settings.signalProviders.hubspotEnrichment.enabled,
      exaApiKey: "",
      exaClearKey: false,
    },
    llm: {
      provider,
      modelSelection,
      modelOther,
      endpointUrl: provider === "custom" ? (settings.llm.endpointUrl ?? "") : "",
      apiKey: "",
      clearKey: false,
    },
    eligibilityPropertyName: settings.eligibility.propertyName,
    freshnessMaxDays: settings.thresholds.freshnessMaxDays,
    minConfidence: settings.thresholds.minConfidence,
  };
}

function resolveDraftModel(draft: DraftState): string {
  if (draft.llm.modelSelection === OTHER_MODEL_VALUE) {
    return draft.llm.modelOther.trim();
  }
  return draft.llm.modelSelection.trim();
}

export function HubSpotSettingsPage({ fetchSettings, updateSettings }: HubSpotSettingsPageProps) {
  const state = useSettings({ fetchSettings, updateSettings });
  const [draft, setDraft] = useState<DraftState | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  draftRef.current = draft;
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (state.settings) {
      setDraft(buildDraft(state.settings));
    }
  }, [state.settings]);

  const providerForOptions = draft?.llm.provider ?? "none";
  const modelOptions = useMemo(() => buildModelOptions(providerForOptions), [providerForOptions]);

  if (state.loading) {
    return <Text>Loading…</Text>;
  }

  if (state.error && (!draft || !state.settings)) {
    return <Text>{state.error.message}</Text>;
  }

  if (!draft || !state.settings) {
    return <Text>Loading…</Text>;
  }

  const saveSettings = async () => {
    const current = draftRef.current;
    if (!current) return;
    setValidationError(null);

    if (current.llm.provider === "custom" && current.llm.endpointUrl.trim().length === 0) {
      setValidationError("Custom provider requires an endpoint URL.");
      return;
    }

    if (
      current.llm.provider !== "none" &&
      current.llm.modelSelection === OTHER_MODEL_VALUE &&
      current.llm.modelOther.trim().length === 0
    ) {
      setValidationError("Model is required when using 'Other (type manually)'.");
      return;
    }

    const exaLeaf: SettingsUpdate["signalProviders"] extends infer _T
      ? NonNullable<SettingsUpdate["signalProviders"]>["exa"]
      : never = {
      enabled: current.signalProviders.exaEnabled,
      ...(current.signalProviders.exaClearKey
        ? { clearApiKey: true }
        : current.signalProviders.exaApiKey.trim().length > 0
          ? { apiKey: current.signalProviders.exaApiKey.trim() }
          : {}),
    };

    const update: SettingsUpdate = {
      signalProviders: {
        exa: exaLeaf,
        hubspotEnrichment: {
          enabled: current.signalProviders.hubspotEnrichmentEnabled,
        },
      },
      llm:
        current.llm.provider === "none"
          ? { provider: null }
          : {
              provider: current.llm.provider,
              model: resolveDraftModel(current),
              ...(current.llm.provider === "custom" && current.llm.endpointUrl.trim().length > 0
                ? { endpointUrl: current.llm.endpointUrl.trim() }
                : {}),
              ...(current.llm.clearKey
                ? { clearApiKey: true }
                : current.llm.apiKey.trim().length > 0
                  ? { apiKey: current.llm.apiKey.trim() }
                  : {}),
            },
      eligibility: {
        propertyName: current.eligibilityPropertyName,
      },
      thresholds: {
        freshnessMaxDays: current.freshnessMaxDays,
        minConfidence: current.minConfidence,
      },
    };

    await state.save(update);
  };

  const showEndpointUrl = draft.llm.provider === "custom";
  const showModelOther =
    draft.llm.provider !== "none" && draft.llm.modelSelection === OTHER_MODEL_VALUE;
  const exaHasStoredKey = state.settings.signalProviders.exa.hasApiKey;
  const llmHasStoredKey = state.settings.llm.hasApiKey;

  return (
    <Flex direction="column" gap="md">
      <Heading>Signal Providers</Heading>

      {/* Web research (Exa) */}
      <Heading>Web research (Exa)</Heading>
      <Toggle
        name="exaEnabled"
        label="Enable Exa"
        checked={draft.signalProviders.exaEnabled}
        onChange={(checked) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  signalProviders: {
                    ...current.signalProviders,
                    exaEnabled: checked,
                  },
                }
              : current,
          )
        }
      />
      {exaHasStoredKey ? <Text>Stored key on file</Text> : null}
      {/* Stable container for task 12d to append a Test-connection button */}
      <Flex direction="row" gap="sm" align="end">
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
                    signalProviders: {
                      ...current.signalProviders,
                      exaApiKey: value,
                      // Typing a new key cancels a pending clear intent
                      exaClearKey:
                        value.trim().length > 0 ? false : current.signalProviders.exaClearKey,
                    },
                  }
                : current,
            )
          }
        />
        {exaHasStoredKey ? (
          <Button
            testId="clearExaApiKey"
            variant="destructive"
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      signalProviders: {
                        ...current.signalProviders,
                        exaClearKey: true,
                        exaApiKey: "",
                      },
                    }
                  : current,
              )
            }
          >
            Clear key
          </Button>
        ) : null}
      </Flex>

      {/* HubSpot enrichment (OAuth, no API key) */}
      <Heading>HubSpot enrichment</Heading>
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
      <Text>{HUBSPOT_ENRICHMENT_EXPLAINER}</Text>

      <Divider />
      <Heading>LLM Settings</Heading>
      {llmHasStoredKey ? <Text>Stored key on file</Text> : null}
      <Select
        name="llmProvider"
        label="Provider"
        value={draft.llm.provider}
        options={LLM_PROVIDER_OPTIONS as unknown as { label: string; value: string }[]}
        onChange={(value) =>
          setDraft((current) => {
            if (!current) return current;
            const nextProvider = value as ProviderSelection;
            // Reset dependent fields on provider change
            return {
              ...current,
              llm: {
                ...current.llm,
                provider: nextProvider,
                modelSelection: "",
                modelOther: "",
                endpointUrl: nextProvider === "custom" ? current.llm.endpointUrl : "",
              },
            };
          })
        }
      />

      {draft.llm.provider !== "none" ? (
        <Select
          name="llmModel"
          label="Model"
          value={draft.llm.modelSelection || undefined}
          options={modelOptions}
          onChange={(value) =>
            setDraft((current) =>
              current
                ? {
                    ...current,
                    llm: {
                      ...current.llm,
                      modelSelection: value as string,
                      // Entering __other__ keeps any prior free-text value
                      modelOther: value === OTHER_MODEL_VALUE ? current.llm.modelOther : "",
                    },
                  }
                : current,
            )
          }
        />
      ) : null}

      {showModelOther ? (
        <Input
          name="llmModelOther"
          label="Model (manual)"
          value={draft.llm.modelOther}
          onChange={(value) =>
            setDraft((current) =>
              current
                ? {
                    ...current,
                    llm: { ...current.llm, modelOther: value },
                  }
                : current,
            )
          }
        />
      ) : null}

      {showEndpointUrl ? (
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
      ) : null}

      {/* Stable container for task 12d to append a Test-connection button */}
      <Flex direction="row" gap="sm" align="end">
        <Input
          name="llmApiKey"
          label="LLM API key"
          type="password"
          value={draft.llm.apiKey}
          onChange={(value) =>
            setDraft((current) =>
              current
                ? {
                    ...current,
                    llm: {
                      ...current.llm,
                      apiKey: value,
                      clearKey: value.trim().length > 0 ? false : current.llm.clearKey,
                    },
                  }
                : current,
            )
          }
        />
        {llmHasStoredKey ? (
          <Button
            testId="clearLlmApiKey"
            variant="destructive"
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      llm: {
                        ...current.llm,
                        clearKey: true,
                        apiKey: "",
                      },
                    }
                  : current,
              )
            }
          >
            Clear key
          </Button>
        ) : null}
      </Flex>

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
        tooltip={FRESHNESS_TOOLTIP}
        value={draft.freshnessMaxDays}
        onChange={(value) =>
          setDraft((current) => (current ? { ...current, freshnessMaxDays: value } : current))
        }
      />
      <NumberInput
        name="minConfidence"
        label="Minimum confidence (%)"
        tooltip={MIN_CONFIDENCE_TOOLTIP}
        value={decimalToPercent(draft.minConfidence)}
        onChange={(value) =>
          setDraft((current) =>
            current ? { ...current, minConfidence: percentToDecimal(value) } : current,
          )
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
