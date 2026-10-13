import { useTheme } from "@/contexts/ThemeContext";
import { peerAvatarUrl } from "@/lib/peers/peerAvatarUrl";
import { Image } from "expo-image";
import React, { memo, useEffect, useMemo, useState } from "react";
import {
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type Props = {
  name: string;
  phone?: string | null;
  /** Photo répertoire (file://). */
  localUri?: string | null;
  /** URL serveur / CDN (ex. `user.avatarUrl`). */
  remoteUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Puce Pay sélectionnée (fond accent). */
  selected?: boolean;
  recyclingKey?: string;
};

/** Photo de profil ronde (CDN) + initiale en repli — style WhatsApp. */
export const PeerAvatar = memo(function PeerAvatar({
  name,
  phone,
  localUri,
  remoteUrl,
  size = 48,
  style,
  textStyle,
  selected = false,
  recyclingKey,
}: Props) {
  const { colors } = useTheme();
  const cdnUri = useMemo(() => peerAvatarUrl(phone), [phone]);
  const uri = useMemo(() => {
    const remote = String(remoteUrl ?? "").trim();
    if (remote) return remote;
    const local = String(localUri ?? "").trim();
    if (local) return local;
    return cdnUri;
  }, [remoteUrl, localUri, cdnUri]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const showPhoto = Boolean(uri) && !failed;
  const initial = (String(name ?? "").trim().charAt(0) || "?").toUpperCase();
  const radius = size / 2;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colors.accent : colors.avatarBackground,
        },
        style,
      ]}
    >
      {showPhoto ? (
        <Image
          source={{ uri: uri! }}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey ?? uri ?? undefined}
          transition={0}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          style={[
            {
              fontSize: Math.max(12, Math.round(size * 0.38)),
              fontWeight: "700",
              color: selected ? colors.accentOn : colors.avatarText,
            },
            textStyle,
          ]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
});
