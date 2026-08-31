import { Redirect } from 'expo-router';

export default function ComposeRedirect() {
  return <Redirect href="/?compose=1" />;
}
