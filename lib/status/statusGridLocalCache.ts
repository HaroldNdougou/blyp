import type { RecentGalleryPhoto } from "@/lib/image/recentGallery";

const MAX = 120;
let items: RecentGalleryPhoto[] = [];

/** Photos choisies via le sélecteur (FAB) — visibles dans la grille si MediaLibrary renvoie 0. */
export function pushStatusGridLocalPicks(
  entries: { uri: string; width?: number; height?: number }[],
): void {
  if (!entries.length) return;
  const stamped = Date.now();
  const fresh: RecentGalleryPhoto[] = entries
    .map((e, i) => {
      const uri = String(e.uri ?? "").trim();
      if (!uri) return null;
      return {
        id: `local-pick-${stamped}-${i}`,
        uri,
        width: e.width ?? 0,
        height: e.height ?? 0,
      };
    })
    .filter((x): x is RecentGalleryPhoto => x !== null);
  if (!fresh.length) return;
  const seen = new Set(fresh.map((p) => p.uri));
  items = [...fresh, ...items.filter((p) => !seen.has(p.uri))].slice(0, MAX);
}

export function getStatusGridLocalCache(): RecentGalleryPhoto[] {
  return items;
}

export function mergeStatusGridSources(
  fromLibrary: RecentGalleryPhoto[],
): RecentGalleryPhoto[] {
  const local = getStatusGridLocalCache();
  if (!fromLibrary.length) return local;
  if (!local.length) return fromLibrary;
  const seen = new Set(fromLibrary.map((p) => p.uri));
  const extra = local.filter((p) => !seen.has(p.uri));
  return [...fromLibrary, ...extra];
}
