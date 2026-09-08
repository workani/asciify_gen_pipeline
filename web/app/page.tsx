"use client";

import { Dashboard } from "@/components/Dashboard";
import { useRunFeed } from "@/lib/source";

export default function LivePage() {
  const { snapshot, connection } = useRunFeed("live");
  return <Dashboard snapshot={snapshot} connection={connection} title="Miner" />;
}
