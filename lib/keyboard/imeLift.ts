import {
  Dimensions,
  Keyboard,
  Platform,
  type KeyboardEvent,
} from "react-native";
import { useEffect, useState } from "react";

/** Hauteur IME utile (Redmi / MIUI : endCoordinates seul est souvent trop bas). */
export function imeLiftPx(e: KeyboardEvent): number {
  const screenH = Dimensions.get("screen").height;
  const winH = Dimensions.get("window").height;
  const { height, screenY } = e.endCoordinates;
  if (height <= 0) return 0;

  const fromScreen = screenH - screenY;
  const fromWindow = winH - screenY;
  const frameLift = Math.max(fromScreen, fromWindow);

  let lift =
    screenY > 40 && frameLift >= height - 8
      ? Math.max(height, frameLift)
      : height;

  if (Platform.OS === "android" && frameLift <= height + 12) {
    lift += 96;
  }

  return Math.round(Math.min(lift, screenH * 0.75));
}

export function useKeyboardBottomInset(active = true): number {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    if (!active) {
      setLift(0);
      return;
    }
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => setLift(imeLiftPx(e));
    const onHide = () => setLift(0);
    const onFrame = (e: KeyboardEvent) => {
      if (e.endCoordinates.height <= 0) {
        setLift(0);
        return;
      }
      setLift(imeLiftPx(e));
    };

    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    const subFrame = Keyboard.addListener("keyboardDidChangeFrame", onFrame);
    return () => {
      subShow.remove();
      subHide.remove();
      subFrame.remove();
    };
  }, [active]);

  return lift;
}
