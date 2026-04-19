import type { TestConnectionErrorCode } from "@hap/config";
import { Text } from "@hubspot/ui-extensions";

export type ConnectionTestStatusState =
  | "idle"
  | "loading"
  | { ok: true; latencyMs: number }
  | { ok: false; code: TestConnectionErrorCode; message: string };

export type ConnectionTestStatusProps = {
  state: ConnectionTestStatusState;
};

function humanMessage(code: TestConnectionErrorCode): string {
  switch (code) {
    case "auth":
      return "Authentication failed — check the API key.";
    case "model":
      return "Model is not available on this account.";
    case "endpoint":
      return "Endpoint rejected — must be HTTPS and non-private.";
    case "network":
      return "Network error — try again.";
    case "rate_limit":
      return "Too many test attempts. Wait a minute and retry.";
    case "unknown":
      return "Unexpected error.";
  }
}

export function ConnectionTestStatus({ state }: ConnectionTestStatusProps) {
  if (state === "idle") {
    return null;
  }
  if (state === "loading") {
    return <Text>Testing…</Text>;
  }
  if (state.ok) {
    return <Text format={{ fontWeight: "bold" }}>✓ Connected ({state.latencyMs}ms)</Text>;
  }
  return <Text>{`${humanMessage(state.code)} ${state.message}`}</Text>;
}
