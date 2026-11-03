/** AuthModal accessibility (code-health audit §7, items 1-3): visible labels
 *  instead of placeholder-only fields, submit errors announced via
 *  role="alert", the dialog named by its visible heading, and focus sent to
 *  the first invalid field on an empty submit. */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AuthModal } from "@/components/AuthModal";
import { ApiError } from "@/lib/session";
import * as session from "@/lib/session";

jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, login: jest.fn(), register: jest.fn(), requestPasswordReset: jest.fn() };
});
const mockLogin = session.login as jest.Mock;
const mockRequestReset = session.requestPasswordReset as jest.Mock;

afterEach(() => jest.resetAllMocks());

const renderModal = (initialMode?: "signin" | "signup") =>
  render(<AuthModal open onClose={() => {}} onAuthed={() => {}} initialMode={initialMode} />);

/** Every text-entry control in the dialog has a real, visible <label>. */
function expectVisiblyLabelled(dialog: HTMLElement) {
  const inputs = within(dialog)
    .queryAllByRole("textbox")
    .concat([...dialog.querySelectorAll<HTMLInputElement>('input[type="password"]')]);
  expect(inputs.length).toBeGreaterThan(0);
  for (const input of inputs) {
    const labels = (input as HTMLInputElement).labels;
    expect(labels?.length).toBe(1);
    expect(labels?.[0].textContent?.trim()).not.toBe("");
    expect(input).not.toHaveAttribute("placeholder");
  }
}

it("labels the sign-in fields with visible <label>s", () => {
  renderModal();
  const dialog = screen.getByRole("dialog");
  expectVisiblyLabelled(dialog);
  expect(within(dialog).getByText("Email address", { selector: "label" })).toBeVisible();
  expect(within(dialog).getByText("Password", { selector: "label" })).toBeVisible();
});

it("labels the sign-up fields, with the optional and length hints described", () => {
  renderModal("signup");
  const dialog = screen.getByRole("dialog");
  expectVisiblyLabelled(dialog);
  expect(screen.getByLabelText("Display name")).toHaveAccessibleDescription("Optional");
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("8+ characters");
});

it("names the dialog by its visible heading in every view", () => {
  const { rerender } = renderModal();
  expect(screen.getByRole("dialog", { name: "Welcome back" })).toBeInTheDocument();

  rerender(<AuthModal open onClose={() => {}} onAuthed={() => {}} initialMode="signup" />);
  expect(screen.getByRole("dialog", { name: "Create your account" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Switch to sign in" }));
  fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
  expect(screen.getByRole("dialog", { name: "Reset your password" })).toBeInTheDocument();
  expectVisiblyLabelled(screen.getByRole("dialog"));
});

it("announces a failed sign-in through role=alert", async () => {
  mockLogin.mockRejectedValue(new ApiError(401, "invalid_credentials", "Wrong email or password."));
  renderModal();
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert).not.toBeEmptyDOMElement();
  expect(alert).toHaveClass("text-loss-ink");
});

it("announces a failed reset request through role=alert", async () => {
  mockRequestReset.mockRejectedValue(new ApiError(429, "rate_limited", "Too many requests."));
  renderModal();
  fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "x@y.com" } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

  expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement();
});

it("moves focus to the first invalid field on an empty submit", () => {
  renderModal();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Email address")).toHaveFocus();

  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@b.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Password")).toHaveFocus();
});
