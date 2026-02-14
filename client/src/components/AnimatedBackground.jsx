import { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 20;
const COLORS = ['#ff2d92', '#b829dd', '#29dddd', '#ddff29'];

function AnimatedBackground() {
  const particlesRef = useRef(null);

  useEffect(() => {
    const container = particlesRef.current;
    if (!container) return;

    // Clear existing particles
    container.innerHTML = '';

    // Generate floating particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';

      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const size = 2 + Math.random() * 4;

      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDuration = `${8 + Math.random() * 12}s`;
      particle.style.animationDelay = `${Math.random() * 10}s`;
      particle.style.background = color;
      particle.style.boxShadow = `0 0 10px ${color}`;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;

      container.appendChild(particle);
    }

    return () => {
      container.innerHTML = '';
    };
  }, []);

  return (
    <div className="bg-container">
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>
      <div className="blob blob-3"></div>
      <div className="blob blob-4"></div>
      <div className="particles" ref={particlesRef}></div>
      <div className="noise"></div>
      <div className="scanlines"></div>
    </div>
  );
}

export default AnimatedBackground;
