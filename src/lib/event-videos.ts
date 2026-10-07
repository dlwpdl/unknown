// Play only a video URL supplied with this event's Ticketmaster data.
export function eventVideo(event: { videoYoutubeId?: string | null }) {
  return event.videoYoutubeId ? { youtubeId: event.videoYoutubeId, label: '행사 관련 영상' } : null;
}
