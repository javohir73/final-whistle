import { notFound } from "next/navigation";

/** Any /ufc path no route matches lands on the UFC not-found page, not the site-wide one. */
export default function UfcUnmatched(): never {
  notFound();
}
