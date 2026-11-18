import { useAuth } from "@/contexts/authContextBase";
import {
  hydratePayDossierFromDisk,
  hydratePayDossierFromUser,
} from "@/lib/pay/payDossierCache";
import { useEffect } from "react";

/** Met à jour le dossier pay (solde, plafonds) dès que le profil change. */
export function PayDossierBootstrap() {
  const { user } = useAuth();
  const phone = user?.phone ?? "";

  useEffect(() => {
    if (user?.phone) {
      hydratePayDossierFromUser(user);
      return;
    }
    if (phone) {
      void hydratePayDossierFromDisk(phone);
    }
  }, [user, phone]);

  return null;
}
