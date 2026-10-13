/**
 * Glyphes Pay en Views/Text — pas d’Ionicons sur le chemin critique (1er frame).
 */
import React from "react";
import { Text, View } from "react-native";

export function BackspaceGlyph({ color }: { color: string }) {
  return (
    <Text
      style={{
        fontSize: 22,
        fontWeight: "600",
        color,
        marginTop: -2,
      }}
    >
      ⌫
    </Text>
  );
}

/** Coche succès PIN / reçu — sans police d’icônes. */
export function CheckGlyph({
  color,
  size = 36,
}: {
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(2, Math.round(size / 18)),
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityRole="image"
    >
      <Text
        style={{
          color,
          fontSize: size * 0.52,
          fontWeight: "800",
          marginTop: -1,
        }}
      >
        ✓
      </Text>
    </View>
  );
}

function Seg({
  x1,
  y1,
  x2,
  y2,
  color,
  t,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  t: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: "absolute",
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - t / 2,
        width: len,
        height: t,
        backgroundColor: color,
        transform: [{ rotate: `${deg}deg` }],
      }}
    />
  );
}

/**
 * Recevoir à proximité — flèche oblique : droit, montagnes russes pointues, droit, pointe.
 */
export function ReceiveNearbyGlyph({
  color,
  size = 28,
}: {
  color: string;
  size?: number;
}) {
  const t = Math.max(1.8, size * 0.075);
  const s = size / 34;
  const p = (x: number, y: number) => ({ x: x * s, y: y * s });
  const a = p(1, 11);
  const b = p(7, 11);
  const c = p(10, 2);
  const d = p(13, 20);
  const e = p(16, 2);
  const f = p(19, 11);
  const g = p(25, 11);
  const tip = p(32, 11);
  const hatT = p(24.5, 5);
  const hatB = p(24.5, 17);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: 34 * s,
          height: 22 * s,
          transform: [{ rotate: "-32deg" }],
        }}
      >
        <Seg x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={color} t={t} />
        <Seg x1={b.x} y1={b.y} x2={c.x} y2={c.y} color={color} t={t} />
        <Seg x1={c.x} y1={c.y} x2={d.x} y2={d.y} color={color} t={t} />
        <Seg x1={d.x} y1={d.y} x2={e.x} y2={e.y} color={color} t={t} />
        <Seg x1={e.x} y1={e.y} x2={f.x} y2={f.y} color={color} t={t} />
        <Seg x1={f.x} y1={f.y} x2={g.x} y2={g.y} color={color} t={t} />
        <Seg x1={g.x} y1={g.y} x2={tip.x} y2={tip.y} color={color} t={t} />
        <Seg x1={hatT.x} y1={hatT.y} x2={tip.x} y2={tip.y} color={color} t={t} />
        <Seg x1={hatB.x} y1={hatB.y} x2={tip.x} y2={tip.y} color={color} t={t} />
      </View>
    </View>
  );
}
