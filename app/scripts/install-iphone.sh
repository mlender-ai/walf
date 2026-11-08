#!/bin/zsh
# 무료 Apple ID(Personal Team)로 연결된 iPhone에 WALF 테스트 앱을 설치한다. 무료 설치본은 7일마다 다시 설치해야 한다.
# 사용: ./scripts/install-iphone.sh            (서버 주소 = 이 맥의 Wi-Fi IP:4300)
#       WALF_API=http://1.2.3.4:4300 ./scripts/install-iphone.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

TEAM=${WALF_APPLE_TEAM_ID:-U74GJUCR7H}          # Xcode Accounts의 Personal Team
API=${WALF_API:-http://$(ipconfig getifaddr en0):4300}
DEVICE=${WALF_DEVICE:-$(xcrun xctrace list devices 2>/dev/null | grep -v Simulator | grep -E '\([0-9]+\.[0-9.]+\) \([0-9A-F-]+\)$' | head -1 | sed -E 's/.*\(([0-9A-F-]+)\)$/\1/')}
# 기기가 케이블 없이 Wi-Fi로만 붙어 있어도 된다: 이미 팀에 등록된 기기라 “모든 iPhone”용으로 빌드하고 devicectl 로 설치한다
[ -n "$DEVICE" ] || { echo "연결된 iPhone이 없어요. 케이블로 연결하고 잠금을 풀어 주세요."; exit 1; }
DD=${TMPDIR:-/tmp}/walf-device-build
echo "서버 $API · 팀 $TEAM · 기기 $DEVICE"

export WALF_FREE_SIGNING=1 WALF_APPLE_TEAM_ID=$TEAM EXPO_PUBLIC_API_URL=$API
CI=1 npx expo prebuild --platform ios --no-install >/dev/null
(cd ios && pod install >/dev/null)
xcodebuild -workspace ios/WALF.xcworkspace -scheme WALF -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$DD" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=$TEAM build -quiet
# devicectl 은 케이블 ID(UDID)가 아니라 CoreDevice 식별자로 찾아야 Wi-Fi 연결에서도 된다
CD=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /available|connected/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-/) {print $i; exit}}')
[ -n "$CD" ] || { echo "iPhone에 연결할 수 없어요. 잠금을 풀고 같은 Wi-Fi에 두거나 케이블로 연결해 주세요."; exit 1; }
xcrun devicectl device install app --device "$CD" "$DD/Build/Products/Release-iphoneos/WALF.app"
xcrun devicectl device process launch --device "$CD" app.walf.local || echo "처음 설치라면 iPhone 설정 → 일반 → VPN 및 기기 관리에서 개발자를 신뢰해 주세요."
