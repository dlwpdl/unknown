import { useLocalSearchParams } from 'expo-router';
import LegalDocumentPage from '../app/[document].web';
import PublicReader from '@/components/public-web/reader';
export { generateStaticParams } from '../app/[document].web';

export default function PublicDocument() {
  const { document } = useLocalSearchParams<{ document: string }>();
  return ['terms', 'privacy', 'account-deletion', 'child-safety'].includes(document) ? <LegalDocumentPage /> : <PublicReader />;
}
