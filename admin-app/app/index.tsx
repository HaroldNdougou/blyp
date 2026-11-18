import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { AppLoader } from "../components/AppLoader";
import { api, getToken, setToken } from "../lib/api";

export default function Gate() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setAuthed(false);
          setReady(true);
        }
        return;
      }
      try {
        await api("/api/me");
        if (!cancelled) setAuthed(true);
      } catch {
        await setToken(null);
        if (!cancelled) setAuthed(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return <AppLoader />;
  return <Redirect href={authed ? "/home" : "/login"} />;
}
