/** Test helper: server-render a tree at one instant, hydrate it at another,
 *  and collect React's recoverable (hydration) errors. Mirrors an ISR page
 *  whose HTML is older than the visit. */
import { act } from "@testing-library/react";
import type { ReactElement } from "react";

export async function hydrateAcrossTime(
  tree: () => ReactElement,
  serverTime: Date,
  clientTime: Date,
): Promise<{ html: string; container: HTMLElement; errors: string[] }> {
  // The Node build of react-dom/server: the browser build needs a
  // MessageChannel, whose Node ports keep Jest from exiting.
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.TextEncoder) g.TextEncoder = jest.requireActual("node:util").TextEncoder;
  const { renderToString } = jest.requireActual("react-dom/server.node") as typeof import("react-dom/server");
  const { hydrateRoot } = jest.requireActual("react-dom/client") as typeof import("react-dom/client");

  jest.setSystemTime(serverTime);
  const html = renderToString(tree());

  jest.setSystemTime(clientTime);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors: string[] = [];
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => {
      hydrateRoot(container, tree(), { onRecoverableError: (e) => errors.push(String(e)) });
    });
  } finally {
    quiet.mockRestore();
  }
  return { html, container, errors };
}
