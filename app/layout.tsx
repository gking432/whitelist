import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Partner Portal",
    template: "%s | Partner Portal",
  },
  description:
    "Partner operations platform for client integrations, automations, approvals, and workflow visibility.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
