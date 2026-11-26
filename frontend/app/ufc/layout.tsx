import type { ReactNode } from "react";
import Link from "next/link";
import { NOT_AFFILIATED } from "@/lib/ufcDisplay";

/** Every page under /ufc carries the independence line. */
export default function UfcLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <p className="mt-8 text-notes text-muted">
        {NOT_AFFILIATED}{" "}
        <Link href="/ufc/photo-credits" className="inline-flex min-h-[44px] items-center underline underline-offset-2">
          Photo credits
        </Link>
      </p>
    </>
  );
}
