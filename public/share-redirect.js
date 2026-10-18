(() => {
  try {
    const primary = document.getElementById('share-primary-cta');
    if (!primary || primary.tagName !== 'A') return;
    const target = new URL(primary.href, location.href);
    const share = location.pathname.match(/^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    const short = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{22})\/?$/);
    const ids = target.searchParams.getAll('id');
    const shared = target.searchParams.getAll('shared');
    const invites = target.searchParams.getAll('invite');
    if ((!share && !short) || target.protocol !== 'https:' || target.origin !== 'https://gling.ej-entertainment.com'
      || target.username || target.password || target.pathname !== '/post' || target.hash
      || ids.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ids[0])
      || shared.length !== 1 || shared[0] !== '1' || invites.length > 1 || (invites.length && invites[0] !== '1')
      || Array.from(target.searchParams.keys()).some(key => !['id', 'shared', 'invite'].includes(key))) return;
    if (share && ids[0].toLowerCase() !== share[1].toLowerCase()) return;
    if (short) {
      const bytes = ids[0].replace(/-/g, '').match(/../g).map(hex => String.fromCharCode(parseInt(hex, 16))).join('');
      if (btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== short[1]) return;
    }
    location.replace(target.href);
  } catch { /* The visible CTA remains available if automatic navigation fails. */ }
})();
