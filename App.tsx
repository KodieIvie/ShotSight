import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ShotSightProvider, useShotSight } from './src/application/ShotSightProvider';
import { BootScreen, CameraDiagnosticsScreen, CameraScreen, CameraSetupScreen, CandidateReviewRouteScreen, CaptureCompareScreen, CaptureDetailScreen, GroupEditorScreen, LiveTargetScreen, ManualShotScreen, NewSessionScreen, PointOfAimScreen, SessionExportScreen, SessionsScreen, SettingsScreen, ShotsScreen, TargetCalibrationScreen, TargetManagerScreen, TargetPlaybackScreen, TargetRoiScreen, TargetScreen, TargetSystemSetupScreen, TargetToolsScreen, ZeroingAssistantScreen } from './src/ui/screens';
import type { MainTabParamList, RootStackParamList } from './src/ui/navigation/types';
import { palette } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.accent,
    background: palette.background,
    card: palette.surface,
    text: palette.text,
    border: palette.border,
    notification: palette.accent,
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ShotSightProvider>
          <AppRouter />
        </ShotSightProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppRouter() {
  const { ready, error, refresh } = useShotSight();
  if (!ready || error) {
    return <BootScreen error={error} retry={() => void refresh()} />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen component={MainTabs} name="Main" options={{ headerShown: false }} />
        <Stack.Screen component={CameraSetupScreen} name="CameraSetup" options={{ title: 'Local camera setup' }} />
        <Stack.Screen component={CameraDiagnosticsScreen} name="CameraDiagnostics" options={{ title: 'Local diagnostics' }} />
        <Stack.Screen component={TargetSystemSetupScreen} name="TargetSystemSetup" options={{ title: 'Target system setup' }} />
        <Stack.Screen component={LiveTargetScreen} name="LiveTarget" options={{ animation: 'fade', headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen component={NewSessionScreen} name="NewSession" options={{ title: 'New session' }} />
        <Stack.Screen component={TargetManagerScreen} name="TargetManager" options={{ title: 'Session targets' }} />
        <Stack.Screen component={SessionExportScreen} name="SessionExport" options={{ title: 'Export session' }} />
        <Stack.Screen component={CaptureDetailScreen} name="CaptureDetail" options={{ title: 'Capture' }} />
        <Stack.Screen component={CaptureCompareScreen} name="CaptureCompare" options={{ title: 'Compare captures' }} />
        <Stack.Screen component={CandidateReviewRouteScreen} name="CandidateReview" options={{ title: 'Review impacts' }} />
        <Stack.Screen component={ManualShotScreen} name="ManualShot" options={{ title: 'Add shot' }} />
        <Stack.Screen component={TargetToolsScreen} name="TargetTools" options={{ title: 'Target tools' }} />
        <Stack.Screen component={TargetRoiScreen} name="TargetRoi" options={{ title: 'Lock target area' }} />
        <Stack.Screen component={TargetCalibrationScreen} name="TargetCalibration" options={{ title: 'Calibrate target' }} />
        <Stack.Screen component={PointOfAimScreen} name="PointOfAim" options={{ title: 'POA / POI' }} />
        <Stack.Screen component={ZeroingAssistantScreen} name="ZeroingAssistant" options={{ title: 'Zeroing assistant' }} />
        <Stack.Screen component={TargetPlaybackScreen} name="TargetPlayback" options={{ title: 'Shot playback' }} />
        <Stack.Screen component={GroupEditorScreen} name="GroupEditor" options={{ title: 'Shot group' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Target"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textDim,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        tabBarIcon: ({ color, size }) => <MaterialCommunityIcons color={color} name={tabIcon(route.name)} size={size} />,
      })}
    >
      <Tab.Screen component={TargetScreen} name="Target" />
      <Tab.Screen component={ShotsScreen} name="Shots" />
      <Tab.Screen component={SessionsScreen} name="Sessions" />
      <Tab.Screen component={CameraScreen} name="Camera" />
      <Tab.Screen component={SettingsScreen} name="Settings" />
    </Tab.Navigator>
  );
}

function tabIcon(name: keyof MainTabParamList): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (name) {
    case 'Target': return 'crosshairs-gps';
    case 'Shots': return 'format-list-numbered';
    case 'Sessions': return 'folder-outline';
    case 'Camera': return 'video-wireless-outline';
    case 'Settings': return 'cog-outline';
  }
}
