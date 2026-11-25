import { render, screen, within } from "@testing-library/react";
import type { UfcModelCall } from "@/lib/ufcTypes";
import { CALL_B_DECISION } from "./PickControl.fixtures.testutil";
import { DECISION_BOUT, KO_BOUT, SCHEDULED_BOUT } from "./fixtures.testutil";
import { UfcModelCallCard } from "./UfcModelCallCard";

it("shows the model's fighter, chance, method and reasons", () => {
  const { container } = render(<UfcModelCallCard bout={SCHEDULED_BOUT} call={CALL_B_DECISION} />);
  const card = screen.getByRole("region", { name: "The model's call" });
  expect(card).toHaveAttribute("id", "model-call");
  expect(container.querySelectorAll("#model-call")).toHaveLength(1);
  expect(within(card).getByText("Shara Magomedov")).toBeInTheDocument();
  expect(within(card).getByText("54%")).toBeInTheDocument();
  expect(within(card).getByText("Most likely by decision.")).toBeInTheDocument();
  expect(within(card).getAllByRole("listitem")).toHaveLength(2);
  expect(within(card).getByText("Made before picks closed.")).toBeInTheDocument();
  expect(within(card).getByText("For analytics and entertainment only. Not betting advice.")).toBeInTheDocument();
  expect(within(card).queryByText(/odds|bet\b/i)).toBeNull();
  expect(within(card).queryByText(/points|Missed/)).toBeNull(); // no verdict before a result
});

it("leaves out the method line and the list when the call has neither", () => {
  render(<UfcModelCallCard bout={SCHEDULED_BOUT} call={{ ...CALL_B_DECISION, method: null, reasons: [] }} />);
  expect(screen.queryByText(/Most likely by/)).toBeNull();
  expect(screen.queryByRole("list")).toBeNull();
});

it("says when it is too close to call", () => {
  const call: UfcModelCall = { ...CALL_B_DECISION, winner: null, p_a: 0.5, p_b: 0.5, method: null };
  render(<UfcModelCallCard bout={SCHEDULED_BOUT} call={call} />);
  expect(screen.getByText("Too close to call: 50% each.")).toBeInTheDocument();
  expect(screen.queryByText(/%$/)).toBeNull();
});

it("grades the call after the result", () => {
  // DECISION_BOUT finished with winner b by decision
  const { rerender } = render(<UfcModelCallCard bout={DECISION_BOUT} call={CALL_B_DECISION} />);
  expect(screen.getByText("Winner and method · 5 points")).toBeInTheDocument();
  rerender(<UfcModelCallCard bout={DECISION_BOUT} call={{ ...CALL_B_DECISION, method: "ko_tko" }} />);
  expect(screen.getByText("Winner · 2 points")).toBeInTheDocument();
  rerender(<UfcModelCallCard bout={DECISION_BOUT} call={{ ...CALL_B_DECISION, winner: "a", p_a: 0.6, p_b: 0.4 }} />);
  expect(screen.getByText("Missed · 0 points")).toBeInTheDocument();
  rerender(<UfcModelCallCard bout={KO_BOUT} call={CALL_B_DECISION} />);
  expect(screen.getByText("Winner · 2 points")).toBeInTheDocument();
});
