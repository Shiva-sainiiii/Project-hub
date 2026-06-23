/* ══════════════════════════════════════════════════
   SHIVA SAINI PORTFOLIO — script.js
   Shader-based Moon (ported from Three.js Journey)
   + ParticleJS stars + GSAP animations + Typewriter
══════════════════════════════════════════════════ */

// ── 1. LUCIDE ICONS ──────────────────────────────
lucide.createIcons();

// ── 2. GSAP + SCROLLTRIGGER ──────────────────────
gsap.registerPlugin(ScrollTrigger);

// ── 3. NAVBAR ────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 30);
  updateActiveLink();
}, { passive: true });

// ── 4. HAMBURGER ─────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  navLinks.classList.toggle('open');
});
navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
  });
});

// ── 5. ACTIVE LINK ───────────────────────────────
function updateActiveLink () {
  const sections = document.querySelectorAll('section[id]');
  const scrollY = window.scrollY + 100;
  sections.forEach(section => {
    const id = section.getAttribute('id');
    const link = document.querySelector(`.nav-link[href="#${id}"]`);
    if (!link) return;
    if (scrollY >= section.offsetTop && scrollY < section.offsetTop + section.offsetHeight) {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    }
  });
}

// ── 6. PARTICLES.JS — BLINKING STARS - FIXED ─────────────
particlesJS('particles-js', {
  particles: {
    number: { value: 150, density: { enable: true, value_area: 800 } },
    color: { value: '#ffffff' },
    shape: { type: 'circle' },
    opacity: {
      value: 0.6,
      random: true,
      anim: { enable: true, speed: 0.8, opacity_min: 0.1, sync: false }
    },
    size: {
      value: 2,
      random: true,
      anim: { enable: true, speed: 1.5, size_min: 0.3, sync: false }
    },
    line_linked: { enable: false },
    move: {
      enable: true, speed: 0.15, direction: 'none',
      random: true, straight: false, out_mode: 'out', bounce: false
    }
  },
  interactivity: {
    detect_on: 'canvas',
    events: { onhover: { enable: true, mode: 'repulse' }, onclick: { enable: false }, resize: true },
    modes: { repulse: { distance: 100, duration: 0.4 } }
  },
  retina_detect: true
});

// ══════════════════════════════════════════════════
// ── 7. THREE.JS — SHADER MOON (Option A port) ────
// ══════════════════════════════════════════════════
(function initShaderMoon () {

  // ── Texture URLs ──────────────────────────────
  const MOON_DAY = 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/17271/lroc_color_poles_1k.jpg';
  const MOON_BUMP = 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/17271/ldem_3_8bit.jpg';
  const STAR_TEX = 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/17271/hipp8_s.jpg';

  // ── Inline VERTEX shader ──
  const vertexShader = /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vec4 modelPosition = modelMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * modelPosition;
      vec3 modelNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
      vUv = uv;
      vNormal = modelNormal;
      vPosition = modelPosition.xyz;
    }
  `;

  // ── Inline FRAGMENT shader ──
  const fragmentShader = /* glsl */`
    uniform sampler2D uDayTexture;
    uniform sampler2D uBumpTexture;
    uniform vec3 uSunDirection;
    uniform vec3 uAtmosphereColor;
    uniform float uAtmosphereStrength;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vec3 viewDirection = normalize(vPosition - cameraPosition);
      vec3 normal = normalize(vNormal);
      float sunDot = dot(normal, uSunDirection);
      float sunFacing = max(0.0, sunDot);
      float darkSide = smoothstep(-0.3, 0.3, sunDot);
      vec3 dayColor = texture2D(uDayTexture, vUv).rgb;
      float grey = dot(dayColor, vec3(0.299, 0.587, 0.114));
      dayColor = vec3(grey);
      vec3 nightColor = vec3(0.02, 0.02, 0.025);
      vec3 surfaceColor = mix(nightColor, dayColor * 0.85, darkSide);
      vec3 reflectDir = reflect(-uSunDirection, normal);
      float spec = pow(max(dot(-viewDirection, reflectDir), 0.0), 18.0);
      surfaceColor += vec3(spec * 0.06 * sunFacing);
      float rimFactor = 1.0 - max(dot(-viewDirection, normal), 0.0);
      rimFactor = pow(rimFactor, 3.5);
      float rimLit = smoothstep(-0.1, 0.4, sunDot);
      vec3 rimColor = uAtmosphereColor * rimFactor * rimLit * uAtmosphereStrength;
      surfaceColor += rimColor;
      float limbDark = pow(max(dot(-viewDirection, normal), 0.0), 0.6);
      surfaceColor *= mix(0.0, 1.0, limbDark);
      gl_FragColor = vec4(surfaceColor, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  // ── Renderer ──────────────────────────────────
  const canvas = document.getElementById('planet-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Scene & Camera ────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(12, 3, 4);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  // ── Texture Loader ────────────────────────────
  const loader = new THREE.TextureLoader();

  // ── Starfield background ──────────────────────
  loader.load(STAR_TEX, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const starMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 60, 60),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: 0x777777 })
    );
    scene.add(starMesh);
  });

  // ── Sun direction ──
  const sunDirection = new THREE.Vector3(-1, 0.1, 0.5).normalize();

  // ── Moon ShaderMaterial ───────────────────────
  const moonMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uDayTexture: { value: null },
      uBumpTexture: { value: null },
      uSunDirection: { value: sunDirection },
      uAtmosphereColor: { value: new THREE.Color(0.3, 0.35, 0.4) },
      uAtmosphereStrength: { value: 0.18 },
    }
  });

  loader.load(MOON_DAY, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    moonMaterial.uniforms.uDayTexture.value = tex;
  });
  loader.load(MOON_BUMP, tex => {
    moonMaterial.uniforms.uBumpTexture.value = tex;
  });

  // ── Moon Mesh ─────────────────────────────────
  const isMobile = () => window.innerWidth < 700;
  const moonGeo = new THREE.SphereGeometry(2, 64, 64);
  const moon = new THREE.Mesh(moonGeo, moonMaterial);
  moon.rotation.x = Math.PI * 0.02;
  moon.rotation.y = Math.PI * 1.54;
  moon.position.set(isMobile()? 2.5 : 1.6, 0, 0);
  scene.add(moon);

  // ── Scroll rotation ───────────────────────────
  let scrollY = 0;
  window.addEventListener('scroll', () => {
    scrollY = window.scrollY;
  }, { passive: true });

  // ── Resize ────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    moon.position.x = isMobile()? 2.5 : 1.6;
  });

  // ── Animate ──
  const clock = new THREE.Clock();
  (function tick () {
    requestAnimationFrame(tick);
    const elapsed = clock.getElapsedTime();
    moon.rotation.y = elapsed * 0.08 + scrollY * 0.001;
    moon.rotation.x = Math.PI * 0.02 + scrollY * 0.00008;
    renderer.render(scene, camera);
  })();

})();

