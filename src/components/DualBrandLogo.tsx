/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DualBrandLogo — Componente reutilizable de Dual Branding
 * Úsalo en Sidebar, Navbar, Login, Splash, etc.
 *
 * Props:
 *   variant: 'dark' | 'light' | 'cream'
 *     'dark'  → logos blancos sobre fondo #1A1A1A (ideal sidebar oscura)
 *     'light' → logos negros sobre fondo blanco (ideal navbar)
 *     'cream' → logos naturales sobre fondo #FAF6F3 (ideal login)
 *   size: 'sm' | 'md' | 'lg'
 *   showWordmarks: boolean (muestra wordmarks además del isotipo)
 *   orientation: 'horizontal' | 'vertical'
 */

interface DualBrandLogoProps {
  variant?: 'dark' | 'light' | 'cream';
  size?: 'sm' | 'md' | 'lg';
  showWordmarks?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

const sizeMap = {
  sm: { logo: 'w-6 h-6', text: '12px', divider: 'h-4' },
  md: { logo: 'w-9 h-9', text: '15px', divider: 'h-6' },
  lg: { logo: 'w-16 h-16', text: '22px', divider: 'h-10' },
};

const variantMap = {
  dark: {
    bg: '#1A1A1A',
    filter: 'brightness(0) invert(1)',
    wordmarkPrimary: 'rgba(255,255,255,0.95)',
    wordmarkSecondary: 'rgba(255,255,255,0.55)',
    divider: 'rgba(255,255,255,0.12)',
    cross: 'rgba(255,255,255,0.25)',
  },
  light: {
    bg: '#FFFFFF',
    filter: 'none',
    wordmarkPrimary: '#0F0F0F',
    wordmarkSecondary: '#6B6B6B',
    divider: 'rgba(0,0,0,0.1)',
    cross: 'rgba(0,0,0,0.2)',
  },
  cream: {
    bg: '#FAF6F3',
    filter: 'none',
    wordmarkPrimary: '#1A1A1A',
    wordmarkSecondary: '#8C7B72',
    divider: 'rgba(0,0,0,0.08)',
    cross: 'rgba(0,0,0,0.15)',
  },
};

export default function DualBrandLogo({
  variant = 'light',
  size = 'md',
  showWordmarks = true,
  orientation = 'horizontal',
  className = '',
}: DualBrandLogoProps) {
  const s = sizeMap[size];
  const v = variantMap[variant];
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={`flex ${isVertical ? 'flex-col items-center' : 'flex-row items-center'} gap-4 ${className}`}
      role="img"
      aria-label="MindPsic × MindHealth — Ecosistema Clínico"
    >
      {/* ── MindPsic ── */}
      <div className={`flex ${isVertical ? 'flex-col items-center' : 'flex-row items-center'} gap-2.5`}>
        <div className={`${s.logo} flex items-center justify-center shrink-0`}>
          <img
            src="/logos/mindpsic.png"
            alt="MindPsic"
            className="max-w-full max-h-full object-contain"
            style={{ filter: v.filter }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        {showWordmarks && (
          <span
            className="font-semibold tracking-[0.15em] leading-none select-none shrink-0"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: s.text,
              color: v.wordmarkPrimary,
            }}
          >
            MINDPSIC
          </span>
        )}
      </div>

      {/* Separador × */}
      <div
        className={`flex items-center justify-center shrink-0 ${isVertical ? 'my-1' : ''}`}
        aria-hidden="true"
      >
        {isVertical ? (
          <div className="w-8 h-px" style={{ backgroundColor: v.divider }} />
        ) : (
          <span
            className="font-mono text-xs leading-none"
            style={{ color: v.cross, letterSpacing: '0.1em' }}
          >
            ×
          </span>
        )}
      </div>

      {/* ── MindHealth ── */}
      <div className={`flex ${isVertical ? 'flex-col items-center' : 'flex-row items-center'} gap-2`}>
        <div
          className={`${
            size === 'lg' ? 'w-14 h-14' : size === 'md' ? 'w-8 h-8' : 'w-5 h-5'
          } flex items-center justify-center shrink-0`}
        >
          <img
            src="/logos/mindhealth.png"
            alt="MindHealth"
            className="max-w-full max-h-full object-contain"
            style={{ filter: v.filter }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
        {showWordmarks && (
          <span
            className="font-light tracking-[0.18em] leading-none select-none shrink-0"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: `calc(${s.text} - 1px)`,
              color: v.wordmarkSecondary,
            }}
          >
            MINDHEALTH
          </span>
        )}
      </div>
    </div>
  );
}

/*
 * ──────────────────────────────────────────────
 *  GUÍA DE USO
 * ──────────────────────────────────────────────
 *
 * En Navbar (fondo blanco):
 *   <DualBrandLogo variant="light" size="md" showWordmarks />
 *
 * En Sidebar oscura:
 *   <DualBrandLogo variant="dark" size="md" orientation="vertical" />
 *
 * En Login (fondo crema):
 *   <DualBrandLogo variant="cream" size="lg" orientation="vertical" />
 *
 * Solo isotipos (mobile):
 *   <DualBrandLogo variant="light" size="sm" showWordmarks={false} />
 *
 * ──────────────────────────────────────────────
 *  COLOCACIÓN DE LOS ARCHIVOS DE LOGO
 * ──────────────────────────────────────────────
 * public/
 *   logos/
 *     mindpsic.png    ← Logo MindPsic (fondo transparente preferido)
 *     mindhealth.png  ← Logo MindHealth (fondo transparente preferido)
 *
 * Si los logos tienen fondo sólido blanco o negro, el prop `variant`
 * aplicará el filtro CSS correcto automáticamente.
 * ──────────────────────────────────────────────
 */