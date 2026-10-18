


## 실행

Node.js 22.13 이상과 npm을 사용합니다.

```sh
npm ci
cp .env.example .env.local
# .env.local에 기존 Supabase 프로젝트의 공개 URL·publishable key를 설정합니다.
npm start
```

`npm run ios`는 Xcode와 CocoaPods가 필요합니다. 네이티브 `ios/`는 `app.json`에서 생성되며 Git에 저장하지 않습니다. 서버용 비밀키는 Supabase Edge Function secrets에만 설정합니다.

## 검증

```sh
npm test
npm run typecheck
npm run lint
npx expo install --check
npx expo export --platform web
npx supabase test db # 실행 중이며 최신 migration이 적용된 로컬 Supabase 필요
```



`mobile-app`에 푸시하면 기존 GitHub Pages 워크플로가 웹사이트를 배포합니다. TestFlight·Google Play 빌드 업로드와 각 스토어 심사는 별도 단계입니다.
