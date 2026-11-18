import MessagesRnIslandScreen from "@/app/(tabs)/messages";
import { returnToNativeShellAfterMessages } from "@/lib/nativeShell";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { BackHandler } from "react-native";

/** Liste conversations — retour matériel = coque native. */
export default function MessagesIslandIndex() {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        void returnToNativeShellAfterMessages();
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  return <MessagesRnIslandScreen />;
}
