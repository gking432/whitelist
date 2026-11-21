import { redirect } from "next/navigation";

// The public entry is the existing empty, read-only workstation. A verified
// signed-in session can still be routed to its private workspace by proxy.ts.
export default function HomePage() {
  redirect("/preview");
}
