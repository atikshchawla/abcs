import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "ABCS — Adaptive Behaviour-Aware CPU Scheduler",
  description:
    "Discrete-event simulator comparing behaviour-aware scheduling (ABCS) against Round Robin and MLFQ on identical workloads.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-[1440px] items-center gap-x-3 px-3 py-1.5">
            <span className="text-sm font-bold tracking-tight">ABCS</span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              Adaptive Behaviour-Aware CPU Scheduler
            </span>
            <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
              Simulator — not a real OS scheduler
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-2">{children}</main>
        <footer className="border-t border-zinc-200 px-3 py-1.5 text-center text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Discrete-event simulation · integer ticks · same immutable workload for all algorithms
        </footer>
      </body>
    </html>
  );
}
