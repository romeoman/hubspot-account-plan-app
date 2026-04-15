import { type RenderedNode, RenderedNodeType } from "@hubspot/ui-extensions/testing";

/**
 * Accessibility dismiss helper. The HubSpot `Modal` component handles the
 * Escape key natively and forwards the dismissal through its `onClose` prop;
 * the testing renderer exposes that as `.trigger("onClose")`. Wrapping the
 * call here lets specs read as the user intent ("press Escape") rather than
 * the SDK plumbing.
 */
type TriggerableNode = { trigger: (event: "onClose") => void };
export function triggerEscape(node: TriggerableNode): void {
  node.trigger("onClose");
}

/**
 * Recursively collects every text-node string reachable from a rendered
 * subtree. The HubSpot testing `.text` accessor on parent nodes does not
 * aggregate text content from descendant elements (only direct text
 * children), so we do the aggregation manually for state-rendering tests.
 *
 * Output is space-joined so callers can use `.toContain(substring)` without
 * worrying about adjacency across nested nodes.
 */
export function collectAllText(node: RenderedNode): string {
  const parts: string[] = [];
  walk(node, parts);
  return parts.join(" ");
}

function walk(node: RenderedNode, parts: string[]): void {
  if (node.nodeType === RenderedNodeType.Text) {
    parts.push(node.text);
    return;
  }
  // Fragment / Element / Root — recurse into children.
  const maybeChildren = (node as { childNodes?: RenderedNode[] }).childNodes;
  if (!maybeChildren) return;
  for (const child of maybeChildren) {
    walk(child, parts);
  }
  // Elements may also carry fragment props (e.g. Alert's children slot).
  // Those are attached as RenderedFragmentNode values on `props.*`, which
  // are already part of `childNodes` for standard components, so we do not
  // double-walk them here.
}
