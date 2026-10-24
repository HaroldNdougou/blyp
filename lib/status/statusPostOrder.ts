import type { StatusPost } from "@/lib/api/types";

/** Horodatage pour l’ordre de passage (modification = republication). */
export function statusPostSortMs(post: StatusPost): number {
  const edited = Date.parse(String(post.editedAt ?? ""));
  if (Number.isFinite(edited)) return edited;
  const created = Date.parse(String(post.createdAt ?? ""));
  return Number.isFinite(created) ? created : 0;
}

export function sortStatusPostsChronological(posts: StatusPost[]): StatusPost[] {
  return [...posts].sort((a, b) => statusPostSortMs(a) - statusPostSortMs(b));
}

/** ISO affiché sous le nom (date de modif si présente). */
export function statusPostDisplayWhenIso(post: StatusPost): string {
  return String(post.editedAt ?? post.createdAt ?? "");
}
