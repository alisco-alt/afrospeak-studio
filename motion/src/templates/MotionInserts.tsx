import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

// ==========================================
// 1. HEADLINE HIGHLIGHTER
// ==========================================
export interface HeadlineHighlighterProps {
  newspaper?: string;
  date?: string;
  headline?: string;
  highlightText?: string;
  category?: string;
}

export const HeadlineHighlighter: React.FC<HeadlineHighlighterProps> = ({
  newspaper = 'FINANCIAL TIMES',
  date = 'ACTUALITÉ ÉCONOMIQUE',
  headline = 'MINERAIS STRATÉGIQUES : DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ',
  highlightText = 'DIX MULTINATIONALES CONTRÔLENT LE MARCHÉ',
  category = 'EXCLUSIF',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Entrée élégante en zoom lent continu (style Money Radar)
  const scale = interpolate(frame, [0, 90], [0.95, 1.04], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  
  // Animation du surlignage feutre jaune après 12 frames
  const hlProgress = interpolate(frame, [12, 35], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <div
        style={{
          width: width * 0.82,
          maxWidth: 1300,
          opacity,
          transform: `scale(${scale})`,
          backgroundColor: '#F8F6F0',
          borderRadius: 8,
          boxShadow: '0 30px 100px rgba(0,0,0,0.85), 0 0 40px rgba(255,215,0,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          padding: '40px 60px',
          color: '#111111',
          fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        }}
      >
        {/* Entête du journal */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '3px solid #111111',
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span
              style={{
                backgroundColor: '#B3202A',
                color: '#FFF',
                padding: '4px 12px',
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: 1.5,
                borderRadius: 3,
              }}
            >
              {category}
            </span>
            <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>{newspaper}</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#555' }}>{date}</span>
        </div>

        {/* Titre principal */}
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.25,
            letterSpacing: -0.5,
            marginBottom: 20,
            textTransform: 'uppercase',
          }}
        >
          {headline.includes(highlightText) ? (
            <>
              {headline.split(highlightText)[0]}
              <span
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  zIndex: 1,
                  padding: '0 6px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '15%',
                    height: '75%',
                    width: `${hlProgress}%`,
                    backgroundColor: 'rgba(255, 225, 53, 0.85)',
                    zIndex: -1,
                    borderRadius: 3,
                  }}
                />
                {highlightText}
              </span>
              {headline.split(highlightText)[1]}
            </>
          ) : (
            headline
          )}
        </div>

        {/* Pied de l'article */}
        <div
          style={{
            display: 'flex',
            gap: 20,
            fontSize: 15,
            color: '#666',
            borderTop: '1px solid #DDD',
            paddingTop: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>ANALYSE DES MARCHÉS</span>
          <span>•</span>
          <span>FLUX MONDIAUX</span>
          <span>•</span>
          <span>DÉPÊCHE SPECIALE</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};


// ==========================================
// 2. DATA PULSE (COMPTEUR DYNAMIQUE)
// ==========================================
export interface DataPulseProps {
  value?: number;
  suffix?: string;
  prefix?: string;
  label?: string;
  sublabel?: string;
  color?: string;
}

export const DataPulse: React.FC<DataPulseProps> = ({
  value = 30,
  suffix = '%',
  prefix = '',
  label = 'DES MINERAIS DE LA PLANÈTE',
  sublabel = 'Ressources mondiales concentrées en Afrique',
  color = '#FFD700',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation de comptage fluide (0 à valeur en 25 frames)
  const count = interpolate(frame, [0, 25], [0, value], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const displayVal = Number.isInteger(value) ? Math.round(count) : count.toFixed(1);

  // Pulse spring impact à l'arrivée du chiffre
  const scale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          transform: `scale(${0.9 + scale * 0.1})`,
          textAlign: 'center',
          background: 'rgba(10, 14, 24, 0.75)',
          padding: '40px 70px',
          borderRadius: 16,
          border: '1.5px solid rgba(255, 215, 0, 0.35)',
          boxShadow: '0 20px 80px rgba(0,0,0,0.8), 0 0 50px rgba(255,215,0,0.2)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div
          style={{
            fontSize: 120,
            fontWeight: 900,
            color,
            lineHeight: 1,
            letterSpacing: -2,
            textShadow: '0 0 40px rgba(255, 215, 0, 0.5)',
          }}
        >
          {prefix}{displayVal}{suffix}
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: '#FFFFFF',
            marginTop: 18,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        {sublabel && (
          <div
            style={{
              fontSize: 18,
              color: '#A0AEC0',
              marginTop: 10,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {sublabel}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};


// ==========================================
// 3. ROUTE MAP (CARTE ET TRACÉ NÉON)
// ==========================================
export interface RouteMapProps {
  origin?: string;
  destination?: string;
  resource?: string;
  subtext?: string;
}

export const RouteMap: React.FC<RouteMapProps> = ({
  origin = 'AFRIQUE (RDC / GUINÉE)',
  destination = 'CENTRES INDUSTRIELS MONDIAUX',
  resource = 'COBALT & BAUXITE BRUTS',
  subtext = 'Flux de matières premières sans transformation locale',
}) => {
  const frame = useCurrentFrame();

  // Animation de tracé néon
  const lineProgress = interpolate(frame, [5, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          width: 1200,
          height: 600,
          background: 'rgba(8, 12, 22, 0.85)',
          borderRadius: 20,
          border: '1.5px solid rgba(0, 212, 255, 0.3)',
          boxShadow: '0 30px 100px rgba(0,0,0,0.85), 0 0 60px rgba(0,212,255,0.15)',
          padding: 40,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Entête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#00D4FF', fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>
              ROUTE COMMERCIALE STRATÉGIQUE
            </div>
            <div style={{ color: '#FFF', fontSize: 28, fontWeight: 800 }}>{resource}</div>
          </div>
          <div style={{ color: '#888', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
            TRANSIT SANS VALEUR AJOUTÉE
          </div>
        </div>

        {/* Tracé SVG interactif */}
        <div style={{ position: 'relative', height: 320, display: 'flex', alignItems: 'center' }}>
          <svg width="100%" height="240" viewBox="0 0 1100 240">
            {/* Grille stylisée */}
            <line x1="50" y1="120" x2="1050" y2="120" stroke="rgba(255,255,255,0.08)" strokeDasharray="6,6" />
            
            {/* Trajectoire néon */}
            <path
              d="M 150 160 Q 550 20 950 120"
              fill="none"
              stroke="#00D4FF"
              strokeWidth="5"
              strokeDasharray="900"
              strokeDashoffset={900 * (1 - lineProgress)}
              style={{ filter: 'drop-shadow(0 0 12px #00D4FF)' }}
            />

            {/* Point de départ */}
            <circle cx="150" cy="160" r="12" fill="#FF5F57" />
            <circle cx="150" cy="160" r="22" fill="none" stroke="#FF5F57" opacity="0.6" strokeWidth="2" />
            
            {/* Point d'arrivée */}
            <circle cx="950" cy="120" r="12" fill="#28C840" />
            <circle cx="950" cy="120" r="22" fill="none" stroke="#28C840" opacity="0.6" strokeWidth="2" />
          </svg>

          {/* Labels des points */}
          <div style={{ position: 'absolute', left: 100, bottom: 20 }}>
            <div style={{ color: '#FF5F57', fontWeight: 800, fontSize: 18 }}>DÉPART</div>
            <div style={{ color: '#FFF', fontSize: 20, fontWeight: 700 }}>{origin}</div>
          </div>

          <div style={{ position: 'absolute', right: 80, top: 40, textAlign: 'right' }}>
            <div style={{ color: '#28C840', fontWeight: 800, fontSize: 18 }}>DESTINATION</div>
            <div style={{ color: '#FFF', fontSize: 20, fontWeight: 700 }}>{destination}</div>
          </div>
        </div>

        {/* Pied */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16, color: '#A0AEC0', fontSize: 16 }}>
          {subtext}
        </div>
      </div>
    </AbsoluteFill>
  );
};


// ==========================================
// 4. PAPER CUTOUT PORTRAIT (PORTRAIT DÉTOURÉ)
// ==========================================
export interface PaperCutoutProps {
  name?: string;
  role?: string;
  image?: string;
  quote?: string;
}

export const PaperCutoutPortrait: React.FC<PaperCutoutProps> = ({
  name = 'GÉANTS INDUSTRIELS',
  role = 'NÉGOCE ET EXTRACTION MONDIALE',
  quote = 'La valeur part, les emplois restent ailleurs',
}) => {
  const frame = useCurrentFrame();

  const entrance = interpolate(frame, [0, 15], [0.8, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        style={{
          width: 1100,
          background: 'rgba(12, 16, 28, 0.85)',
          borderRadius: 16,
          border: '2px solid rgba(255,255,255,0.15)',
          boxShadow: '0 30px 100px rgba(0,0,0,0.85)',
          padding: '40px 60px',
          display: 'flex',
          alignItems: 'center',
          gap: 50,
          transform: `scale(${entrance})`,
          opacity,
        }}
      >
        {/* Silhouette / Médaillon découpé façon papier journal avec contour crayonné blanc */}
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #1A2238 0%, #0D111A 100%)',
            border: '4px dashed #FFFFFF',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transform: 'rotate(-2deg)',
          }}
        >
          <svg width="140" height="140" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>

        {/* Texte et citation */}
        <div>
          <div style={{ color: '#FFD700', fontSize: 16, fontWeight: 800, letterSpacing: 2 }}>
            ACTEURS STRATÉGIQUES
          </div>
          <div style={{ color: '#FFFFFF', fontSize: 44, fontWeight: 900, lineHeight: 1.15, marginTop: 4 }}>
            {name}
          </div>
          <div style={{ color: '#00D4FF', fontSize: 20, fontWeight: 700, marginTop: 8 }}>
            {role}
          </div>
          <div
            style={{
              marginTop: 20,
              paddingLeft: 18,
              borderLeft: '4px solid #FFD700',
              color: '#CBD5E0',
              fontSize: 22,
              fontStyle: 'italic',
            }}
          >
            « {quote} »
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
