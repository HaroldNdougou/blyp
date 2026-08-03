/**
 * Barres de défilement ultra discrètes (invisibles) partout.
 * À importer une fois au boot (app/_layout).
 */
import { FlatList, ScrollView, SectionList } from "react-native";
import {
  FlatList as GHFlatList,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";

type WithScrollDefaults = {
  defaultProps?: Record<string, unknown>;
};

function hideScrollbars(Component: WithScrollDefaults) {
  Component.defaultProps = {
    ...Component.defaultProps,
    showsVerticalScrollIndicator: false,
    showsHorizontalScrollIndicator: false,
  };
}

hideScrollbars(ScrollView as WithScrollDefaults);
hideScrollbars(FlatList as WithScrollDefaults);
hideScrollbars(SectionList as WithScrollDefaults);
hideScrollbars(GHScrollView as WithScrollDefaults);
hideScrollbars(GHFlatList as WithScrollDefaults);
