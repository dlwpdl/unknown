/* Gling City Stories. Existing GSAP / Lenis bundles are licensed in this directory. */
(() => {
  window.createGlingCityStoriesMotion = root => {
    const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
    if (!gsap || !ScrollTrigger || !window.Lenis) return null;
    gsap.registerPlugin(ScrollTrigger);
    const wall = root.querySelector('.wall'), layers = [...root.querySelectorAll('[data-float]')];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let lenis = null, trigger = null, paused = false, visible = true, clock = 0, progress = 0, x = 0, y = 0, aimX = 0, aimY = 0;
    function configure() {
      lenis?.destroy(); trigger?.kill(); lenis = trigger = null;
      layers.forEach(el => gsap.set(el, { clearProps: 'transform' })); progress = 0;
      if (reduced.matches) return;
      lenis = new window.Lenis({ duration: 1.05, smoothWheel: true, anchors: true, prevent: el => !!el.closest('dialog') });
      lenis.on('scroll', ScrollTrigger.update);
      trigger = ScrollTrigger.create({ trigger: root.querySelector('.hero-grid'), start: 'top top', end: 'bottom top', onUpdate: self => { progress = self.progress; } });
    }
    configure(); reduced.addEventListener('change', configure);
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }); observer.observe(wall);
    const move = event => { if (event.pointerType === 'touch') return; const r = wall.getBoundingClientRect(); aimX = (event.clientX-r.left)/r.width-.5; aimY = (event.clientY-r.top)/r.height-.5; };
    const leave = () => { aimX = aimY = 0; };
    wall.addEventListener('pointermove', move); wall.addEventListener('pointerleave', leave);
    const tick = (time, delta) => {
      lenis?.raf(time*1000);
      if (document.hidden || !visible || paused || reduced.matches) return;
      clock += delta/1000; const blend = Math.min(1,delta/1000*4); x += (aimX-x)*blend; y += (aimY-y)*blend;
      layers.forEach((el,i) => { const phase = clock*(.42+i*.035)+i*1.5;
        gsap.set(el,{x:Math.sin(phase)*[4,7,5,3][i]+x*[16,-25,25,-12][i], y:Math.cos(phase*.9)*[6,8,6,4][i]+y*[12,-16,18,-10][i]+progress*[28,-24,-10,15][i], rotation:Math.sin(phase*.6)*.65});
      });
    };
    gsap.ticker.add(tick);
    return { setPaused(value) { paused = value; }, dispose() {
      gsap.ticker.remove(tick); lenis?.destroy(); trigger?.kill(); observer.disconnect();
      reduced.removeEventListener('change', configure); wall.removeEventListener('pointermove', move); wall.removeEventListener('pointerleave', leave);
      layers.forEach(el => gsap.set(el,{clearProps:'transform'}));
    } };
  };
})();
