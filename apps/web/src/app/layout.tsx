import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Case Engine",
  description: "Transform unstructured email into organized cases",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
