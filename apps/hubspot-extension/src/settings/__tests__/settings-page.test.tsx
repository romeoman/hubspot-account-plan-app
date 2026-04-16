import {
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
    news: { enabled: false, hasApiKey: false },
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

  it("sends the expected settings payload when the user edits and saves", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => ({
      ...VALID_SETTINGS,
      signalProviders: {
        ...VALID_SETTINGS.signalProviders,
        news: { enabled: true, hasApiKey: false },
      },
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

    triggerValue(renderer.find(Toggle, { name: "newsEnabled" }), true);
    triggerValue(renderer.find(Select, { name: "llmProvider" }), "custom");
    triggerValue(renderer.find(Input, { name: "llmModel" }), "custom-model");
    triggerValue(renderer.find(Input, { name: "llmEndpointUrl" }), "https://example.test/v1");
    triggerValue(renderer.find(Input, { name: "llmApiKey" }), "custom-secret");
    triggerValue(renderer.find(Input, { name: "exaApiKey" }), "exa-rotated");
    triggerValue(renderer.find(Input, { name: "eligibilityPropertyName" }), "custom_target_flag");
    triggerValue(renderer.find(NumberInput, { name: "freshnessMaxDays" }), 21);
    triggerValue(renderer.find(NumberInput, { name: "minConfidence" }), 0.8);
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
        news: { enabled: true },
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
    triggerValue(renderer.find(Input, { name: "llmModel" }), "custom-model");
    triggerValue(renderer.find(Input, { name: "llmEndpointUrl" }), "");
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
        news: { enabled: false },
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
});
