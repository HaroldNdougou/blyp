import { API_BASE_URL, USE_MOCK_API } from "@/lib/config";
import NetInfo from "@react-native-community/netinfo";

let done = false;

/** Une fois : sonde HTTP vers notre API au lieu du check Google natif (plus fiable en prod). */
export function ensureNetInfoConfigured(): void {
  if (done) return;
  done = true;
  if (USE_MOCK_API || !API_BASE_URL) return;

  NetInfo.configure({
    reachabilityUrl: `${API_BASE_URL}/health`,
    reachabilityMethod: "GET",
    reachabilityRequestTimeout: 10_000,
    reachabilityTest: async (response) =>
      response.status >= 200 && response.status < 300,
    useNativeReachability: false,
  });
}
