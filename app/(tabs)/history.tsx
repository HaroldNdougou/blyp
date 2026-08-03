import HistoryGate from "@/components/history/HistoryGate";
import React from "react";

/** Gate = titre immédiat ; corps préchargé via eagerRoutes / aggressiveWarm. */
export default function HistoryRoute() {
  return <HistoryGate />;
}
