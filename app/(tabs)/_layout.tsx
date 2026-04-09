import { useAuth } from "@/contexts/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function NineDotKeypadIcon({ color }: { color: string }) {
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

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: "#5dc705",
        tabBarInactiveTintColor: "#8E8E93",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopWidth: 0.5,
          borderTopColor: "#F0F0F0",
          height: 52 + (insets.bottom > 0 ? insets.bottom : 8),
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
        },
      }}
    >
        <Tabs.Screen
          name="index"
          options={{
            tabBarIcon: ({ color }) => <NineDotKeypadIcon color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? "swap-vertical" : "swap-vertical-outline"}
                size={24}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            /**
             * Ne pas utiliser `href: null` quand déconnecté : le passage 2 → 3 onglets
             * remontait les écrans et réinitialisait l’état (ex. montant saisi sur l’accueil).
             */
            tabBarButton: token ? undefined : () => null,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? "person" : "person-outline"}
                size={24}
                color={color}
              />
            ),
          }}
        />
      </Tabs>
  );
}
