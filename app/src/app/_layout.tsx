import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from '@/lib/store';
import { openLink } from '@/lib/links';

SplashScreen.preventAutoHideAsync().catch(() => {});
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export default function Root() {
  // app.json 의 expo-font 플러그인이 네이티브 빌드에 글꼴을 넣는다. Expo Go·웹에서는 여기서 불러온다.
  const [loaded, err] = useFonts({
    'Pretendard-Regular': require('../../assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('../../assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('../../assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('../../assets/fonts/Pretendard-Bold.otf'),
    'Pretendard-ExtraBold': require('../../assets/fonts/Pretendard-ExtraBold.otf'),
    'Pretendard-Black': require('../../assets/fonts/Pretendard-Black.otf'),
  });
  useEffect(() => { if (loaded || err) SplashScreen.hideAsync().catch(() => {}); }, [loaded, err]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(r => openLink(r.notification.request.content.data?.link as string));
    return () => sub.remove();
  }, []);
  if (!loaded && !err) return null;
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="request/new" options={{ presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="request/departure" options={{ gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="request/wanted" />
          <Stack.Screen name="request/info" />
          <Stack.Screen name="request/conditions" />
          <Stack.Screen name="candidate/[id]" />
          <Stack.Screen name="past/[id]" />
          <Stack.Screen name="find/[id]" />
          <Stack.Screen name="watch/new" options={{ presentation: Platform.OS === 'ios' ? 'modal' : 'card' }} />
          <Stack.Screen name="watch/[id]" />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
