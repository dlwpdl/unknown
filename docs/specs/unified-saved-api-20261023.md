# Saved library client contract

Root-approved client boundary for parallel implementation. Backend verifies exact schema and permission helpers; it must not weaken these semantics to fit a DTO. All exports live in `src/lib/saved-items.ts` and use the installed SupabaseClient.

```ts
type SavedKind = 'post' | 'merchant' | 'place' | 'user';
type SavedFilter = 'all' | 'places' | 'posts' | 'jobs' | 'users';
type SavedTarget = { kind: SavedKind; id: string; cityId?: string };
type SavedCursor = { savedAt: string; key: string };
type SavedState = {
  target: SavedTarget; saved: boolean; available: boolean;
  savedAt: string | null; folderIds: string[];
};
type SavedFolder = { id: string; name: string };
type SavedItem = {
  key: string; target: SavedTarget; savedAt: string;
  title: string; subtitle: string; imageUrl?: string | null;
  cityId?: string | null; address?: string | null;
  postType?: 'post' | 'meetup' | 'job' | 'listing';
  closed?: boolean; hasWebshop?: boolean; folderIds: string[];
};
type SavedPage = { items: SavedItem[]; hasMore: boolean; nextCursor: SavedCursor | null };

loadSavedItems(client, options?: {
  filter?: SavedFilter; query?: string; folderId?: string | null;
  cursor?: SavedCursor | null;
}): Promise<SavedPage>;
loadSavedItemState(client, target: SavedTarget): Promise<SavedState>;
setSavedItem(client, target: SavedTarget, saved: boolean): Promise<SavedState>;
loadSavedFolders(client): Promise<SavedFolder[]>;
createSavedFolder(client, name: string): Promise<SavedFolder>;
renameSavedFolder(client, folderId: string, name: string): Promise<SavedFolder>;
deleteSavedFolder(client, folderId: string): Promise<void>;
setSavedItemFolders(client, target: SavedTarget, folderIds: string[]): Promise<void>;
```

Use camelCase client fields; the library validates/maps the RPC's actual JSON shape. A raw place can resolve to a merchant target. Identity resolution is server authoritative and must apply to state, mutation, read, folder membership and legacy merchant APIs. Never merge by name. The plain `post` filter includes regular posts, meetups and listings; `jobs` is the separate saved hiring-post view.

Cards navigate by target: post→`/post/[id]`, merchant→`/company/[id]`, place→`/places/[id]?cityId=...`, user→`/user/[id]`. `hasWebshop` is only a current-offer eligibility hint. Clicking order loads the current public Webshop and opens the existing comparison sheet; no stored comparison quote or untracked external link.

Profile/place controls read and mutate through state methods. The company entry keeps its existing single bookmark and separate opt-in notifications. The backend must preserve old merchant APIs when a saved place acquires a business connection; tell root before changing any part of this contract.

No production application/deployment is part of these parallel source slices. Meaningful checks cover owner isolation/visibility, aliases, savedAt pagination, folder ownership and deletion preserving saves, category/query/folder stale responses and failed mutations.
