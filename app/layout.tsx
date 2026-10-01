import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BottomNavigation from "./ui/bottom-navigation";
import CartHeaderButton from "./ui/cart-header-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jalims | Vos produits de Chine, livrés au Sénégal",
  description: "Commandez des produits depuis la Chine. Jalims s’occupe du transport et du dédouanement jusqu’à votre point de retrait au Sénégal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CartHeaderButton />
        {children}
        <BottomNavigation />
      </body>
    </html>
  );
}
