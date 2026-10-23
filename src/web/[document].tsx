import type { GenerateMetadataFunction } from 'expo-router/server';
import { publicMetadata, generatePrivateMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';
import { LEGAL_DOCUMENTS, type LegalDocumentSlug } from '@/lib/legal-documents';
import { useLocalSearchParams } from 'expo-router';
import LegalDocumentPage from '../app/[document].web';
import PublicReader from '@/components/public-web/reader';
export { generateStaticParams } from '../app/[document].web';

export default function PublicDocument() {
  const { document } = useLocalSearchParams<{ document: string }>();
  return ['terms', 'privacy', 'account-deletion', 'child-safety'].includes(document) ? <LegalDocumentPage /> : <PublicReader />;
}

export const generateMetadata: GenerateMetadataFunction = (_request, { document }) => {
  if (typeof document !== 'string' || !Object.hasOwn(LEGAL_DOCUMENTS, document)) return generatePrivateMetadata();
  const page = LEGAL_DOCUMENTS[document as LegalDocumentSlug];
  return publicMetadata(`${page.title} | gling`, page.summary, `${PUBLIC_SITE}/${document}`);
};
