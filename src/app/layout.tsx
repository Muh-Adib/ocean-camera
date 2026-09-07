import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Living Ocean — An Ocean That Can Feel You",
  description:
    "An immersive 3D underwater ecosystem. Move your hand — swipes, pushes and open palms create currents that fish, plankton, seaweed and light all respond to. Camera video is processed locally and never uploaded.",
  keywords: ["3D ocean", "Three.js", "hand tracking", "interactive experience", "underwater", "WebGL"],
  authors: [{ name: "Living Ocean" }],
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "The Living Ocean",
    description: "Move your hand — watch the ocean respond.",
    type: "website",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#02111f",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ margin: 0, background: "#02111f", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
