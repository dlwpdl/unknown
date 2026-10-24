# Chat close and conversation settings

Owner request: separate closing the screen from ending the conversation.

- The top Close control only dismisses the current room and uses the normal foreground color.
- Move conversation-level end, report and block actions into an accessible room-settings control.
- Preserve permissions and existing confirmation flows. Ending a conversation uses the existing danger color and an explicit confirmation action.
- Keep message-specific reporting attached to its message.
- Retain the room during native dismissal; ignore stale dismissal callbacks and preserve the current room when closing its nested overview.
- Show upcoming schedules and current participation before secondary introductory content. Never invent RSVP or per-session venue data.
- Reuse the existing map snapshot for shared locations and show an approximate address without requesting GPS access for a received pin.
- Verify settings on small screens and large text. QA must not actually end a real conversation or submit a report.
