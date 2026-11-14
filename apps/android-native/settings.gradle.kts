pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // 카카오 로그인 SDK 는 카카오 저장소에만 있다. 이 저장소에서는 카카오 SDK 만 받는다 — 다른 의존성이
        // 여기서 같은 이름으로 내려오지 않게 막는다.
        maven {
            url = uri("https://devrepo.kakao.com/nexus/content/groups/public/")
            content { includeGroup("com.kakao.sdk") }
        }
    }
}

rootProject.name = "AlarmTalkNative"
include(":app")
