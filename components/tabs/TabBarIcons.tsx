import React from "react";
import { View } from "react-native";

/**
 * Icônes d’onglets en Views — visibles dès le 1er frame.
 * (Ionicons reste OK ailleurs ; la tab bar ne doit pas attendre la police.)
 */

export function NineDotKeypadIcon({ color }: { color: string }) {
  const row = [0, 1, 2];
  return (
    <View style={{ width: 24, height: 24, justifyContent: "space-between" }}>
      {row.map((r) => (
        <View
          key={r}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            width: 24,
          }}
        >
          {row.map((c) => (
            <View
              key={c}
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: color,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Flèches verticales type swap-vertical. */
export function SwapTabIcon({ color }: { color: string }) {
  const stemW = 2.5;
  const stemH = 10;
  const tip = 4;
  return (
    <View
      style={{
        width: 24,
        height: 22,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <View style={{ alignItems: "center", width: 10 }}>
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: tip,
            borderRightWidth: tip,
            borderBottomWidth: tip + 1,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderBottomColor: color,
          }}
        />
        <View
          style={{
            width: stemW,
            height: stemH,
            backgroundColor: color,
            borderRadius: 1,
          }}
        />
      </View>
      <View style={{ alignItems: "center", width: 10 }}>
        <View
          style={{
            width: stemW,
            height: stemH,
            backgroundColor: color,
            borderRadius: 1,
          }}
        />
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: tip,
            borderRightWidth: tip,
            borderTopWidth: tip + 1,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderTopColor: color,
          }}
        />
      </View>
    </View>
  );
}

/** Silhouette profil. */
export function PersonTabIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: "center" }}>
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 4.5,
          backgroundColor: color,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: 16,
          height: 9,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
