import {
  androidGalleryImagesAccessGranted,
  requestAndroidGalleryImagesPermission,
} from "@/lib/image/androidGalleryPermission";
import { mergeStatusGridSources } from "@/lib/status/statusGridLocalCache";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import * as MediaLibrary from "expo-media-library";
import { Platform } from "react-native";

export type RecentGalleryPhoto = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

export const GALLERY_PAGE_SIZE = 36;
const QUERY_TIMEOUT_MS = 15_000;

let autoPickerShownThisSession = false;

export type CameraRollPhotosPage = {
  photos: RecentGalleryPhoto[];
  endCursor?: string;
  hasNextPage: boolean;
  accessDenied?: boolean;
  needsPhotoSelection?: boolean;
};

async function withGalleryTimeout<T>(
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("gallery-query-timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readMediaLibraryPermission(): Promise<MediaLibrary.PermissionResponse> {
  return MediaLibrary.getPermissionsAsync();
}

async function requestMediaLibraryPermission(): Promise<MediaLibrary.PermissionResponse> {
  return MediaLibrary.requestPermissionsAsync();
}

export async function presentStatusGalleryPhotoAccessPicker(): Promise<void> {
  try {
    await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
  } catch {
    /* picker indisponible ou refusé */
  }
}

export async function ensureGalleryReadForRecentsGrid(): Promise<boolean> {
  if (Platform.OS === "android") {
    await requestAndroidGalleryImagesPermission();
  }
  try {
    const existing = await readMediaLibraryPermission();
    if (existing.granted) return true;
    if (existing.canAskAgain) {
      const req = await requestMediaLibraryPermission();
      if (req.granted) return true;
    }
  } catch {
    /* repli Android ci-dessous */
  }
  if (Platform.OS === "android") {
    return await androidGalleryImagesAccessGranted();
  }
  return false;
}

function mapMediaAssets(assets: MediaLibrary.Asset[]): RecentGalleryPhoto[] {
  return assets
    .map((a) => {
      const uri = String(a.uri ?? "").trim();
      if (!uri) return null;
      return {
        id: a.id,
        uri,
        width: a.width ?? 0,
        height: a.height ?? 0,
      };
    })
    .filter((x): x is RecentGalleryPhoto => x !== null);
}

function mapCameraRollEdges(
  edges: Array<{
    node: {
      id: string;
      image: { uri: string; width: number; height: number };
    };
  }>,
): RecentGalleryPhoto[] {
  return edges
    .map(({ node }) => {
      const uri = String(node.image?.uri ?? "").trim();
      if (!uri) return null;
      return {
        id: node.id,
        uri,
        width: node.image.width ?? 0,
        height: node.image.height ?? 0,
      };
    })
    .filter((x): x is RecentGalleryPhoto => x !== null);
}

async function queryMediaLibraryAssets(opts?: {
  first?: number;
  after?: string;
  album?: MediaLibrary.AlbumRef;
}): Promise<CameraRollPhotosPage> {
  const first = opts?.first ?? GALLERY_PAGE_SIZE;
  const result = await withGalleryTimeout(QUERY_TIMEOUT_MS, () =>
    MediaLibrary.getAssetsAsync({
      first,
      after: opts?.after,
      album: opts?.album,
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      resolveWithFullInfo: false,
    }),
  );
  return {
    photos: mapMediaAssets(result.assets),
    endCursor: result.endCursor,
    hasNextPage: result.hasNextPage,
  };
}

async function fetchCameraRollNative(opts?: {
  first?: number;
  after?: string;
}): Promise<CameraRollPhotosPage | null> {
  try {
    const first = opts?.first ?? GALLERY_PAGE_SIZE;
    const result = await withGalleryTimeout(QUERY_TIMEOUT_MS, () =>
      CameraRoll.getPhotos({
        first,
        after: opts?.after,
        assetType: "Photos",
        ...(Platform.OS === "ios" ? { groupTypes: "All" } : {}),
      }),
    );
    const photos = mapCameraRollEdges(result.edges);
    if (!photos.length) return null;
    return {
      photos,
      endCursor: result.page_info.end_cursor,
      hasNextPage: Boolean(result.page_info.has_next_page),
    };
  } catch {
    return null;
  }
}

async function fetchFromAlbums(opts?: {
  first?: number;
  after?: string;
}): Promise<CameraRollPhotosPage | null> {
  if (opts?.after) return null;
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (const album of albums) {
      const page = await queryMediaLibraryAssets({
        first: opts?.first ?? GALLERY_PAGE_SIZE,
        album: album.id,
      });
      if (page.photos.length > 0) return page;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadGalleryPage(opts?: {
  first?: number;
  after?: string;
}): Promise<CameraRollPhotosPage> {
  if (Platform.OS === "android") {
    const roll = await fetchCameraRollNative(opts);
    if (roll?.photos.length) return roll;
  }

  try {
    const primary = await queryMediaLibraryAssets(opts);
    if (primary.photos.length > 0) return primary;
  } catch {
    /* repli albums */
  }

  const fromAlbums = await fetchFromAlbums(opts);
  if (fromAlbums?.photos.length) return fromAlbums;

  if (Platform.OS !== "android") {
    const roll = await fetchCameraRollNative(opts);
    if (roll?.photos.length) return roll;
  }

  return { photos: [], hasNextPage: false };
}

function emptyFlags(
  perm: MediaLibrary.PermissionResponse,
): Pick<CameraRollPhotosPage, "needsPhotoSelection" | "accessDenied"> {
  if (!perm.granted) {
    return { accessDenied: true, needsPhotoSelection: false };
  }
  return { needsPhotoSelection: true, accessDenied: false };
}

export async function fetchCameraRollPhotosPage(opts?: {
  first?: number;
  after?: string;
  requestPermission?: boolean;
}): Promise<CameraRollPhotosPage> {
  try {
    const first = opts?.first ?? GALLERY_PAGE_SIZE;
    let perm = await readMediaLibraryPermission();

    if (opts?.requestPermission !== false) {
      const granted = await ensureGalleryReadForRecentsGrid();
      perm = await readMediaLibraryPermission();
      if (!granted) {
        const merged = mergeStatusGridSources([]);
        return {
          photos: merged,
          hasNextPage: false,
          accessDenied: merged.length === 0,
        };
      }
    }

    let page = await loadGalleryPage({ first, after: opts?.after });

    if (
      page.photos.length === 0 &&
      perm.granted &&
      !opts?.after &&
      !autoPickerShownThisSession
    ) {
      autoPickerShownThisSession = true;
      await presentStatusGalleryPhotoAccessPicker();
      page = await loadGalleryPage({ first, after: opts?.after });
    }

    const merged = mergeStatusGridSources(page.photos);
    if (merged.length === 0) {
      return { ...page, photos: merged, ...emptyFlags(perm) };
    }
    return { ...page, photos: merged };
  } catch {
    const merged = mergeStatusGridSources([]);
    return {
      photos: merged,
      hasNextPage: false,
      accessDenied: merged.length === 0,
      needsPhotoSelection: merged.length === 0,
    };
  }
}

export async function loadRecentGalleryPhotosForStatus(
  requestAccess = true,
): Promise<RecentGalleryPhoto[]> {
  const page = await fetchCameraRollPhotosPage({
    requestPermission: requestAccess,
  });
  return page.photos;
}

export async function resolveGalleryPhotoForPublish(
  id: string,
  fallbackUri: string,
): Promise<string> {
  const trimmed = String(fallbackUri ?? "").trim();
  if (!id || id.startsWith("local-pick-")) return trimmed;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(id);
    const local = String(info.localUri ?? "").trim();
    if (local) return local;
  } catch {
    /* garde l’URI vignette */
  }
  return trimmed;
}