// ── 8. TYPEWRITER EFFECT - NEW ───────────────────
const typewriter = document.getElementById('typewriter');
const words = ['FULL STACK DEVELOPER', 'UI/UX DESIGNER', 'BACKEND ENGINEER', 'DEVOPS ENTHUSIAST'];
let wordIndex = 0;
let charIndex = 0;
let isDeleting = false;

function type() {
  const currentWord = words[wordIndex];

  if (isDeleting) {
    typewriter.textContent = currentWord.substring(0, charIndex - 1);
    charIndex--;
  } else {
    typewriter.textContent = currentWord.substring(0, charIndex + 1);
    charIndex++;
  }

  if (!isDeleting && charIndex === currentWord.length) {
    isDeleting = true;
    setTimeout(type, 2000); // Pause at end
  } else if (isDeleting && charIndex === 0) {
    isDeleting = false;
    wordIndex = (wordIndex + 1) % words.length;
    setTimeout(type, 500); // Pause before next word
  } else {
    setTimeout(type, isDeleting? 50 : 100);
  }
}

// ── 9. GSAP HERO ENTRANCE - UPDATED ────────────────────────
window.addEventListener('load', () => {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.to('#heroBadge', { opacity: 1, y: 0, duration: 0.8 })
   .to('#heroLogo', { opacity: 1, scale: 1, duration: 1 }, '-=0.4')
   .to('#heroName', { opacity: 1, y: 0, duration: 0.8 }, '-=0.4')
   .to('#heroTitle', { opacity: 1, duration: 0.7 }, '-=0.4')
   .to('#heroDesc', { opacity: 1, y: 0, duration: 0.7 }, '-=0.3')
   .to('#heroBtnGroup', { opacity: 1, duration: 0.6 }, '-=0.3')
   .to('#heroSocials', { opacity: 1, duration: 0.6 }, '-=0.2')
   .call(() => type()); // Start typewriter after animations
});

// ── 10. SCROLL REVEAL ─────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const delay = entry.target.dataset.delay || 0;
      setTimeout(() => entry.target.classList.add('in-view'), +delay);
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ── 11. COUNTER ANIMATION ────────────────────────
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target, target = +el.dataset.target, start = performance.now(), dur = 1800;
    (function tick (now) {
      const t = Math.min((now - start) / dur, 1);
      el.textContent = Math.floor((1 - Math.pow(1 - t, 3)) * target);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    })(start);
    counterObserver.unobserve(el);
  });
}, { threshold: 0.5 });
document.querySelectorAll('.stat-num').forEach(c => counterObserver.observe(c));

// ── 12. SECTION PARALLAX ─────────────────────────
gsap.utils.toArray('.section').forEach(section => {
  gsap.from(section, {
    scrollTrigger: { trigger: section, start: 'top 90%' },
    opacity: 0, y: 20, duration: 0.8, ease: 'power2.out'
  });
});

// ── 13 & 14. SKILL + PROJECT CARDS ───────────────
// Removed GSAP ScrollTrigger animations — cards already use
// .reveal class which IntersectionObserver handles reliably
// on both desktop and mobile. Duplicate GSAP from() was
// overriding IntersectionObserver and leaving cards invisible
// on mobile where ScrollTrigger fails to fire.