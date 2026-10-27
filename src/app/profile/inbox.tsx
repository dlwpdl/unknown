import { Redirect } from 'expo-router';

// The bell tab is the only notification list; old links to the profile inbox land there.
export default function ProfileInbox() {
  return <Redirect href="/notifications" />;
}
