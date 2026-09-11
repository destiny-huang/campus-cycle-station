# Android 正式发布

当前 Android 工程使用 Capacitor 与同一套 React/Vite 源码，`appId` 为 `com.bdfzscc.campuscycle`。Debug APK 不需要正式签名；对外发布前应由项目负责人自行保管正式密钥。

## 生成签名密钥

在安全的离线位置执行 Android Studio/JDK 提供的 `keytool`，自行设置并妥善保存密码：

```powershell
keytool -genkeypair -v -keystore campus-cycle-release.jks -alias campus-cycle -keyalg RSA -keysize 4096 -validity 10000
```

`.jks`、`.keystore`、密码和 `android/local.properties` 已禁止进入 Git。建议将密钥及密码分别做加密备份；遗失签名密钥后将无法用同一身份更新已发布 App。

## Release 构建

1. 在 Android Studio 的 `Build > Generate Signed App Bundle or APK` 中选择现有 `android/` 工程。
2. 优先生成 AAB 用于应用商店；校内侧载可另生成签名 APK。
3. 构建前执行 `npm run app:check`，并确认 API 仍指向 `https://cycle.bdfzscc.com`。
4. 不要把教师口令、OpenRouter Key、数据库或服务器信息放入 Gradle 配置或 APK。

正式下载入口应在签名包完成真机验收并确定托管地址后再开放。iOS 可在未来从同一 Capacitor 配置增加平台，不需要复制前端业务。
