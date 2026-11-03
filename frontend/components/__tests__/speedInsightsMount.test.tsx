/** SpeedInsightsMount: Web Vitals per route, with Stripe client secrets
 *  scrubbed out of the page URL each vital carries. */
import { render } from "@testing-library/react";
import { SpeedInsightsMount } from "@/components/SpeedInsightsMount";

const mockProps = jest.fn();
jest.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: unknown) => {
    mockProps(props);
    return null;
  },
}));

it("mounts Speed Insights and renders nothing itself", () => {
  const { container } = render(<SpeedInsightsMount />);
  expect(mockProps).toHaveBeenCalledTimes(1);
  expect(container).toBeEmptyDOMElement();
});

it("scrubs the 3DS return URL before a vital is sent", () => {
  render(<SpeedInsightsMount />);
  const { beforeSend } = mockProps.mock.calls.at(-1)[0];
  const sent = beforeSend({
    type: "vital",
    url: "https://x.app/premium?setup_intent=seti_1&setup_intent_client_secret=seti_1_secret_Z",
    route: "/premium",
  });
  expect(sent.url).not.toContain("seti_1_secret_Z");
  expect(sent).toMatchObject({ type: "vital", route: "/premium" });
});
