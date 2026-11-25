import type { ReactNode } from "react";
import { NOT_AFFILIATED } from "@/lib/ufcDisplay";

/** Every page under /ufc carries the independence line. */
export default function UfcLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <p className="mt-8 text-notes text-muted">{NOT_AFFILIATED}</p>
    </>
  );
}
