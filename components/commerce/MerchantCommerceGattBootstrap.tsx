import { useAuth } from "@/contexts/authContextBase";
import { handleCommercePayPayloadFromGatt } from "@/lib/commerce/handleLocalCommercePayNotice";
import {
  startMerchantClosedCashierGatt,
  stopMerchantClosedCashierGatt,
  subscribeMerchantClosedCashierReceipt,
} from "@/lib/commerce/closedCashierGattMerchant";
import { useEffect } from "react";
import { Platform } from "react-native";

const nativeShellLauncher =
  process.env.EXPO_PUBLIC_NATIVE_SHELL !== "0" &&
  process.env.EXPO_PUBLIC_NATIVE_SHELL !== "false";

/**
 * Écoute paiements à proximité tant que le profil est en mode commerce
 * (autre app / écran verrouillé — annonce vocale côté natif).
 */
export function MerchantCommerceGattBootstrap() {
  const { user, token } = useAuth();
  const commerceCtx =
    user?.activeContext?.type === "commerce" ? user.activeContext : null;
  const commerceId = commerceCtx?.commerceId ?? "";
  const merchantAccountId = commerceCtx?.accountId?.trim() ?? "";

  useEffect(() => {
    if (Platform.OS === "android" && nativeShellLauncher) {
      return;
    }
    if (!commerceId || !merchantAccountId) {
      void stopMerchantClosedCashierGatt();
      return;
    }
    void startMerchantClosedCashierGatt(merchantAccountId);
    const unsub = subscribeMerchantClosedCashierReceipt((json) => {
      void handleCommercePayPayloadFromGatt({
        json,
        commerceId,
        merchantAccountId,
        authToken: token,
      });
    });
    return () => {
      unsub();
      void stopMerchantClosedCashierGatt();
    };
  }, [commerceId, merchantAccountId, token]);

  return null;
}
