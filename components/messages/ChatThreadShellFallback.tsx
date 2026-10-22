import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import type { ThemeColors } from "@/lib/theme/colors";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { createMessagesStyles } from "@/components/messages/messagesStyles";

type Styles = ReturnType<typeof createMessagesStyles>;

type Props = {
  conversationId: string;
  peerName: string;
  peerPhone: string | null;
  peerAvatarUrl: string | null;
  peerOnBlyp: boolean;
  colors: ThemeColors;
  styles: Styles;
};

/** 1er paint fil : header + zone messages + composer statique (chunk body en Suspense). */
export function ChatThreadShellFallback({
  conversationId,
  peerName,
  peerPhone,
  peerAvatarUrl,
  peerOnBlyp,
  colors,
  styles,
}: Props) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.threadHeader}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
          accessibilityLabel={t("common.back")}
        >
          <Text style={{ fontSize: 28, color: colors.text, lineHeight: 28 }}>
            ‹
          </Text>
        </Pressable>
        <PeerAvatar
          name={peerName}
          phone={peerPhone}
          remoteUrl={peerAvatarUrl ?? demoAvatarUrlForPhone(peerPhone)}
          localUri={contactPhotoUriForPhone(peerPhone)}
          size={40}
          style={styles.threadHeaderAvatar}
          recyclingKey={conversationId}
        />
        <View style={styles.threadHeaderText}>
          <Text style={styles.threadTitle} numberOfLines={1}>
            {peerName}
          </Text>
          {!peerOnBlyp ? (
            <Text style={styles.threadSubtitle} numberOfLines={1}>
              {t("messages.notOnBlyp")}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flex: 1, backgroundColor: colors.background }} />
      <View style={[styles.composer, { paddingBottom: 8 }]}>
        <View style={styles.composerField}>
          <Text style={{ fontSize: 18, opacity: 0.5 }}>💰</Text>
          <View style={[styles.composerInput, { justifyContent: "center" }]}>
            <Text style={{ color: colors.placeholder, fontSize: 16 }}>
              {t("messages.composerPlaceholder")}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
