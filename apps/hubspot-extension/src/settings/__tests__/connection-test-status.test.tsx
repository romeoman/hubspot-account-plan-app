import { Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { ConnectionTestStatus } from "../connection-test-status";

describe("ConnectionTestStatus", () => {
  it("renders nothing when state is idle", () => {
    const renderer = createRenderer("settings");
    renderer.render(<ConnectionTestStatus state="idle" />);
    const texts = renderer.findAll(Text);
    expect(texts.length).toBe(0);
  });

  it("renders 'Testing…' when state is loading", () => {
    const renderer = createRenderer("settings");
    renderer.render(<ConnectionTestStatus state="loading" />);
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Testing/);
  });

  it("renders success with latency", () => {
    const renderer = createRenderer("settings");
    renderer.render(<ConnectionTestStatus state={{ ok: true, latencyMs: 42 }} />);
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toContain("Connected");
    expect(combined).toContain("42ms");
  });

  it("renders failure with human message for auth", () => {
    const renderer = createRenderer("settings");
    renderer.render(
      <ConnectionTestStatus state={{ ok: false, code: "auth", message: "invalid" }} />,
    );
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Authentication failed/i);
  });

  it("renders failure with human message for model", () => {
    const renderer = createRenderer("settings");
    renderer.render(<ConnectionTestStatus state={{ ok: false, code: "model", message: "nope" }} />);
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Model is not available/i);
  });

  it("renders failure with human message for endpoint", () => {
    const renderer = createRenderer("settings");
    renderer.render(
      <ConnectionTestStatus state={{ ok: false, code: "endpoint", message: "bad url" }} />,
    );
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/HTTPS and non-private/i);
  });

  it("renders failure with human message for rate_limit", () => {
    const renderer = createRenderer("settings");
    renderer.render(
      <ConnectionTestStatus state={{ ok: false, code: "rate_limit", message: "slow down" }} />,
    );
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Wait a minute/i);
  });

  it("renders failure with human message for network", () => {
    const renderer = createRenderer("settings");
    renderer.render(
      <ConnectionTestStatus state={{ ok: false, code: "network", message: "timeout" }} />,
    );
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Network error/i);
  });

  it("renders failure with human message for unknown", () => {
    const renderer = createRenderer("settings");
    renderer.render(
      <ConnectionTestStatus state={{ ok: false, code: "unknown", message: "boom" }} />,
    );
    const combined = renderer
      .findAll(Text)
      .map((node) => node.text ?? "")
      .join(" ");
    expect(combined).toMatch(/Unexpected error/i);
  });
});
