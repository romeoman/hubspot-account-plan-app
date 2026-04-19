import {
  Button,
  Heading,
  Input,
  LoadingButton,
  NumberInput,
  Select,
  Text,
  Toggle,
} from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { HubSpotSettingsPage } from "../settings-page";

function triggerValue(node: unknown, value: unknown) {
  (
    node as {
      trigger: (eventPropName: "onChange", eventArg?: unknown) => void;
    }
  ).trigger("onChange", value);
}

const VALID_SETTINGS = {
  tenantId: "tenant-1",
  signalProviders: {
    exa: { enabled: true, hasApiKey: true },
    hubspotEnrichment: { enabled: true, hasApiKey: false },
  },
  llm: {
    provider: "openai" as const,
    model: "gpt-5.4-mini",
    hasApiKey: true,
  },
  eligibility: {
    propertyName: "hs_is_target_account",
  },
  thresholds: {
    freshnessMaxDays: 30,
    minConfidence: 0.5,
  },
};

function findOptional<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

describe("HubSpotSettingsPage", () => {
  it("renders the settings sections and stored-secret indicators after load", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.findAll(Heading).length).toBeGreaterThanOrEqual(4);
    });

    const headings = renderer.findAll(Heading).map((node) => node.text ?? "");
    expect(headings).toContain("Signal Providers");
    expect(headings).toContain("LLM Settings");
    expect(headings).toContain("Eligibility");
    expect(headings).toContain("Thresholds");

    const allText = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(allText).toContain("Stored key on file");
  });

  it("does NOT render a News toggle or News API key input", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    expect(findOptional(() => renderer.find(Toggle, { name: "newsEnabled" }))).toBeUndefined();
    expect(findOptional(() => renderer.find(Input, { name: "newsApiKey" }))).toBeUndefined();
  });

  it("does NOT render a HubSpot enrichment API key input and shows an OAuth explainer", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    expect(
      findOptional(() => renderer.find(Input, { name: "hubspotEnrichmentApiKey" })),
    ).toBeUndefined();

    const allText = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(allText).toMatch(/OAuth/i);
  });

  it("hides the Endpoint URL input unless provider is 'custom'", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    // openai is the loaded provider — endpoint URL MUST NOT render
    expect(findOptional(() => renderer.find(Input, { name: "llmEndpointUrl" }))).toBeUndefined();

    // Switch to custom — endpoint URL appears
    triggerValue(renderer.find(Select, { name: "llmProvider" }), "custom");
    await renderer.waitFor(() => {
      expect(renderer.find(Input, { name: "llmEndpointUrl" })).toBeTruthy();
    });

    // Switch back to anthropic — endpoint URL gone again
    triggerValue(renderer.find(Select, { name: "llmProvider" }), "anthropic");
    await renderer.waitFor(() => {
      expect(findOptional(() => renderer.find(Input, { name: "llmEndpointUrl" }))).toBeUndefined();
    });
  });

  it("switches the Model dropdown options when the Provider changes", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    // Loaded provider is openai — model select should expose gpt-5.4 values
    const openaiModelSelect = renderer.find(Select, { name: "llmModel" });
    const openaiValues = (openaiModelSelect.props.options as { value: string }[]).map(
      (o) => o.value,
    );
    expect(openaiValues).toContain("gpt-5.4");
    expect(openaiValues).toContain("gpt-5.4-mini");
    expect(openaiValues).toContain("__other__");
    expect(openaiValues).not.toContain("claude-opus-4-7");

    // Switch to anthropic — model select options change to claude models
    triggerValue(renderer.find(Select, { name: "llmProvider" }), "anthropic");
    await renderer.waitFor(() => {
      const sel = renderer.find(Select, { name: "llmModel" });
      const values = (sel.props.options as { value: string }[]).map((o) => o.value);
      expect(values).toContain("claude-opus-4-7");
      expect(values).not.toContain("gpt-5.4");
    });
  });

  it("reveals a free-text model input when the user picks 'Other (type manually)'", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    // Free-text model input should NOT exist yet
    expect(findOptional(() => renderer.find(Input, { name: "llmModelOther" }))).toBeUndefined();

    triggerValue(renderer.find(Select, { name: "llmModel" }), "__other__");

    await renderer.waitFor(() => {
      expect(renderer.find(Input, { name: "llmModelOther" })).toBeTruthy();
    });
  });

  it("posts { clearApiKey: true } when the user clicks Clear on the Exa key", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    renderer.findByTestId(Button, "clearExaApiKey").trigger("onClick");
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    const call = (
      updateSettings.mock.calls as unknown as [
        {
          signalProviders?: {
            exa?: { clearApiKey?: boolean; apiKey?: string };
          };
        },
      ][]
    )[0];
    if (!call) throw new Error("updateSettings not called");
    const payload = call[0];
    expect(payload.signalProviders?.exa?.clearApiKey).toBe(true);
    expect(payload.signalProviders?.exa?.apiKey).toBeUndefined();
  });

  it("posts { clearApiKey: true } when the user clicks Clear on the LLM key", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    renderer.findByTestId(Button, "clearLlmApiKey").trigger("onClick");
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    const call = (
      updateSettings.mock.calls as unknown as [
        { llm?: { clearApiKey?: boolean; apiKey?: string } },
      ][]
    )[0];
    if (!call) throw new Error("updateSettings not called");
    const payload = call[0];
    expect(payload.llm?.clearApiKey).toBe(true);
    expect(payload.llm?.apiKey).toBeUndefined();
  });

  it("sends the expected settings payload when the user edits and saves", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => ({
      ...VALID_SETTINGS,
      llm: {
        provider: "custom" as const,
        model: "custom-model",
        endpointUrl: "https://example.test/v1",
        hasApiKey: true,
      },
      eligibility: {
        propertyName: "custom_target_flag",
      },
      thresholds: {
        freshnessMaxDays: 21,
        minConfidence: 0.8,
      },
    }));

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    triggerValue(renderer.find(Select, { name: "llmProvider" }), "custom");
    // Custom has an empty catalog — user must pick __other__ and type
    await renderer.waitFor(() => {
      expect(renderer.find(Select, { name: "llmModel" })).toBeTruthy();
    });
    triggerValue(renderer.find(Select, { name: "llmModel" }), "__other__");
    await renderer.waitFor(() => {
      expect(renderer.find(Input, { name: "llmModelOther" })).toBeTruthy();
    });
    triggerValue(renderer.find(Input, { name: "llmModelOther" }), "custom-model");
    triggerValue(renderer.find(Input, { name: "llmEndpointUrl" }), "https://example.test/v1");
    triggerValue(renderer.find(Input, { name: "llmApiKey" }), "custom-secret");
    triggerValue(renderer.find(Input, { name: "exaApiKey" }), "exa-rotated");
    triggerValue(renderer.find(Input, { name: "eligibilityPropertyName" }), "custom_target_flag");
    triggerValue(renderer.find(NumberInput, { name: "freshnessMaxDays" }), 21);
    triggerValue(renderer.find(NumberInput, { name: "minConfidence" }), 80);
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    await renderer.waitFor(() => {
      const text = renderer
        .findAll(Text)
        .map((node) => node.text ?? "")
        .join(" ");
      expect(text).toContain("Settings saved.");
    });

    expect(updateSettings).toHaveBeenCalledWith({
      signalProviders: {
        exa: { enabled: true, apiKey: "exa-rotated" },
        hubspotEnrichment: { enabled: true },
      },
      llm: {
        provider: "custom",
        model: "custom-model",
        endpointUrl: "https://example.test/v1",
        apiKey: "custom-secret",
      },
      eligibility: {
        propertyName: "custom_target_flag",
      },
      thresholds: {
        freshnessMaxDays: 21,
        minConfidence: 0.8,
      },
    });
  });

  it("blocks save when the custom llm provider is missing an endpoint url", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn();

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    triggerValue(renderer.find(Select, { name: "llmProvider" }), "custom");
    // endpoint URL field now rendered but untouched (empty)
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      const text = renderer
        .findAll(Text)
        .map((node) => node.text ?? "")
        .join(" ");
      expect(text).toContain("Custom provider requires an endpoint URL.");
    });

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("blocks save when __other__ model is selected but the free-text model is empty", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn();

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    triggerValue(renderer.find(Select, { name: "llmModel" }), "__other__");
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      const text = renderer
        .findAll(Text)
        .map((node) => node.text ?? "")
        .join(" ");
      expect(text).toMatch(/model/i);
    });

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("sends an explicit llm disable payload when the user selects None", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => ({
      ...VALID_SETTINGS,
      llm: {
        provider: null,
        model: "",
        hasApiKey: false,
      },
    }));

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    triggerValue(renderer.find(Select, { name: "llmProvider" }), "none");
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    expect(updateSettings).toHaveBeenCalledWith({
      signalProviders: {
        exa: { enabled: true },
        hubspotEnrichment: { enabled: true },
      },
      llm: {
        provider: null,
      },
      eligibility: {
        propertyName: "hs_is_target_account",
      },
      thresholds: {
        freshnessMaxDays: 30,
        minConfidence: 0.5,
      },
    });
  });

  it("renders the initial load error instead of staying on an indefinite loading state", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => {
      throw new Error("settings-fetch-failed: 401 Unauthorized");
    });

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      const text = renderer
        .findAll(Text)
        .map((node) => node.text ?? "")
        .join(" ");
      expect(text).toContain("settings-fetch-failed: 401 Unauthorized");
    });

    const text = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(text).not.toBe("Loading…");
  });

  it("renders tooltips on Freshness max days and Minimum confidence and displays confidence as a percent", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<HubSpotSettingsPage fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    const freshnessInput = renderer.find(NumberInput, {
      name: "freshnessMaxDays",
    });
    expect(freshnessInput.props.tooltip).toMatch(/stale/i);

    const minConfidenceInput = renderer.find(NumberInput, {
      name: "minConfidence",
    });
    expect(minConfidenceInput.props.tooltip).toMatch(/confidence/i);
    // Wire value is 0.5; UI shows it as 50 (percent).
    expect(minConfidenceInput.props.value).toBe(50);
    expect(minConfidenceInput.props.label).toMatch(/%/);
  });

  it("preserves the 0..1 decimal wire value for minimum confidence when the user edits via percent", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(
      <HubSpotSettingsPage fetchSettings={fetchSettings} updateSettings={updateSettings} />,
    );

    await renderer.waitFor(() => {
      expect(renderer.find(LoadingButton).props.loading).toBe(false);
    });

    triggerValue(renderer.find(NumberInput, { name: "minConfidence" }), 65);
    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    const call = (
      updateSettings.mock.calls[0] as unknown as [{ thresholds: { minConfidence: number } }]
    )[0];
    expect(call.thresholds.minConfidence).toBe(0.65);
  });
});
