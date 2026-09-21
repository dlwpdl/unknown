import { copyFileSync } from 'node:fs';
// GitHub Pages serves this for app-only paths and existing /post/:id links.
copyFileSync('dist/+not-found.html', 'dist/404.html');
