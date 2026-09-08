"use client";

import { Dashboard } from "@/components/Dashboard";
import { useRunFeed } from "@/lib/source";

/* A synthetic run: the dashboard is meaningful with no miner attached. */
export default function DemoPage() {
  const { snapshot, connection, restart } = useRunFeed("demo");
  return (
    <Dashboard snapshot={snapshot} connection={connection} title="Miner" onRestart={restart} />
  );
}
