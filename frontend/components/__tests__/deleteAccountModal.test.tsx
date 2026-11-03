/** DeleteAccountModal as a real modal (code-health audit §7 item 4): labelled
 *  by its heading, a visible password label, focus moved in on open, Tab
 *  trapped inside, Escape to close (not mid-deletion), focus restored to the
 *  opener on close, and errors announced. */
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import { ApiError } from "@/lib/session";

function Harness({ onConfirm = jest.fn() }: { onConfirm?: (pw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open delete
      </button>
      <DeleteAccountModal open={open} onClose={() => setOpen(false)} onConfirm={onConfirm} />
    </>
  );
}

async function openModal(onConfirm?: (pw: string) => Promise<void>) {
  render(<Harness onConfirm={onConfirm} />);
  const opener = screen.getByRole("button", { name: "Open delete" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Delete your account" });
  await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
  return { opener, dialog };
}

it("is a modal dialog named by its visible heading, with a visibly labelled field", async () => {
  const { dialog } = await openModal();
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const input = screen.getByLabelText("Password") as HTMLInputElement;
  expect(input.labels?.[0]).toHaveTextContent("Password");
  expect(input).not.toHaveAttribute("placeholder");
});

it("traps Tab and Shift+Tab inside the dialog", async () => {
  await openModal();
  const input = screen.getByLabelText("Password");
  fireEvent.change(input, { target: { value: "hunter22" } });
  const submit = screen.getByRole("button", { name: "Delete account" });
  expect(submit).toBeEnabled();

  submit.focus();
  fireEvent.keyDown(submit, { key: "Tab" });
  expect(input).toHaveFocus();

  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(submit).toHaveFocus();
});

it("wraps past the disabled submit button instead of letting focus escape", async () => {
  await openModal();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(screen.getByLabelText("Password")).toHaveFocus();
});

it("closes on Escape and returns focus to the opener", async () => {
  const { opener } = await openModal();
  fireEvent.keyDown(screen.getByLabelText("Password"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("returns focus to the opener after Cancel too", async () => {
  const { opener } = await openModal();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("ignores Escape while the deletion is in flight", async () => {
  let finish: () => void = () => {};
  const onConfirm = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  await openModal(onConfirm);
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled());

  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => finish());
});

it("announces a failed confirmation through role=alert", async () => {
  const onConfirm = jest.fn().mockRejectedValue(new ApiError(401, "invalid_credentials", "Wrong password."));
  await openModal(onConfirm);
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope-nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Wrong password.");
  expect(alert).toHaveClass("text-loss-ink");
});
