(() => {
  try {
    const primary = document.getElementById('share-primary-cta');
    if (!primary || primary.tagName !== 'A') return;
    const target = new URL(primary.href, location.href);
    const share = location.pathname.match(/^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    const ids = target.searchParams.getAll('id');
    const shared = target.searchParams.getAll('shared');
    const invites = target.searchParams.getAll('invite');
    if (!share || target.protocol !== 'https:' || target.origin !== 'https://gling.ej-entertainment.com'
      || target.username || target.password || target.pathname !== '/post' || target.hash
      || ids.length !== 1 || ids[0].toLowerCase() !== share[1].toLowerCase()
      || shared.length !== 1 || shared[0] !== '1' || invites.length > 1 || (invites.length && invites[0] !== '1')
      || Array.from(target.searchParams.keys()).some(key => !['id', 'shared', 'invite'].includes(key))) return;
    location.replace(target.href);
  } catch { /* The visible CTA remains available if automatic navigation fails. */ }
})();
