/** /reset-password: consumes the ?token= link, sets a new password, and handles
 *  mismatch / invalid-token / missing-token without leaking. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResetPasswordClient } from "./ResetPasswordClient";
import * as session from "@/lib/session";
import { ApiError } from "@/lib/session";

let mockToken: string | null = "tok123";
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => mockToken }),
}));
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, resetPassword: jest.fn() };
});
const mockReset = session.resetPassword as jest.Mock;

afterEach(() => {
  jest.resetAllMocks();
  mockToken = "tok123";
});

const fill = (pw: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
};

it("submits the new password with the token and shows success", async () => {
  mockReset.mockResolvedValue({ ok: true });
  render(<ResetPasswordClient />);
  fill("newpassword1", "newpassword1");
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));

  await waitFor(() => expect(mockReset).toHaveBeenCalledWith("tok123", "newpassword1"));
  expect(await screen.findByText(/password has been updated/i)).toBeInTheDocument();
});

it("rejects mismatched passwords without calling the API", () => {
  render(<ResetPasswordClient />);
  fill("newpassword1", "different1");
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));

  expect(screen.getByText(/don.t match/i)).toBeInTheDocument();
  expect(mockReset).not.toHaveBeenCalled();
});

it("shows a friendly error for an invalid/expired token", async () => {
  mockReset.mockRejectedValue(
    new ApiError(400, "invalid_token", "This reset link is invalid or has expired."),
  );
  render(<ResetPasswordClient />);
  fill("newpassword1", "newpassword1");
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));

  expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
});

it("shows the invalid-link state when the URL has no token", () => {
  mockToken = null;
  render(<ResetPasswordClient />);
  expect(screen.getByText(/reset link is missing/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
});

it("labels both fields with visible <label>s, not placeholders", () => {
  render(<ResetPasswordClient />);
  for (const name of ["New password", "Confirm new password"]) {
    const input = screen.getByLabelText(name) as HTMLInputElement;
    expect(input.labels?.[0]).toHaveTextContent(name);
    expect(input).not.toHaveAttribute("placeholder");
  }
  expect(screen.getByLabelText("New password")).toHaveAccessibleDescription("8+ characters");
});

it("announces a mismatch or server error through role=alert", async () => {
  render(<ResetPasswordClient />);
  fill("newpassword1", "different1");
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
  expect(screen.getByRole("alert")).toHaveTextContent(/don.t match/i);

  mockReset.mockRejectedValue(
    new ApiError(400, "invalid_token", "This reset link is invalid or has expired."),
  );
  fill("newpassword1", "newpassword1");
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalid or has expired/i));
  expect(screen.getByRole("alert")).toHaveClass("text-miss");
});
