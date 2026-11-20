/** axe-core sweep of the surfaces the D track touched (auth forms, the delete
 *  dialog, the toast, standings table). jest-axe turns the
 *  color-contrast rule off under jsdom (no layout); contrast is covered by
 *  lib/__tests__/contrastQuickWins.test.ts from the token values instead. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { AuthModal } from "@/components/AuthModal";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import { AuthToast } from "@/components/AuthToast";
import { FULL_LEAGUE_COLUMNS, StandingsTable } from "@/components/StandingsTable";
import { ResetPasswordClient } from "@/app/reset-password/ResetPasswordClient";
import { COMPETITIONS } from "@/lib/sports";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => "tok123" }),
}));

it("AuthModal sign-in, sign-up and reset views have no axe violations", async () => {
  const { container, rerender } = render(<AuthModal open onClose={() => {}} onAuthed={() => {}} />);
  // Surface the inline field errors too.
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await axe(container)).toHaveNoViolations();

  rerender(<AuthModal open onClose={() => {}} onAuthed={() => {}} initialMode="signup" />);
  expect(await axe(container)).toHaveNoViolations();

  fireEvent.click(screen.getByRole("tab", { name: "Switch to sign in" }));
  fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
  expect(await axe(container)).toHaveNoViolations();
});

it("DeleteAccountModal has no axe violations", async () => {
  const { container } = render(<DeleteAccountModal open onClose={() => {}} onConfirm={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
  expect(await axe(container)).toHaveNoViolations();
});

it("reset-password form has no axe violations", async () => {
  const { container } = render(<ResetPasswordClient />);
  expect(await axe(container)).toHaveNoViolations();
});

it("AuthToast has no axe violations", async () => {
  const { container } = render(
    <main>
      <AuthToast message="Account created" onDone={() => {}} />
    </main>,
  );
  expect(await axe(container)).toHaveNoViolations();
});

it("the standings table has no axe violations", async () => {
  const { container } = render(
    <StandingsTable
      standings={[
        {
          team_id: 1, team: "Arsenal", played: 9, won: 8, drawn: 0, lost: 1,
          projected_goals_for: 14, goals_against: 5, projected_goal_diff: 9, projected_points: 24,
          qualification_prob: null,
        },
      ]}
      zones={COMPETITIONS.epl.zones}
      badge="club"
      teamBasePath="/football/epl/team"
      columns={FULL_LEAGUE_COLUMNS}
    />,
  );
  expect(await axe(container)).toHaveNoViolations();
});
