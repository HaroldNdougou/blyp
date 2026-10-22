import { AnonymousPersonGlyph } from "@/components/peers/AnonymousPersonGlyph";
import { useTheme } from "@/contexts/ThemeContext";
import { resolvePeerAvatarUri } from "@/lib/peers/resolvePeerAvatarUri";
import { Image } from "expo-image";
import React, { memo, useEffect, useMemo, useState } from "react";
import {
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

/** Photo de profil ronde (CDN) + silhouette anonyme en repli — style WhatsApp. */
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
  const uri = useMemo(
    () => resolvePeerAvatarUri({ remoteUrl, localUri, phone }),
    [remoteUrl, localUri, phone],
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const showPhoto = Boolean(uri) && !failed;
  const radius = size / 2;
  const placeholderColor = selected ? colors.accentOn : colors.avatarText;

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
        <AnonymousPersonGlyph
          color={placeholderColor}
          size={Math.round(size * 0.52)}
        />
      )}
    </View>
  );
});
