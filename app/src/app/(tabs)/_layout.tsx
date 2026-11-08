import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '@/components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={p => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tracking" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="my" />
    </Tabs>
  );
}
