import ChatThreadScreen from "@/components/messages/ChatThreadScreen";
import { perfChatOpenLap } from "@/lib/perf/marks";
import { useLayoutEffect } from "react";

/** Route mince : lap navigation entre chunk Metro et montage du fil. */
export default function ChatRouteScreen() {
  useLayoutEffect(() => {
    perfChatOpenLap("route_layout");
  }, []);
  return <ChatThreadScreen />;
}
