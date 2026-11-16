// The poll lives in the native meetup chat; importing the native file would pull private meetup RPC names into the public web export.
export function MeetupPollCard(_props: { postId: string; refreshKey?: number }) { return null; }
export function MeetupPollComposer(_props: { postId: string; visible: boolean; onClose: () => void; onCreated: () => void }) { return null; }
